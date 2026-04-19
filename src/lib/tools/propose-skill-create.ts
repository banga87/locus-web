// propose_skill_create — user-gated skill creation proposal.
//
// This tool is the agent surface for proposing a new skill. It never
// writes to the DB: `execute` is a pure transform that validates input
// and wraps it in a `{ proposal, isProposal: true }` payload. That
// payload lands in the tool-result stream, the chat UI picks it up via
// the `isProposal` discriminator, and renders a `<ProposalCard>` with
// Approve / Discard buttons. Approve posts to the skill-accept route
// (Task 31), which calls `writeSkillTree` — the human is the actor,
// not the agent.
//
// Why this shape:
//   - Preserves the "no agent writes" invariant. Every write has a
//     human in the loop; the audit log records the human as the actor.
//   - Keeps the tool bridge side-effect-free. Registering this tool
//     for every agent is safe — worst case is a rejected proposal the
//     user sees as a dismissable card.
//   - Gives the UI a stable payload shape. The tagged union
//     `kind: 'skill-create'` lets the card dispatch to the right
//     accept route.
//
// Why the redundant `schema.parse(input)` inside `execute`: in AI SDK
// v6, schema validation is applied by `streamText` / `generateText`
// when the MODEL generates a tool call, but a direct call to
// `tool.execute(...)` — which is what unit tests exercise, and what a
// future in-process caller might do — bypasses that boundary. Parsing
// defensively here means the invariant "only valid proposals reach the
// approval card" holds regardless of who invokes the tool.

import { tool } from 'ai';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Input schema for `propose_skill_create`.
 *
 * - `name`: slug-style identifier; max 200 chars.
 * - `description`: one-paragraph human summary; max 1000 chars.
 * - `body`: full markdown body of the skill's main file.
 * - `resources`: optional companion files (examples, templates). Each
 *   entry carries a relative path within the skill tree and its content.
 *   Defaults to [] so the agent can omit it for simple skills.
 * - `rationale`: why the agent is proposing this skill — displayed
 *   verbatim on the approval card so the user has context to decide.
 */
const schema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  body: z.string().min(1),
  resources: z.array(z.object({
    relative_path: z.string().min(1).max(256),
    content: z.string(),
  })).default([]),
  rationale: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

/**
 * Propose creating a new skill. Does NOT write — the user reviews and approves.
 *
 * Name used on the tool bridge + in `tool-call-indicator.tsx`:
 * `propose_skill_create`.
 */
export const proposeSkillCreateTool = tool({
  description:
    'Propose creating a new skill. Does NOT write — the user reviews and approves.',
  inputSchema: schema,
  execute: async (input) => {
    const validated = schema.parse(input);
    return {
      // Tagged union discriminator. The chat-UI renderer switches on
      // `proposal.kind` to pick the Approve payload shape and route.
      proposal: { kind: 'skill-create' as const, ...validated },
      // Stable boolean flag the renderer matches on so new proposal
      // types can be added without shuffling the detection heuristic.
      isProposal: true,
    };
  },
});
