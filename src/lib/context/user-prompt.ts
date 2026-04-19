// UserPromptSubmit payload builder — pure, no DB imports.
//
// `buildUserPromptPayload` assembles the `InjectedContext` payload the
// chat route's UserPromptSubmit hook hands back as a `{ decision:
// 'inject', payload }` response. The handler itself lives in
// `./register.ts`; this module stays pure so the logic is trivially
// unit-testable (the `user-prompt.test.ts` suite mocks the repo).
//
// Scope (post-skills-rewrite): this builder only emits attachment
// blocks. Skill injection used to live here under a compiled-manifest
// + matcher scheme; that whole mechanism has been replaced by
// progressive-disclosure skills surfaced through the agent's system
// prompt + `load_skill` / `read_skill_file` tools (see
// `src/lib/skills/README.md`). Attachment-gated `ingestion-filing`
// co-injection is likewise gone — the ingestion skill is now just
// another progressive-disclosure skill the agent can load on demand.
//
// Budget contract:
//   - ATTACHMENT_INLINE_THRESHOLD_BYTES (8KB): strictly-less-than
//     gate for inline eligibility. A file at exactly 8KB is pointer-
//     form. Design decision: the threshold is a behavioural boundary
//     ("small enough to inline verbatim"), not a size hard-cap.
//   - ATTACHMENT_INLINE_BUDGET_BYTES (12KB): running budget across
//     all attachments in a turn. When the next inline-eligible
//     attachment would overflow, it falls back to pointer form.
//
// Degradation rules (`buildUserPromptPayload` never throws): no
// attachments → empty payload; the register.ts wrapper short-circuits
// an empty `blocks` array to `{ decision: 'allow' }`.

import {
  ATTACHMENT_INLINE_BUDGET_BYTES,
  ATTACHMENT_INLINE_THRESHOLD_BYTES,
} from './budgets';
import type { ContextBlock, InjectedContext } from './types';

/** Shape the user-prompt builder needs from the brain. Injected —
 *  Drizzle queries live in `./repos.ts` so this module stays pure and
 *  platform-agnostic. */
export interface UserPromptRepo {
  /**
   * Extracted attachments for this session — the rows with
   * `status = 'extracted'`, `extracted_text IS NOT NULL`. The
   * DB-backed implementation in `./repos.ts` filters on
   * `companyId = ? AND sessionId = ?` so a bug upstream where a
   * `sessionId` leaked cross-tenant can't pull rows from the wrong
   * company. Mirrors the company-scope contract on every other read
   * helper in `src/lib/ingestion/attachments.ts`.
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
}

export interface UserPromptInput {
  companyId: string;
  sessionId: string;
  /** The raw user text this turn. Retained for parity with future
   *  per-turn injections; currently unused by the attachments-only
   *  builder. */
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

  // ---- Attachments --------------------------------------------------------
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
