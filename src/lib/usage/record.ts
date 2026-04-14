// Usage + cost recorder. Called from `onFinish` in the chat route after
// every LLM turn. Writes a single row to `usage_records` with both the
// provider cost (what Locus pays Anthropic) and the customer cost (what
// Locus charges the customer — provider cost + 30% markup per ADR-003).
//
// Cost calculation assumes Anthropic prompt caching is in effect:
// `runAgentTurn` pins `cacheControl: { type: 'ephemeral' }` on the system
// prompt + tool set, and Anthropic bills cached input tokens at ~10% of
// the uncached rate. We split `inputTokens` into cached vs uncached and
// price each separately so the customer cost reflects the realised
// caching discount rather than a worst-case pre-cache estimate.
//
// Phase 1 hardcodes a single model in the rate map (Sonnet-4-6). Phase 2
// will add the routing classifier + cheaper models; the map grows
// alongside.

import { db } from '@/db';
import { usageRecords } from '@/db/schema';
import { MARKUP } from './markup';

interface RecordUsageParams {
  companyId: string;
  sessionId: string | null;
  userId: string | null;
  /** Provider-prefixed model id, e.g. `anthropic/claude-sonnet-4-6`. */
  modelId: string;
  /** Total input tokens (cached + uncached). */
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Cached subset of inputTokens. Charged at the cached rate. */
  cachedInputTokens?: number;
}

/**
 * Per-model rates in USD per 1K tokens. Update when:
 *   - A new model is wired into `runAgentTurn`'s default or routing.
 *   - Anthropic's published rates change (rare but it happens).
 *
 * `cachedInput` is the rate Anthropic charges for a cache READ — cache
 * writes still bill at the uncached rate the first time. Phase 1's
 * `cachedInputTokens` parameter receives only the read count, so the
 * write portion silently bills at `input` (correct).
 */
const PROVIDER_COST_PER_1K_TOKENS: Record<
  string,
  { input: number; cachedInput: number; output: number }
> = {
  'anthropic/claude-sonnet-4-6': {
    input: 0.003,
    cachedInput: 0.0003,
    output: 0.015,
  },
  'anthropic/claude-haiku-4-5-20251001': {
    // Rates from docs/superpowers/notes/2026-04-14-rate-lookups.md (confirmed 2026-04-15)
    input: 0.001,
    cachedInput: 0.0001,
    output: 0.005,
  },
};

/**
 * Insert one row into `usage_records`. Never throws — failures log to
 * stderr so the LLM response isn't blocked by a billing-table write.
 *
 * `source` is set to `platform_agent` because Phase 1 only calls this
 * from the chat route. Maintenance Agent and autonomous loop will pass
 * a different source in Phase 2.
 */
export async function recordUsage(params: RecordUsageParams): Promise<void> {
  const rates = PROVIDER_COST_PER_1K_TOKENS[params.modelId];
  if (!rates) {
    console.warn(`[usage] unknown model rates: ${params.modelId}`);
    return;
  }

  const cached = params.cachedInputTokens ?? 0;
  const uncachedInput = Math.max(0, params.inputTokens - cached);
  const providerCostUsd =
    (uncachedInput / 1000) * rates.input +
    (cached / 1000) * rates.cachedInput +
    (params.outputTokens / 1000) * rates.output;
  const customerCostUsd = providerCostUsd * (1 + MARKUP);

  // Split provider-prefixed model id into `provider` + `model` columns.
  const [providerSlug, ...modelParts] = params.modelId.split('/');
  const modelName = modelParts.join('/') || params.modelId;

  try {
    await db.insert(usageRecords).values({
      companyId: params.companyId,
      sessionId: params.sessionId,
      userId: params.userId,
      model: modelName,
      provider: providerSlug,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      totalTokens: params.totalTokens,
      providerCostUsd,
      customerCostUsd,
      source: 'platform_agent',
      metadata: cached > 0 ? { cachedInputTokens: cached } : {},
    });
  } catch (err) {
    console.error('[usage] insert failed', err);
  }
}
