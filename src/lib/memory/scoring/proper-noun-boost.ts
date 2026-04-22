//
// Multiplicative boost applied when proper nouns from the query appear
// verbatim in the document content. Reuses the proper-noun extractor
// so query-side and doc-side share one definition.

import { extractProperNouns } from '../compact-index/proper-nouns';

const PER_MATCH = 1.4;
const CAP = 2.0;

export function properNounBoost(query: string, content: string): number {
  const queryNouns = extractProperNouns(query);
  if (queryNouns.length === 0) return 1.0;

  let multiplier = 1.0;
  for (const n of queryNouns) {
    if (content.includes(n)) {
      multiplier *= PER_MATCH;
      if (multiplier >= CAP) return CAP;
    }
  }
  return Math.min(multiplier, CAP);
}
