// Pure topics validator. Used by:
//   - The master document validator (./document-standard/validate.ts)
//   - Phase 3A's MCP write tools (when they enforce topic validity)
//
// No DB calls. The vocabulary blob is passed in by the caller — they
// are responsible for fetching it via `getTaxonomy(brainId)` once per
// request and reusing the result.

import type { Vocabulary } from './types';

export interface ValidateTopicsOk {
  ok: true;
  /** Topics in their canonical form. v1 is just a copy of input
   *  because we reject (rather than auto-normalise) aliases. Future
   *  versions may auto-normalise — keeping the field on the result
   *  shape now means callers won't need to change. */
  canonical: string[];
}

export interface ValidateTopicsRejection {
  topic: string;
  /** When non-null, the user's alias mapped to a canonical term —
   *  agents echo this back as a "did you mean X?" hint. */
  synonymOf: string | null;
}

export interface ValidateTopicsErr {
  ok: false;
  rejected: ValidateTopicsRejection[];
}

export type ValidateTopicsResult = ValidateTopicsOk | ValidateTopicsErr;

const MIN_TOPICS = 1;
const MAX_TOPICS = 5;

export function validateTopics(
  input: unknown,
  vocabulary: Vocabulary,
): ValidateTopicsResult {
  if (!Array.isArray(input)) {
    return {
      ok: false,
      rejected: [{ topic: '_', synonymOf: null }],
    };
  }
  if (input.length < MIN_TOPICS || input.length > MAX_TOPICS) {
    return {
      ok: false,
      rejected: input
        .filter((t): t is string => typeof t === 'string')
        .map((t) => ({ topic: t, synonymOf: vocabulary.synonyms[t] ?? null })),
    };
  }

  const valid = new Set(vocabulary.terms);
  const rejected: ValidateTopicsRejection[] = [];
  for (const t of input) {
    if (typeof t !== 'string') {
      rejected.push({ topic: String(t), synonymOf: null });
      continue;
    }
    if (valid.has(t)) continue;
    rejected.push({ topic: t, synonymOf: vocabulary.synonyms[t] ?? null });
  }
  if (rejected.length > 0) return { ok: false, rejected };
  return { ok: true, canonical: [...input] };
}
