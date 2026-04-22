//
// Precedence-based per-field merge of CompactIndex values from multiple
// sources. Per spec §8.2:
//   human > generating_agent > maintenance_agent > rule_based
//
// For each field, pick the value from the highest-precedence source
// that provided a non-empty value.

import type { AuthoredBy, CompactIndex } from '../types';

const ORDER: Record<AuthoredBy, number> = {
  human: 4,
  generating_agent: 3,
  maintenance_agent: 2,
  rule_based: 1,
};

function empty(v: unknown): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'string') return v.length === 0;
  return false;
}

export function mergeCompactIndex(
  inputs: CompactIndex[],
): CompactIndex {
  // Sort descending by precedence so we iterate highest-first.
  const sorted = [...inputs].sort(
    (a, b) => ORDER[b.authored_by] - ORDER[a.authored_by],
  );

  const fields = [
    'entities',
    'topics',
    'flags',
    'proper_nouns',
    'date_hints',
    'key_sentence',
  ] as const;

  const result: CompactIndex = {
    entities: [],
    topics: [],
    flags: [],
    proper_nouns: [],
    key_sentence: '',
    date_hints: [],
    authored_by: 'rule_based',
    computed_at: new Date().toISOString(),
  };

  let winningAuthor: AuthoredBy = 'rule_based';
  let anyFieldSet = false;

  for (const f of fields) {
    for (const src of sorted) {
      if (!empty(src[f])) {
        // deep-copy arrays; strings copy by value
        (result as any)[f] = Array.isArray(src[f])
          ? [...(src[f] as string[])]
          : src[f];
        if (ORDER[src.authored_by] > ORDER[winningAuthor]) {
          winningAuthor = src.authored_by;
        }
        anyFieldSet = true;
        break;
      }
    }
  }

  if (anyFieldSet) result.authored_by = winningAuthor;
  return result;
}
