//
// Multiplicative boost that favors documents whose updated_at is close
// to a date mentioned in the query. Max 1.4x at zero distance, decays
// geometrically with day-distance; floored at 1.0.

import { extractDateHints } from '../compact-index/date-hints';

const MAX_BOOST = 1.4;
const HALF_LIFE_DAYS = 180;

export function temporalProximity(
  query: string,
  docUpdatedAt: Date,
): number {
  const queryDates = extractDateHints(query);
  if (queryDates.length === 0) return 1.0;

  const docMs = docUpdatedAt.getTime();
  let best = 1.0;
  for (const iso of queryDates) {
    const qMs = new Date(iso).getTime();
    if (Number.isNaN(qMs)) continue;
    const days = Math.abs(docMs - qMs) / (1000 * 60 * 60 * 24);
    const decay = Math.pow(0.5, days / HALF_LIFE_DAYS);
    const boost = 1.0 + (MAX_BOOST - 1.0) * decay;
    if (boost > best) best = boost;
  }
  return best;
}
