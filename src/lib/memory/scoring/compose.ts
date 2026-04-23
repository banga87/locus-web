//
// Compose a final retrieval score by combining lexical (ts_rank) and
// semantic (cosine similarity) base scores with multiplicative boosts
// (phrase, proper noun, temporal proximity).
//
// Phase 1 shipped lexical-only (WEIGHT_VEC=0 implicit). Phase 2 adds
// the cosineSim term. Default weights are hand-tuned starting points
// (semantic-leaning); per-brain overrides land in Phase 3 with
// brain_configs. Optional `weights` parameter lets the benchmark
// runner toggle WEIGHT_VEC=0 for baseline runs without changing
// production defaults.

import { phraseBoost } from './phrase-boost';
import { properNounBoost } from './proper-noun-boost';
import { temporalProximity } from './temporal-proximity';

// Defaults are hand-tuned (semantic-leaning); per-brain overrides land
// in Phase 3 with brain_configs. The MEMORY_WEIGHT_TS / MEMORY_WEIGHT_VEC
// env vars exist solely so the benchmark runner can compare lexical-only
// vs hybrid without code changes — they are NOT a tenant-facing tuning
// knob (that would violate the plug-and-play UX principle).
function envWeight(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const DEFAULT_WEIGHT_TS = envWeight('MEMORY_WEIGHT_TS', 0.4);
export const DEFAULT_WEIGHT_VEC = envWeight('MEMORY_WEIGHT_VEC', 0.6);

export interface ComposeInput {
  tsRank: number;
  query: string;
  content: string;
  docUpdatedAt: Date;
  cosineSim?: number | null;
  weights?: { ts?: number; vec?: number };
}

export function composeBoostedScore(input: ComposeInput): number {
  const wTs = input.weights?.ts ?? DEFAULT_WEIGHT_TS;
  const wVec = input.weights?.vec ?? DEFAULT_WEIGHT_VEC;
  const cosine = input.cosineSim ?? 0;

  const baseScore = wTs * input.tsRank + wVec * cosine;

  const boosts =
    phraseBoost(input.query, input.content) *
    properNounBoost(input.query, input.content) *
    temporalProximity(input.query, input.docUpdatedAt);

  return baseScore * boosts;
}
