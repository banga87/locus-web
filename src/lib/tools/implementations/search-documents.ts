// search_documents — delegates to src/lib/memory/core.retrieve().
//
// Contract: keep the existing output shape compatible for agents that
// were wired to the pre-refactor tool. We add `provenance` as an
// additional field per result; existing fields (path, title, snippet,
// relevance_score, folder) remain. Task 13 extends with type/topics/
// confidence post-filters via a joined SELECT after retrieval.

import { inArray } from 'drizzle-orm';
import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { DOCUMENT_TYPES } from '@/lib/document-standard/constants';
import { tataraHybridProvider } from '@/lib/memory/providers/tatara-hybrid';
import type { Provenance } from '@/lib/memory/types';
import type { LocusTool, ToolContext, ToolResult } from '../types';

interface SearchDocumentsInput {
  query: string;
  folder?: string;
  type?: string;
  topics?: string[];
  confidence_min?: 'low' | 'medium' | 'high';
  max_results?: number;
}

interface SearchResult {
  path: string;
  title: string;
  snippet: string;
  relevance_score: number;
  folder: string | null;
  type: string | null;
  topics: string[];
  confidence: 'low' | 'medium' | 'high' | null;
  provenance: Provenance;
}

interface SearchDocumentsOutput {
  query: string;
  results: SearchResult[];
}

function extractFolderFromPath(path: string): string | null {
  const i = path.indexOf('/');
  return i >= 0 ? path.slice(0, i) : null;
}

function rank(level: string | null): number {
  if (level === 'high') return 3;
  if (level === 'medium') return 2;
  if (level === 'low') return 1;
  return 0;
}

export const searchDocumentsTool: LocusTool<
  SearchDocumentsInput,
  SearchDocumentsOutput
> = {
  name: 'search_documents',
  description:
    'Full-text and semantic search across the Tatara brain. Returns ranked ' +
    'results with snippets, document ids, types, and confidence levels. ' +
    'Use when you need to locate information by content rather than by known ' +
    'path. Always run a search before proposing a new document — duplicates ' +
    'are common and the Maintenance Agent will flag them. ' +
    'Filters: type (canonical | decision | note | fact | procedure | entity | artifact), ' +
    'folder (/company | /customers | /market | /product | /marketing | /operations | /signals), ' +
    'topics (array of topic tags), confidence_min (low | medium | high), ' +
    'max_results (1–50, default 10).',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1 },
      folder: { type: 'string', minLength: 1 },
      type: { type: 'string', enum: [...DOCUMENT_TYPES] },
      topics: { type: 'array', items: { type: 'string' }, minItems: 1 },
      confidence_min: { type: 'string', enum: ['low', 'medium', 'high'] },
      max_results: { type: 'integer', minimum: 1, maximum: 50 },
    },
    required: ['query'],
    additionalProperties: false,
  },

  action: 'read' as const,
  resourceType: 'document' as const,

  isReadOnly() {
    return true;
  },

  async call(
    input: SearchDocumentsInput,
    context: ToolContext,
  ): Promise<ToolResult<SearchDocumentsOutput>> {
    const raw = await tataraHybridProvider.retrieve({
      brainId: context.brainId,
      companyId: context.companyId,
      query: input.query,
      mode: 'hybrid',
      tierCeiling: 'extracted',
      limit: input.max_results ?? 10,
      filters: input.folder ? { folderPath: input.folder } : undefined,
    });

    if (raw.length === 0) {
      return {
        success: true,
        data: { query: input.query, results: [] },
        metadata: {
          responseTokens: 0,
          executionMs: 0,
          documentsAccessed: [],
          details: {
            eventType: 'document.search',
            folder: input.folder ?? null,
            type: input.type ?? null,
            topics: input.topics ?? null,
            confidence_min: input.confidence_min ?? null,
            resultCount: 0,
            query: input.query,
          },
        },
      };
    }

    // Join to get type/topics/confidenceLevel for the retrieved doc IDs.
    const docIds = raw.map((r) => r.documentId);
    const docRows = await db
      .select({
        id: documents.id,
        type: documents.type,
        topics: documents.topics,
        confidenceLevel: documents.confidenceLevel,
      })
      .from(documents)
      .where(inArray(documents.id, docIds));

    const docFields = new Map(
      docRows.map((d) => [
        d.id,
        {
          type: d.type,
          topics: (d.topics ?? []) as string[],
          confidence: d.confidenceLevel as 'low' | 'medium' | 'high',
        },
      ]),
    );

    const minRank = input.confidence_min ? rank(input.confidence_min) : 0;

    const filtered = raw.filter((r) => {
      const fields = docFields.get(r.documentId);
      if (!fields) return false; // doc deleted between retrieve and select
      if (input.type && fields.type !== input.type) return false;
      if (input.topics && input.topics.length > 0) {
        if (!input.topics.every((t) => fields.topics.includes(t))) return false;
      }
      if (input.confidence_min && rank(fields.confidence) < minRank) {
        return false;
      }
      return true;
    });

    const shaped: SearchResult[] = filtered.map((r) => {
      const fields = docFields.get(r.documentId)!;
      return {
        path: r.provenance.path,
        title: r.title,
        snippet: r.snippet.text,
        relevance_score: r.score,
        folder: extractFolderFromPath(r.provenance.path),
        type: fields.type,
        topics: fields.topics,
        confidence: fields.confidence,
        provenance: r.provenance,
      };
    });

    return {
      success: true,
      data: { query: input.query, results: shaped },
      metadata: {
        responseTokens: 0,
        executionMs: 0,
        documentsAccessed: filtered.map((r) => r.documentId),
        details: {
          eventType: 'document.search',
          folder: input.folder ?? null,
          type: input.type ?? null,
          topics: input.topics ?? null,
          confidence_min: input.confidence_min ?? null,
          resultCount: shaped.length,
          query: input.query,
        },
      },
    };
  },
};
