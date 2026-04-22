// search_documents — delegates to src/lib/memory/core.retrieve().
//
// Contract: keep the existing output shape compatible for agents that
// were wired to the pre-refactor tool. We add `provenance` as an
// additional field per result; existing fields (path, title, snippet,
// relevance_score, folder) remain.

import { tataraHybridProvider } from '@/lib/memory/providers/tatara-hybrid';
import type { Provenance } from '@/lib/memory/types';
import type { LocusTool, ToolContext, ToolResult } from '../types';

interface SearchDocumentsInput {
  query: string;
  folder?: string;
  max_results?: number;
}

interface SearchResult {
  path: string;
  title: string;
  snippet: string;
  relevance_score: number;
  folder: string | null;
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

export const searchDocumentsTool: LocusTool<
  SearchDocumentsInput,
  SearchDocumentsOutput
> = {
  name: 'search_documents',
  description:
    'Full-text search over the brain. Returns ranked paths + snippets ' +
    'with provenance. Filter by folder slug, cap with max_results.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1 },
      folder: { type: 'string', minLength: 1 },
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
    const results = await tataraHybridProvider.retrieve({
      brainId: context.brainId,
      companyId: context.companyId,
      query: input.query,
      mode: 'hybrid',
      tierCeiling: 'extracted',
      limit: input.max_results ?? 10,
      filters: input.folder ? { folderPath: input.folder } : undefined,
    });

    const shaped: SearchResult[] = results.map((r) => ({
      path: r.provenance.path,
      title: r.title,
      snippet: r.snippet.text,
      relevance_score: r.score,
      folder: extractFolderFromPath(r.provenance.path),
      provenance: r.provenance,
    }));

    return {
      success: true,
      data: { query: input.query, results: shaped },
      metadata: {
        responseTokens: 0,
        executionMs: 0,
        documentsAccessed: results.map((r) => r.documentId),
        details: {
          eventType: 'document.search',
          folder: input.folder ?? null,
          resultCount: shaped.length,
          query: input.query,
        },
      },
    };
  },
};
