// Confidence-weighted freshness tiers for brain documents.
//
// A document's trust value decays with time, but not at a uniform rate:
// high-confidence canonical docs (mission statements, core brand voice) are
// expected to stay stable for months, while low-confidence scratchpads drift
// fast. The sidebar + article-view dim aging/stale docs as a trust signal —
// users should see at a glance which knowledge is probably out of date.
//
// Tier boundaries (inclusive of the lower bound — "aging" starts the day the
// doc hits `aging` days old):
//
//   | Confidence | Fresh       | Aging        | Stale      |
//   |------------|-------------|--------------|------------|
//   | high       | < 90 days   | 90–180 days  | > 180 days |
//   | medium     | < 60 days   | 60–120 days  | > 120 days |
//   | low        | < 30 days   | 30–60 days   | > 60 days  |
//
// Consumers:
//   - src/components/shell/brain-tree.tsx  — DocNode `data-freshness` attr
//   - (Task 7) src/components/brain/article-view.tsx — meta-row dot

export type Freshness = 'fresh' | 'aging' | 'stale';
export type Confidence = 'high' | 'medium' | 'low';

const THRESHOLDS: Record<Confidence, { aging: number; stale: number }> = {
  high: { aging: 90, stale: 180 },
  medium: { aging: 60, stale: 120 },
  low: { aging: 30, stale: 60 },
};

/**
 * Classify a document's age into a freshness tier.
 *
 * @param updatedAt ISO 8601 timestamp of the last update.
 * @param confidence Confidence level from the manifest; missing/unknown
 *   values fall back to the `medium` tier — the conservative middle ground.
 * @param now Override for the "current time" reference (primarily for tests;
 *   defaults to `new Date()` at call time in production).
 */
export function getFreshness(
  updatedAt: string,
  confidence: Confidence | undefined,
  now: Date = new Date(),
): Freshness {
  const tier = THRESHOLDS[confidence ?? 'medium'];
  const ageDays =
    (now.getTime() - new Date(updatedAt).getTime()) / 86400_000;
  if (ageDays >= tier.stale) return 'stale';
  if (ageDays >= tier.aging) return 'aging';
  return 'fresh';
}
