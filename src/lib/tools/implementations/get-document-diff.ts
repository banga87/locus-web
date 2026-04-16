// get_document_diff — recent version history for a single document.
//
// Returns the most recent N rows from `document_versions`, newest first,
// with each row reduced to a short "change" entry. Empty array if the
// document has no versioned history yet.

import { and, desc, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { documentVersions } from '@/db/schema/document-versions';
import type { LocusTool, ToolContext, ToolResult } from '../types';

interface GetDocumentDiffInput {
  document_id: string;
  limit?: number;
}

interface VersionChange {
  version: number;
  change_type: string;
  changed_at: string;
  summary: string | null;
  changed_by: string;
}

interface GetDocumentDiffOutput {
  document_id: string;
  document_path: string;
  changes: VersionChange[];
}

export const getDocumentDiffTool: LocusTool<
  GetDocumentDiffInput,
  GetDocumentDiffOutput
> = {
  name: 'get_document_diff',
  description:
    'Return up to `limit` most-recent version rows for a document, newest ' +
    'first. Empty array if the document has no version history.',
  inputSchema: {
    type: 'object',
    properties: {
      document_id: { type: 'string', format: 'uuid' },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    },
    required: ['document_id'],
    additionalProperties: false,
  },

  action: 'read' as const,
  resourceType: 'document' as const,

  isReadOnly() {
    return true;
  },

  async call(
    input: GetDocumentDiffInput,
    context: ToolContext,
  ): Promise<ToolResult<GetDocumentDiffOutput>> {
    const limit = input.limit ?? 10;

    // Fetch the document itself first so we can return its path + confirm
    // it's in the actor's brain. A missing doc is the same `not_found`
    // shape get_document uses.
    const docRows = await db
      .select({
        id: documents.id,
        path: documents.path,
      })
      .from(documents)
      .where(
        and(
          eq(documents.id, input.document_id),
          eq(documents.brainId, context.brainId),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);

    const doc = docRows[0];
    if (!doc) {
      return {
        success: false,
        error: {
          code: 'document_not_found',
          message: `No document matches id '${input.document_id}' in this brain.`,
          hint: 'Confirm the id via search_documents or get_document.',
          retryable: false,
        },
        metadata: {
          responseTokens: 0,
          executionMs: 0,
          documentsAccessed: [],
          details: {
            eventType: 'document.diff',
            document_id: input.document_id,
            found: false,
          },
        },
      };
    }

    const versions = await db
      .select({
        versionNumber: documentVersions.versionNumber,
        createdAt: documentVersions.createdAt,
        changeSummary: documentVersions.changeSummary,
        changedBy: documentVersions.changedBy,
        changedByType: documentVersions.changedByType,
      })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, doc.id))
      .orderBy(desc(documentVersions.createdAt))
      .limit(limit);

    const changes: VersionChange[] = versions.map((v) => ({
      version: v.versionNumber,
      // Pre-MVP only stores full snapshots — everything surfaces as an
      // "updated" entry. Creation of the first version shows as "created"
      // to give agents a clearer narrative.
      change_type: v.versionNumber === 1 ? 'created' : 'updated',
      changed_at: v.createdAt.toISOString(),
      summary: v.changeSummary,
      changed_by: v.changedBy,
    }));

    return {
      success: true,
      data: {
        document_id: doc.id,
        document_path: doc.path,
        changes,
      },
      metadata: {
        responseTokens: 0,
        executionMs: 0,
        documentsAccessed: [doc.id],
        details: {
          eventType: 'document.diff',
          document_id: doc.id,
          version_count: changes.length,
        },
      },
    };
  },
};
