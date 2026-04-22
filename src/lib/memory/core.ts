// src/lib/memory/core.ts
//
// retrieve() — the single entry point for document retrieval. Pure
// TypeScript, DB-only. Callable from route handlers, cron, tests,
// benchmarks.
//
// Phase 1: lexical (tsvector) + compact_index + scoring boosts.
// Phase 2 will add pgvector; Phase 3 adds kg_query and tier-gated
// triple retrieval. tierCeiling is already plumbed here so Phase 3
// needs no signature change.

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import type {
  CompactIndex,
  RankedResult,
  RetrieveQuery,
} from './types';
import { composeBoostedScore } from './scoring/compose';

interface RawRow {
  id: string;
  slug: string;
  title: string;
  path: string;
  content: string;
  // postgres.js returns timestamps as ISO-8601 strings via db.execute()
  // (the typed Drizzle query path coerces; raw SQL does not). Coerce
  // once at the boundary and pass Date through the rest of the module.
  updated_at: Date | string;
  version: number;
  ts_rank: string | number;
  ts_headline: string;
  compact_index: CompactIndex | null;
  folder_slug: string | null;
}

function asDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

export async function retrieve(q: RetrieveQuery): Promise<RankedResult[]> {
  const limit = q.limit ?? 10;

  const rows = (await db.execute(sql`
    SELECT
      d.id,
      d.slug,
      d.title,
      d.path,
      d.content,
      d.updated_at,
      d.version,
      ts_rank(d.search_vector, plainto_tsquery('english', ${q.query})) AS ts_rank,
      ts_headline(
        'english',
        d.content,
        plainto_tsquery('english', ${q.query}),
        'MaxWords=35, MinWords=15'
      ) AS ts_headline,
      d.compact_index,
      f.slug AS folder_slug
    FROM documents d
    LEFT JOIN folders f ON f.id = d.folder_id
    WHERE d.company_id = ${q.companyId}
      AND d.brain_id = ${q.brainId}
      AND d.deleted_at IS NULL
      AND d.status != 'archived'
      AND d.type IS NULL
      AND d.search_vector @@ plainto_tsquery('english', ${q.query})
      ${q.filters?.folderPath ? sql`AND f.slug = ${q.filters.folderPath}` : sql``}
    ORDER BY ts_rank DESC
    LIMIT ${limit * 3}
  `)) as unknown as RawRow[];

  // Re-score with boost composition, then sort and truncate to limit.
  const scored = rows.map((r) => {
    const tsRank =
      typeof r.ts_rank === 'number' ? r.ts_rank : Number(r.ts_rank);
    const score = composeBoostedScore({
      tsRank,
      query: q.query,
      content: r.content,
      docUpdatedAt: asDate(r.updated_at),
    });
    return { row: r, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);

  return top.map(({ row, score }) => {
    const r = toResult(row, score, q.mode);
    r.provenance.brainId = q.brainId;
    return r;
  });
}

function toResult(
  row: RawRow,
  score: number,
  mode: RetrieveQuery['mode'],
): RankedResult {
  const base: RankedResult = {
    documentId: row.id,
    slug: row.slug,
    title: row.title,
    score,
    provenance: {
      brainId: '', // filled by caller
      path: row.path,
      updatedAt: asDate(row.updated_at).toISOString(),
      version: row.version,
      confidenceTier: 'extracted',
    },
    snippet: { mode: 'compact', text: '' },
  };

  if (mode === 'scan') {
    return {
      ...base,
      snippet: { mode: 'compact', text: serializeCompact(row.compact_index) },
      compactIndex: row.compact_index ?? undefined,
    };
  }

  // expand / hybrid are Tasks 18 and 19.
  throw new Error(`retrieve: mode "${mode}" not yet implemented`);
}

function serializeCompact(ci: CompactIndex | null): string {
  if (!ci) return '';
  const parts: string[] = [];
  if (ci.entities.length) parts.push(`entities: ${ci.entities.join(', ')}`);
  if (ci.topics.length) parts.push(`topics: ${ci.topics.join(', ')}`);
  if (ci.flags.length) parts.push(`flags: ${ci.flags.join(', ')}`);
  if (ci.key_sentence) parts.push(`"${ci.key_sentence}"`);
  return parts.join(' | ');
}
