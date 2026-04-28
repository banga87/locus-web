// Persisted vocabulary shape — what lives in `brains.topic_vocabulary`
// (jsonb) and what `get_taxonomy` returns. Pure data, no behaviour.

export interface Vocabulary {
  /** Sorted (by spec order, not alphabetical) list of canonical terms. */
  terms: string[];
  /** Alias → canonical term. Empty for v1 if the workspace has not
   *  configured custom synonyms — the default map ships pre-populated. */
  synonyms: Record<string, string>;
  /** Vocabulary version. Bumped when an admin extends the list. v1
   *  default is 1. */
  version: number;
}
