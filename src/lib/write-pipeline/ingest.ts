// Single merge point for document writes (spec §8.1). Phase 1 contains
// only one stage: rule-based compact_index population. Phase 3 adds
// frontmatter-triple parsing here; Phase 4 the Maintenance Agent calls
// the same function with authored_by='maintenance_agent'.
//
// Harness-pure. No Next.js / Vercel imports. Callable from route
// handlers, cron handlers, tests, benchmarks.

import type { CompactIndex } from '@/lib/memory/types';
import { extractCompactIndex } from '@/lib/memory/compact-index/extract';

export interface WriteIngestInput {
  content: string;
  frontmatterEntities: string[];
}

/**
 * Compute the CompactIndex that should land in `documents.compact_index`
 * on insert or update. Caller is responsible for the actual DB write.
 */
export function populateCompactIndexForWrite(
  input: WriteIngestInput,
): CompactIndex {
  return extractCompactIndex(input.content, {
    entities: input.frontmatterEntities,
  });
}
