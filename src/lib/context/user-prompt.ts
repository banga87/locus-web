// UserPromptSubmit payload builder — pure, no DB imports.
//
// `buildUserPromptPayload` assembles the `InjectedContext` payload the
// chat route's UserPromptSubmit hook hands back as a `{ decision:
// 'inject', payload }` response. The handler itself lives in
// `./register.ts`; this module stays pure so the logic is trivially
// unit-testable (the `user-prompt.test.ts` suite mocks the repo).
//
// Order of blocks — stable and significant because the system prompt
// builder (harness `renderInjectedContext`) concatenates them in the
// order they land here:
//   1. Attachment blocks (inline if `<8KB` AND under running budget,
//      otherwise pointer-form). Pointer bodies carry a user-facing
//      question asking the agent to prompt the user about source-doc
//      promotion vs section-walk.
//   2. `ingestion-filing` — the built-in skill that guides how agents
//      propose filings. Only injected when at least one attachment is
//      present; silently skipped if the filing skill hasn't been
//      seeded yet (Task 10 ships the seed).
//   3. `skill` blocks — zero or more matches from the compiled skill
//      manifest, filtered by the agent's candidate pool, and clipped
//      to `SKILL_BUDGET_BYTES` in priority-first order.
//
// Why attachments come before skills in the block order: the filing
// guidance needs to land adjacent to the attachment content it
// governs, and the skill matcher's output is the least important of
// the three — a user-authored skill can afford to be further from the
// turn's attention focus than the user's own uploaded content.
//
// Budget contract:
//   - ATTACHMENT_INLINE_THRESHOLD_BYTES (8KB): strictly-less-than
//     gate for inline eligibility. A file at exactly 8KB is pointer-
//     form. Design decision: the threshold is a behavioural boundary
//     ("small enough to inline verbatim"), not a size hard-cap.
//   - ATTACHMENT_INLINE_BUDGET_BYTES (12KB): running budget across
//     all attachments in a turn. When the next inline-eligible
//     attachment would overflow, it falls back to pointer form.
//   - SKILL_BUDGET_BYTES (8KB): cap across all skill bodies. Matches
//     that would push total body bytes over the cap are dropped
//     (matcher already sorts by score-desc then priority-desc, so the
//     drop-the-tail strategy preserves the highest-signal skills).
//
// Degradation rules (`buildUserPromptPayload` never throws):
//   - No manifest for the company → skip skill matching (return empty
//     skills section). Phase 1.5 Task 3 debounces the first rebuild at
//     5s after the first skill doc is authored; a nil manifest during
//     that window simply means no skills inject on this turn.
//   - Empty `agentSkillIds` → skip skill matching entirely. No need
//     to even fetch the manifest — agents with no skills bound cannot
//     match anything.
//   - No attachments → skip the ingestion-filing co-injection, even
//     if the seed doc exists. The filing skill is attachment-gated by
//     design (see design spec §Ingestion Flow).
//   - Missing ingestion-filing doc (Task 10 not yet seeded) → drop
//     the filing block silently; attachment blocks still land.

import { matchSkills } from '@/lib/skills/matcher';
import type { SkillManifest } from '@/lib/skills/manifest-compiler';

import {
  ATTACHMENT_INLINE_BUDGET_BYTES,
  ATTACHMENT_INLINE_THRESHOLD_BYTES,
  SKILL_BUDGET_BYTES,
} from './budgets';
import type { ContextBlock, InjectedContext } from './types';

/** Shape the user-prompt builder needs from the brain. Injected —
 *  Drizzle queries live in `./repos.ts` so this module stays pure and
 *  platform-agnostic. */
export interface UserPromptRepo {
  /**
   * Load the compiled skill manifest for a company. Returns `null`
   * when no rebuild has been written yet (Task 3 debounces the first
   * rebuild at 5s after the first skill-doc save). Callers skip skill
   * matching on a miss.
   */
  getManifest(companyId: string): Promise<SkillManifest | null>;

  /**
   * Batch-fetch skill bodies (content minus frontmatter) by doc id.
   * The matcher returns ordered `SkillMatch[]`; the builder iterates
   * those matches and looks up bodies via a `Map` built from this
   * result, so the returned order does not matter.
   *
   * Short-circuit on empty input — the builder passes through the
   * matcher's ids as-is without pre-checking.
   */
  getSkillBodies(ids: string[]): Promise<Array<{ id: string; body: string }>>;

  /**
   * Extracted attachments for this session — the rows with
   * `status = 'extracted'`, `extracted_text IS NOT NULL`. Task 8
   * ships the attachments pipeline; the DB-backed implementation in
   * `./repos.ts` filters on `companyId = ? AND sessionId = ?` so a
   * bug upstream where a `sessionId` leaked cross-tenant can't pull
   * rows from the wrong company. Mirrors the company-scope contract
   * on every other read helper in `src/lib/ingestion/attachments.ts`.
   */
  getExtractedAttachments(
    companyId: string,
    sessionId: string,
  ): Promise<
    Array<{
      id: string;
      filename: string | null;
      extractedText: string;
      sizeBytes: number;
    }>
  >;

  /**
   * Load the seeded built-in `ingestion-filing` skill for this
   * company. Returns `null` before Task 10 ships the seed migration,
   * or when the seed has been deleted. Callers degrade gracefully —
   * attachments still get inlined, the filing block is just omitted.
   */
  getIngestionFilingSkill(
    companyId: string,
  ): Promise<{ id: string; body: string } | null>;
}

