// search_documents — PostgreSQL full-text search over a brain's documents.
//
// Uses the `search_vector` tsvector column (populated by the Postgres
// trigger defined in migration 0002) with `ts_rank` + `ts_headline` for
// relevance + snippet. Filters: brain scope, non-deleted, non-archived,
// optional category slug.

import { sql } from 'drizzle-orm';

import { db } from '@/db';
import type { LocusTool, ToolContext, ToolResult } from '../types';

interface SearchDocumentsInput {
  query: string;
  category?: string;
  max_results?: number;
}

interface SearchResult {
  path: string;
  title: string;
  snippet: string;
  relevance_score: number;
  category: string | null;
}

interface SearchDocumentsOutput {
  query: string;
  results: SearchResult[];
}

interface SearchRow {
  path: string;
  title: string;
  snippet: string;
  rank: string | number;
  category_slug: string | null;
  id: string;
}

export const searchDocumentsTool: LocusTool<
  SearchDocumentsInput,
  SearchDocumentsOutput
> = {
  name: 'search_documents',
  description:
    'Full-text search over the brain. Returns ranked paths + snippets. ' +
    'Filter by category slug, cap with max_results.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1 },
      category: { type: 'string', minLength: 1 },
      max_results: { type: 'integer', minimum: 1, maximum: 50 },
    },
    required: ['query'],
    additionalProperties: false,
  },

  isReadOnly() {
    return true;
  },

  async call(
    input: SearchDocumentsInput,
    context: ToolContext,
  ): Promise<ToolResult<SearchDocumentsOutput>> {
    const query = input.query;
    const maxResults = input.max_results ?? 10;
    const categoryFilter = input.category ?? null;

    // `plainto_tsquery` is more lenient than `to_tsquery` — it escapes
    // operators for us so the caller can pass natural-language queries.
    // Join through categories by slug when a filter is supplied; left-join
    // always so results surface the category slug for the response.
    const rows = (await db.execute(sql`
      SELECT
        d.id,
        d.path,
        d.title,
        ts_headline(
          'english',
          d.content,
          plainto_tsquery('english', ${query}),
          'MaxWords=35, MinWords=15'
        ) AS snippet,
        ts_rank(d.search_vector, plainto_tsquery('english', ${query})) AS rank,
        c.slug AS category_slug
      FROM documents d
      LEFT JOIN categories c ON c.id = d.category_id
      WHERE d.brain_id = ${context.brainId}
        AND d.search_vector @@ plainto_tsquery('english', ${query})
        AND d.deleted_at IS NULL
        AND d.status != 'archived'
        ${categoryFilter ? sql`AND c.slug = ${categoryFilter}` : sql``}
      ORDER BY rank DESC
      LIMIT ${maxResults}
    `)) as unknown as SearchRow[];

    const results: SearchResult[] = rows.map((row) => ({
      path: row.path,
      title: row.title,
      snippet: row.snippet ?? '',
      relevance_score:
        typeof row.rank === 'number' ? row.rank : Number(row.rank),
      category: row.category_slug,
    }));

    return {
      success: true,
      data: { query, results },
      metadata: {
        // The executor overwrites these; we set them so the shape matches.
        responseTokens: 0,
        executionMs: 0,
        documentsAccessed: rows.map((r) => r.id),
        details: {
          eventType: 'document.search',
          category: categoryFilter,
          resultCount: results.length,
          query,
        },
      },
    };
  },
};
