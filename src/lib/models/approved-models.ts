// Compile-checked list of model IDs the subagent harness and any future
// caller is allowed to pass to the Vercel AI Gateway. Adding a new model
// here is intentionally a code change (not a config change) so that
// model selection is reviewable.
//
// ID format = `<provider>/<model>` matching Gateway conventions. Version
// numbers use dots, not hyphens (e.g. `claude-sonnet-4.6`, not `-4-6`).

export const APPROVED_MODELS = [
  // Anthropic
  'anthropic/claude-haiku-4.5',
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-opus-4.7',
  // Google
  'google/gemini-2.5-flash-lite',
  'google/gemini-2.5-flash',
  'google/gemini-2.5-pro',
] as const;

export type ApprovedModelId = (typeof APPROVED_MODELS)[number];

export function isApprovedModelId(value: string): value is ApprovedModelId {
  return (APPROVED_MODELS as readonly string[]).includes(value);
}
