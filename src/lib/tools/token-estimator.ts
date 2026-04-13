// Rough token estimator used for response metadata. 1 token per ~4 chars
// of English text is the standard rule-of-thumb and is accurate enough
// for surfacing "how expensive was this response" to callers.
//
// NOT used for billing — the Usage Tracker (Phase 1) will read real token
// counts from the LLM provider response, not this estimate.

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
