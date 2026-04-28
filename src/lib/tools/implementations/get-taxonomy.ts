// get_taxonomy — discovery tool for external agents.
//
// Returns the workspace's folders (slugs + descriptions), document
// types (names + descriptions), allowed topic vocabulary, and the
// source-format hint. Cacheable for the duration of a session;
// taxonomy changes infrequently.
//
// Tool description copy is the literal product surface — see
// docs/superpowers/specs/refined-focus/2026-04-25-tatara-mcp-tool-surface.md.

import {
  FOLDERS,
  FOLDER_DESCRIPTIONS,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_DESCRIPTIONS,
  SOURCE_PREFIXES,
} from '@/lib/document-standard/constants';
import { getTaxonomy } from '@/lib/taxonomy/get';
import { TERM_DESCRIPTIONS } from '@/lib/taxonomy/default-vocabulary';
import type { LocusTool, ToolContext, ToolResult } from '../types';

interface GetTaxonomyOutput {
  folders: { slug: string; description: string }[];
  types: { type: string; description: string }[];
  topics: { term: string; description: string }[];
  synonyms: Record<string, string>;
  source_format: string;
}

export const getTaxonomyTool: LocusTool<{}, GetTaxonomyOutput> = {
  name: 'get_taxonomy',
  description:
    "Returns the workspace's allowed folders, document types, and topic " +
    'vocabulary. Cache the result for the duration of your session — taxonomy ' +
    'changes infrequently. Call once at the start of any session that may ' +
    'write to the brain. Without taxonomy, you cannot construct valid documents.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },

  action: 'read' as const,
  resourceType: 'document' as const,

  isReadOnly() {
    return true;
  },

  async call(
    _input: {},
    context: ToolContext,
  ): Promise<ToolResult<GetTaxonomyOutput>> {
    const vocab = await getTaxonomy(context.brainId);

    return {
      success: true,
      data: {
        folders: FOLDERS.map((slug) => ({
          slug,
          description: FOLDER_DESCRIPTIONS[slug],
        })),
        types: DOCUMENT_TYPES.map((type) => ({
          type,
          description: DOCUMENT_TYPE_DESCRIPTIONS[type],
        })),
        topics: vocab.terms.map((term) => ({
          term,
          // TERM_DESCRIPTIONS only covers default terms; admin-extended
          // terms (out of scope for v1) get an empty description until
          // the admin UI captures them.
          description:
            (TERM_DESCRIPTIONS as Record<string, string>)[term] ?? '',
        })),
        synonyms: vocab.synonyms,
        source_format: `Use "${SOURCE_PREFIXES[0]}<your-name>" if you are an agent (e.g., "agent:claude-code"), or "${SOURCE_PREFIXES[1]}<username>" if you are a human (e.g., "human:angus").`,
      },
      metadata: { responseTokens: 0, executionMs: 0, documentsAccessed: [] },
    };
  },
};
