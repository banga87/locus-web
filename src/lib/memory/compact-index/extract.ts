//
// The main rule-based extractor. Composes the five field extractors
// into a CompactIndex. authored_by is always 'rule_based' from this
// function — higher-precedence sources (generating agents, humans,
// Maintenance Agent) use merge() to stamp their own authored_by.

import type { CompactIndex } from '../types';
import { extractProperNouns } from './proper-nouns';
import { extractKeySentence } from './key-sentence';
import { extractFlags } from './flags';
import { extractDateHints } from './date-hints';
import { extractTopics } from './topics';

export interface ExtractOptions {
  // Entities are not rule-extracted in Phase 1 — they come from
  // frontmatter (Phase 3) or are left empty. Explicit pass-through.
  entities: string[];
}

export function extractCompactIndex(
  content: string,
  options: ExtractOptions,
): CompactIndex {
  return {
    entities: options.entities,
    topics: extractTopics(content),
    flags: extractFlags(content),
    proper_nouns: extractProperNouns(content),
    key_sentence: extractKeySentence(content),
    date_hints: extractDateHints(content),
    authored_by: 'rule_based',
    computed_at: new Date().toISOString(),
  };
}