export interface UserPromptInput {
  companyId: string;
  sessionId: string;
  /**
   * Agent's skill candidate pool — the `skills:` frontmatter array
   * from the active `agent-definition` doc. Empty array means the
   * agent has no skills bound; the builder short-circuits skill
   * matching without touching the manifest.
   */
  agentSkillIds: string[];
  /** The raw user text this turn. Passed straight to the matcher. */
  userMessage: string;
}

/**
 * Build the UserPromptSubmit `InjectedContext` payload. Pure — the
 * `UserPromptRepo` is the only side-effectful dependency and is
 * injected at the call site. Never throws: all error paths degrade
 * gracefully. The `register.ts` wrapper still catches defensively
 * (any throw would otherwise fail the turn), but this function
 * targets the "happy paths never throw" side of the contract.
 */
export async function buildUserPromptPayload(
  input: UserPromptInput,
  repo: UserPromptRepo,
): Promise<InjectedContext> {
  const blocks: ContextBlock[] = [];

  // ---- 1. Attachments -----------------------------------------------------
  //
  // For each attachment: inline if small AND the running budget still
  // has room; pointer otherwise. The inline/pointer decision is made
  // at the attachment level — we never split one across blocks or
  // truncate the middle. If a single attachment is under threshold
  // but over the remaining budget, it falls through to pointer form
  // (the LLM gets the metadata + the user-choice question, which is
  // more useful than a half-inlined body).
  const attachments = await repo.getExtractedAttachments(
    input.companyId,
    input.sessionId,
  );
  let attachmentBudgetLeft = ATTACHMENT_INLINE_BUDGET_BYTES;
  for (const att of attachments) {
    const inlineEligible =
      att.sizeBytes < ATTACHMENT_INLINE_THRESHOLD_BYTES &&
      att.sizeBytes <= attachmentBudgetLeft;

    if (inlineEligible) {
      blocks.push({
        kind: 'attachment-inline',
        title: att.filename ?? `Attachment ${att.id}`,
        body: att.extractedText,
        attachmentId: att.id,
      });
      attachmentBudgetLeft -= att.sizeBytes;
    } else {
      blocks.push({
        kind: 'attachment-pointer',
        title: att.filename ?? `Attachment ${att.id}`,
        body: renderPointer(att),
        attachmentId: att.id,
      });
    }
  }

  // ---- 2. Ingestion-filing skill (attachment-gated) -----------------------
  //
  // The filing skill body tells the agent how to propose filings
  // (source-doc promotion, category selection, update-vs-create, etc).
  // It's pulled UNCONDITIONALLY when any attachment is present — no
  // natural-language trigger match, no scoring. See design spec
  // §Ingestion Flow.
  //
  // Graceful degradation: the seed ships in Task 10. Before then the
  // repo returns `null`; we silently drop the filing block and let
  // the attachment blocks stand alone. The agent's base system prompt
  // + attachment content is enough for a coherent "I've read your
  // file, what would you like me to do?" turn.
  if (attachments.length > 0) {
    const filing = await repo.getIngestionFilingSkill(input.companyId);
    if (filing) {
      blocks.push({
        kind: 'ingestion-filing',
        title: 'Ingestion filing rules',
        body: filing.body,
        sourceDocId: filing.id,
      });
    }
  }

  // ---- 3. Skill matching --------------------------------------------------
  //
  // Short-circuit guards (order matters for test-asserted call
  // minimisation):
  //   - Empty candidate pool → no manifest fetch, no matcher call.
  //   - Manifest missing → no body fetch.
  //   - Empty match set → no body fetch.
  if (input.agentSkillIds.length > 0) {
    const manifest = await repo.getManifest(input.companyId);
    if (manifest) {
      const matches = matchSkills(manifest, input.userMessage, {
        candidateIds: input.agentSkillIds,
      });
      if (matches.length > 0) {
        const bodies = await repo.getSkillBodies(matches.map((m) => m.id));
        const bodyById = new Map(bodies.map((b) => [b.id, b.body]));
        let skillBudgetLeft = SKILL_BUDGET_BYTES;
        for (const m of matches) {
          const body = bodyById.get(m.id) ?? '';
          const size = Buffer.byteLength(body, 'utf8');
          // Strict `>` — a body that exactly equals the remaining
          // budget still fits. The matcher has already sorted, so a
          // `break` here drops the lowest-priority tail; a `continue`
          // would let a smaller, lower-priority skill sneak in ahead
          // of a larger higher-priority one that happened to overflow
          // by a byte. That behaviour is defensible ("pack more in
          // when you can") but clashes with the plan's "lowest-
          // priority drops" contract, so we break.
          if (size > skillBudgetLeft) break;
          blocks.push({
            kind: 'skill',
            title: m.skill.title,
            body,
            skillId: m.id,
            sourceDocId: m.skill.bodyDocId,
          });
          skillBudgetLeft -= size;
        }
      }
    }
  }

  return { blocks };
}

/**
 * Render the pointer-form body for an oversized attachment. Two
 * lines: a bracketed metadata header (filename, rounded size) and a
 * prompt-consistent question the agent should ask the user. The
 * question wording is deliberately stable so the LLM sees the same
 * phrasing across turns — prompt consistency improves caching and
 * prevents the agent from improvising contradictory options.
 */
function renderPointer(att: {
  id: string;
  filename: string | null;
  sizeBytes: number;
}): string {
  const kb = Math.round(att.sizeBytes / 1024);
  const label = att.filename ?? att.id;
  return [
    `[Attachment: ${label} — ${kb}KB extracted]`,
    `This document is too large to inline. Ask the user: "Would you like me to (a) file the full extracted text as a source document so it's searchable from now on, or (b) work through it section by section?"`,
  ].join('\n');
}
