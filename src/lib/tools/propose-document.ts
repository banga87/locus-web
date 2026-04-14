// propose_document_create + propose_document_update — user-gated
// write proposals.
//
// These two tools are the ONLY surface through which an agent can
// signal intent to modify the brain. They never call the DB or the
// Brain CRUD API: their `execute` functions are pure transforms that
// wrap validated input into a `{ proposal, isProposal: true }`
// payload. That payload lands in the tool-result stream, the chat UI
// (`src/components/chat/tool-call-indicator.tsx`) picks it up via the
// `isProposal` discriminator, and renders a `<ProposalCard>` with
// Approve / Discard buttons. Approve posts to the existing
// authenticated Brain CRUD routes — the user is the one performing
// the write, not the agent.
//
// Why this shape:
//   - Preserves Phase 1's "no agent writes" invariant. Every write
//     has a human in the loop, and the audit log records the human
//     as the actor (the agent merely proposed).
//   - Keeps the tool bridge side-effect-free. Registering these two
//     tools for every agent is safe because the worst case is a
//     rejected proposal the user sees as a dismissable card.
//   - Gives the UI a stable payload shape. The tagged union
//     `kind: 'create' | 'update'` lets the card render the right
//     preview + dispatch to the right CRUD endpoint.
//
// Why Zod (not JSON Schema): the Phase 1 brain tools use `dynamicTool`
// with runtime-built JSON Schema because their argument shapes come
// from `LocusTool` descriptors. These propose tools, by contrast,
// have a fixed compile-time schema — zod gives us inferred TS types
// for free and a single source of truth for validation.
//
// Why both schemas live in this file: they're tightly coupled to the
// `<ProposalCard>` props. Extracting them would spread a small
// surface across three files without helping refactoring. If we ever
// grow a third kind of proposal we'll split then.

import { tool } from 'ai';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/**
 * Input schema for `propose_document_create`. Category/type are free-form
 * strings (not enums) so that custom company taxonomies don't need a
 * code change to use them — validation of "is this a real category"
 * happens on the server when the approval POSTs to the Brain CRUD
 * endpoint. Frontmatter is an open record so agents can propose
 * whatever YAML shape the filing skill calls for.
 */
const createSchema = z.object({
  category: z.string().min(1),
  type: z.string().min(1),
  title: z.string().min(1),
  frontmatter: z.record(z.string(), z.unknown()),
  body_markdown: z.string(),
  rationale: z.string().min(1),
});

/**
 * Input schema for `propose_document_update`. The target doc id is a
 * hard UUID — if the agent invents a fake id the schema rejects
 * before the card renders. Both patches are optional (update may be
 * frontmatter-only or body-only) but at least one should be present
 * in practice; we don't enforce that here because the downstream
 * PATCH endpoint rejects empty patches anyway, and forcing it at the
 * schema level would force the LLM to include noise fields.
 */
const updateSchema = z.object({
  target_doc_id: z.string().uuid(),
  frontmatter_patch: z.record(z.string(), z.unknown()).optional(),
  body_patch: z.string().optional(),
  rationale: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/**
 * Propose creating a new brain document.
 *
 * Name used on the tool bridge + in `tool-call-indicator.tsx`:
 * `propose_document_create`.
 *
 * Why the redundant `schema.parse(input)` inside `execute`: in AI SDK
 * v6, schema validation is applied by `streamText` / `generateText`
 * when the MODEL generates a tool call, but a direct call to
 * `tool.execute(...)` (which is what the unit tests exercise, and
 * what a future in-process caller might do) bypasses that boundary.
 * Parsing defensively here means the invariant "only valid proposals
 * reach the user-gated approval card" holds regardless of who
 * invokes the tool. Zod's `.parse()` throws a `ZodError` on invalid
 * input — the AI SDK catches that upstream and surfaces it as a
 * tool-error state, and the test suite asserts the throw directly.
 */
export const proposeDocumentCreateTool = tool({
  description:
    'Propose creating a new brain document. Does NOT write — the user reviews and approves.',
  inputSchema: createSchema,
  execute: async (input) => {
    const validated = createSchema.parse(input);
    return {
      // Tagged union discriminator. The chat-UI renderer switches on
      // `proposal.kind` to pick the Approve payload shape.
      proposal: { kind: 'create' as const, ...validated },
      // Stable boolean flag the renderer matches on so new tool types
      // can be added without shuffling the detection heuristic.
      isProposal: true,
    };
  },
});

/**
 * Propose updating an existing brain document.
 *
 * Name used on the tool bridge + in `tool-call-indicator.tsx`:
 * `propose_document_update`.
 *
 * Same defensive-parse rationale as `proposeDocumentCreateTool`
 * above. See that tool's JSDoc for why we parse twice.
 */
export const proposeDocumentUpdateTool = tool({
  description:
    'Propose updating an existing brain document. Does NOT write — the user reviews and approves.',
  inputSchema: updateSchema,
  execute: async (input) => {
    const validated = updateSchema.parse(input);
    return {
      proposal: { kind: 'update' as const, ...validated },
      isProposal: true,
    };
  },
});
