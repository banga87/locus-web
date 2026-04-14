// Firecrawl usage recorder. Writes to usage_records with provider='firecrawl'
// and tokens=0. USD math uses a hardcoded per-credit cost tied to the Firecrawl
// plan Locus is on at launch (see docs/superpowers/notes/2026-04-14-rate-lookups.md).
// Currently on free tier → $0 per credit. Update when upgrading to a paid plan.

import { db } from '@/db';
import { usageRecords } from '@/db/schema';
import { MARKUP } from './markup';

/**
 * USD cost of one Firecrawl credit on Locus's current plan.
 * Hardcoded per spec: no env-variable sourcing for v1.
 * Free tier → 0. Update this constant if Locus changes plans.
 */
export const FIRECRAWL_COST_PER_CREDIT_USD = 0;

interface RecordFirecrawlUsageParams {
  companyId: string;
  sessionId: string | null;
  userId: string | null;
  tool: 'web_search' | 'web_fetch';
  credits: number;
  url?: string;
}

/**
 * Insert one row into usage_records for a Firecrawl API call. Never
 * throws — failures log to stderr so the tool response isn't blocked by
 * a billing-table write.
 */
export async function recordFirecrawlUsage(
  params: RecordFirecrawlUsageParams,
): Promise<void> {
  const providerCostUsd = params.credits * FIRECRAWL_COST_PER_CREDIT_USD;
  const customerCostUsd = providerCostUsd * (1 + MARKUP);

  const metadata: Record<string, unknown> = {
    tool: params.tool,
    credits: params.credits,
  };
  if (params.url) metadata.url = params.url;

  try {
    await db.insert(usageRecords).values({
      companyId: params.companyId,
      sessionId: params.sessionId,
      userId: params.userId,
      model: null,
      provider: 'firecrawl',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      providerCostUsd,
      customerCostUsd,
      source: 'platform_agent',
      metadata,
    });
  } catch (err) {
    console.error('[usage] firecrawl insert failed', err);
  }
}
