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
  /**
   * Where the call originated. Defaults to `platform_agent` when omitted
   * so existing Phase 1 call-sites (chat route onFinish) stay correct
   * without change. Subagent harness call-sites must pass `'subagent'`
   * plus `parentUsageRecordId` so attribution queries can roll up spend
   * per conversational turn.
   */
  source?: 'platform_agent' | 'maintenance_agent' | 'mcp' | 'system' | 'subagent';
  /**
   * FK to the parent LLM call's `usage_records.id`. Null for top-level
   * calls; required for subagent invocations so we can sum parent +
   * child spend in one turn. See 2026-04-19 subagent harness spec §7.
   */
  parentUsageRecordId?: string | null;
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
 *
 * Both the legacy hyphen+date ids and the Gateway-format dotted ids are
 * listed because Phase 1 call-sites still pass the hyphenated form while
 * the subagent harness (Phase 2) standardises on `APPROVED_MODELS`
 * which uses dots. A missing rate silently logs "unknown model rates"
 * and returns `null`, so every model used in production MUST have an
 * entry here.
 */
const PROVIDER_COST_PER_1K_TOKENS: Record<
  string,
  { input: number; cachedInput: number; output: number }
> = {
  // Legacy hyphen+date ids still passed by the Phase 1 chat route.
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

  // Gateway-format dotted ids (APPROVED_MODELS — src/lib/models/approved-models.ts).
  'anthropic/claude-haiku-4.5': {
    input: 0.001,
    cachedInput: 0.0001,
    output: 0.005,
  },
  'anthropic/claude-sonnet-4.6': {
    input: 0.003,
    cachedInput: 0.0003,
    output: 0.015,
  },
  'anthropic/claude-opus-4.7': {
    input: 0.005,
    cachedInput: 0.0005,
    output: 0.025,
  },
  'google/gemini-2.5-flash-lite': {
    // Source: locus-brain/research/model-selection-analysis.md.
    // $0.10 in / $0.40 out per 1M tokens; cache $0.01 per 1M.
    input: 0.0001,
    cachedInput: 0.00001,
    output: 0.0004,
  },
  'google/gemini-2.5-flash': {
    input: 0.0003,
    cachedInput: 0.00003,
    output: 0.0025,
  },
  'google/gemini-2.5-pro': {
    // Tiered pricing; this is the <=200k input rate. Over-200k callers must
    // price-adjust before inserting — track in S3 follow-up.
    input: 0.00125,
    cachedInput: 0.000125,
    output: 0.010,
  },
};

/**
 * Insert one row into `usage_records` and return its id. Never throws —
 * failures log to stderr and return `null` so the LLM response isn't
 * blocked by a billing-table write.
 *
 * Returns `{ id }` for the inserted row so subagent call-sites can pass
 * it as `parentUsageRecordId` on child inserts. Returns `null` when the
 * model id is unknown or the insert fails.
 */
export async function recordUsage(
  params: RecordUsageParams,
): Promise<{ id: string } | null> {
  const rates = PROVIDER_COST_PER_1K_TOKENS[params.modelId];
  if (!rates) {
    console.warn(`[usage] unknown model rates: ${params.modelId}`);
    return null;
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
    const [row] = await db
      .insert(usageRecords)
      .values({
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
        source: params.source ?? 'platform_agent',
        parentUsageRecordId: params.parentUsageRecordId ?? null,
        metadata: cached > 0 ? { cachedInputTokens: cached } : {},
      })
      .returning({ id: usageRecords.id });
    return row ?? null;
  } catch (err) {
    console.error('[usage] insert failed', err);
    return null;
  }
}
