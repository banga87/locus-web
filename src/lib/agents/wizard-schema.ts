// Zod schema for the "New Agent" wizard input.
//
// This is the single source of truth for shape + validation of
// agent-definition form data. Both the create and update API routes
// parse against this schema (update allows partial input via
// `.partial()` in the caller); the `buildAgentDefinitionDoc` service in
// `./definitions.ts` consumes the inferred type to assemble the
// frontmatter + markdown.
//
// Model IDs use hyphens (`claude-sonnet-4-6`), matching the
// Anthropic model-ID format used throughout Phase 1 (see
// `src/lib/agent/**`). No dots — that would be a different ID space.

import { z } from 'zod';

// Whitelisted Anthropic model IDs. Keep in sync with whatever the agent
// harness (`src/lib/agent/run.ts`) actually accepts — adding a model
// here without teaching the harness about it will surface a runtime
// error on first use, not a zod validation error. Intentional: the
// harness is the final authority on which models are wired up.
export const ALLOWED_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-haiku-4-5-20251001',
] as const;

// Known capability labels (v1):
//   - 'web' — grants web_search + web_fetch tool visibility.
// Route-layer policy (see `src/app/api/agent/chat/grantedCapabilities.ts`)
// gates tool availability based on this array.
export const agentWizardInputSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .min(1)
    .max(128)
    // Prevent user agents from shadowing the synthetic 'platform-agent' default.
    .refine((s) => s !== 'platform-agent', {
      message: "'platform-agent' is reserved — choose a different slug",
    }),
  model: z.enum(ALLOWED_MODELS),
  toolAllowlist: z.array(z.string()).optional(),
  baselineDocIds: z.array(z.string().uuid()),
  skillIds: z.array(z.string().uuid()),
  systemPromptSnippet: z.string().max(4000),
  capabilities: z.array(z.enum(['web'])).default([]),
});

export type AgentWizardInput = z.infer<typeof agentWizardInputSchema>;
