//
// Composes the three boost primitives into a single multiplier applied
// to tsRank. Phase 2 will add embedding similarity as an additive term
// with its own weight; Phase 1 is lexical + boosts only.

import { phraseBoost } from './phrase-boost';
import { properNounBoost } from './proper-noun-boost';
import { temporalProximity } from './temporal-proximity';

export interface ComposeInput {
  tsRank: number;
  query: string;
  content: string;
  docUpdatedAt: Date;
}

export function composeBoostedScore(input: ComposeInput): number {
  const { tsRank, query, content, docUpdatedAt } = input;
  const m =
    phraseBoost(query, content) *
    properNounBoost(query, content) *
    temporalProximity(query, docUpdatedAt);
  return tsRank * m;
}
