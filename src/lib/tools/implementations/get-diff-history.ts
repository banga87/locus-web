// get_diff_history — brain-wide change feed since a timestamp.
//
// Returns one entry per document that has been updated after `since`.
// Each entry carries the latest version's summary plus, optionally, a
// short content preview.

import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { categories } from '@/db/schema/folders';
import { documentVersions } from '@/db/schema/document-versions';
import type { LocusTool, ToolContext, ToolResult } from '../types';

interface GetDiffHistoryInput {
  since: string;
  category?: string;
  include_content_preview?: boolean;
}

interface DiffEntry {
  path: string;
  change_type: string;
  changed_at: string;
  summary: string | null;
  preview?: string;
}

interface GetDiffHistoryOutput {
  since: string;
  changes: DiffEntry[];
}

const PREVIEW_CHARS = 200;

export const getDiffHistoryTool: LocusTool<
  GetDiffHistoryInput,
  GetDiffHistoryOutput
> = {
  name: 'get_diff_history',
  description:
    "List documents in this brain updated after `since`. Returns each " +
    "doc's most recent version summary; include_content_preview=true " +
    'adds the first 200 chars of current content.',
  inputSchema: {
    type: 'object',
    properties: {
      since: { type: 'string', format: 'date-time' },
      category: { type: 'string', minLength: 1 },
      include_content_preview: { type: 'boolean' },
    },
    required: ['since'],
    additionalProperties: false,
  },

  isReadOnly() {
    return true;
  },

  async call(
    input: GetDiffHistoryInput,
    context: ToolContext,
  ): Promise<ToolResult<GetDiffHistoryOutput>> {
    const since = new Date(input.since);
    if (Number.isNaN(since.getTime())) {
      return {
        success: false,
        error: {
          code: 'invalid_input',
          message: `'${input.since}' is not a valid ISO-8601 datetime.`,
          hint: 'Pass a timestamp like "2026-04-13T00:00:00Z".',
          retryable: false,
        },
        metadata: {
          responseTokens: 0,
          executionMs: 0,
          documentsAccessed: [],
          details: { eventType: 'document.diff_history' },
        },
      };
    }
    const includePreview = input.include_content_preview === true;

    // Gather documents matching the window + optional category slug. We
    // need both the document metadata and the latest version summary, so
    // do two queries (document list → version lookup for that id set) to
    // keep the SQL readable.
    const whereClauses = [
      eq(documents.brainId, context.brainId),
      isNull(documents.deletedAt),
      gt(documents.updatedAt, since),
    ];
    if (input.category) {
      whereClauses.push(eq(categories.slug, input.category));
    }

    const docs = await db
      .select({
        id: documents.id,
        path: documents.path,
        updatedAt: documents.updatedAt,
        content: documents.content,
        categorySlug: categories.slug,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .leftJoin(categories, eq(categories.id, documents.categoryId))
      .where(and(...whereClauses));

    const docIds = docs.map((d) => d.id);
    // Map of documentId -> latest changeSummary/versionNumber/createdAt.
    const latestVersions = new Map<
      string,
      {
        summary: string | null;
        versionNumber: number;
        createdAt: Date;
      }
    >();

    if (docIds.length > 0) {
      // Fetch versions for all matched docs, newest-first. We reduce in
      // JS to find the latest per document — cleaner than DISTINCT ON
      // and sidesteps any uuid[] cast quirks with the pg driver.
      const versionRows = await db
        .select({
          documentId: documentVersions.documentId,
          versionNumber: documentVersions.versionNumber,
          changeSummary: documentVersions.changeSummary,
          createdAt: documentVersions.createdAt,
        })
        .from(documentVersions)
        .where(inArray(documentVersions.documentId, docIds))
        .orderBy(desc(documentVersions.createdAt));

      for (const v of versionRows) {
        if (!latestVersions.has(v.documentId)) {
          latestVersions.set(v.documentId, {
            summary: v.changeSummary,
            versionNumber: v.versionNumber,
            createdAt: v.createdAt,
          });
        }
      }
    }

    const changes: DiffEntry[] = docs.map((d) => {
      const latest = latestVersions.get(d.id);
      // If no version exists (doc is brand-new or hasn't been saved via
      // the versioning path yet), treat the document row itself as the
      // change signal.
      const changeType = latest
        ? latest.versionNumber === 1
          ? 'created'
          : 'updated'
        : d.createdAt.getTime() === d.updatedAt.getTime()
          ? 'created'
          : 'updated';

      const entry: DiffEntry = {
        path: d.path,
        change_type: changeType,
        changed_at: d.updatedAt.toISOString(),
        summary: latest?.summary ?? null,
      };
      if (includePreview) {
        entry.preview = (d.content ?? '').slice(0, PREVIEW_CHARS);
      }
      return entry;
    });

    // Sort newest first for display.
    changes.sort((a, b) => (a.changed_at < b.changed_at ? 1 : -1));

    return {
      success: true,
      data: { since: input.since, changes },
      metadata: {
        responseTokens: 0,
        executionMs: 0,
        documentsAccessed: docs.map((d) => d.id),
        details: {
          eventType: 'document.diff_history',
          since: input.since,
          category: input.category ?? null,
          change_count: changes.length,
        },
      },
    };
  },
};
