// get_diff_history — brain-wide change feed since a timestamp.
//
// Returns one entry per document that has been updated after `since`.
// Each entry carries the latest version's summary plus, optionally, a
// short content preview.

import { and, desc, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';

import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { folders } from '@/db/schema/folders';
import { documentVersions } from '@/db/schema/document-versions';
import type { LocusTool, ToolContext, ToolResult } from '../types';

interface GetDiffHistoryInput {
  since: string;
  folder?: string;
  include_content_preview?: boolean;
  limit?: number;
  cursor?: string;
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
  next_cursor: string | null;
}

const PREVIEW_CHARS = 200;

export const getDiffHistoryTool: LocusTool<
  GetDiffHistoryInput,
  GetDiffHistoryOutput
> = {
  name: 'get_diff_history',
  description:
    "List documents in this brain updated after `since`, newest-first. " +
    "Returns each doc's most recent version summary; " +
    "include_content_preview=true adds the first 200 chars of content. " +
    'Paginates via opaque `cursor`; default `limit` is 50, max 500. ' +
    'Pass `next_cursor` verbatim on subsequent calls to advance.',
  inputSchema: {
    type: 'object',
    properties: {
      since: { type: 'string', format: 'date-time' },
      folder: { type: 'string', minLength: 1 },
      include_content_preview: { type: 'boolean' },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      cursor: { type: 'string', minLength: 1 },
    },
    required: ['since'],
    additionalProperties: false,
  },

  action: 'read' as const,

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
    const limit = input.limit ?? 50;

    // Decode cursor (if present) before building the query. Malformed
    // cursors surface as invalid_input — can't be expressed in JSON Schema
    // since the payload is opaque.
    let cursor: CursorPayload | null = null;
    if (typeof input.cursor === 'string') {
      cursor = decodeCursor(input.cursor);
      if (cursor === null) {
        return {
          success: false,
          error: {
            code: 'invalid_input',
            message: `'${input.cursor}' is not a valid cursor.`,
            hint:
              "Pass 'cursor' verbatim from the previous response's 'next_cursor', or omit it to start from the beginning.",
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
    }

    // `isNull(documents.type)` restricts results to user-authored
    // documents — scaffolding/skills/agent-definitions carry a non-null
    // `type` and should never surface in the change feed.
    const whereClauses = [
      eq(documents.brainId, context.brainId),
      isNull(documents.deletedAt),
      isNull(documents.type),
      gt(documents.updatedAt, since),
    ];
    if (input.folder) {
      whereClauses.push(eq(folders.slug, input.folder));
    }
    if (cursor) {
      // Keyset predicate: rows strictly "after" the cursor in the
      // (updatedAt DESC, id DESC) ordering. Note: since stays ANDed at
      // the top level and never relaxes — a stale cursor whose t <= since
      // naturally produces an empty page.
      const cursorTime = new Date(cursor.t);
      whereClauses.push(
        or(
          lt(documents.updatedAt, cursorTime),
          and(
            eq(documents.updatedAt, cursorTime),
            lt(documents.id, cursor.id),
          ),
        )!,
      );
    }

    // Fetch limit+1 so we can detect whether another page exists without
    // a second query. Sort DESC on both keys for the keyset to work.
    const docs = await db
      .select({
        id: documents.id,
        path: documents.path,
        updatedAt: documents.updatedAt,
        content: documents.content,
        folderSlug: folders.slug,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .leftJoin(folders, eq(folders.id, documents.folderId))
      .where(and(...whereClauses))
      .orderBy(desc(documents.updatedAt), desc(documents.id))
      .limit(limit + 1);

    // Trim and build next_cursor. `docs` came back DESC-ordered, so the
    // last kept row's (updatedAt, id) is the cursor for the next page.
    const hasMore = docs.length > limit;
    const kept = hasMore ? docs.slice(0, limit) : docs;
    let nextCursor: string | null = null;
    if (hasMore) {
      const last = kept[kept.length - 1];
      nextCursor = encodeCursor({
        t: last.updatedAt.toISOString(),
        id: last.id,
      });
    }

    // Versions lookup runs on the kept set only.
    const docIds = kept.map((d) => d.id);
    const latestVersions = new Map<
      string,
      { summary: string | null; versionNumber: number; createdAt: Date }
    >();

    if (docIds.length > 0) {
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

    const changes: DiffEntry[] = kept.map((d) => {
      const latest = latestVersions.get(d.id);
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

    // No post-sort needed — the DB already returned DESC-ordered rows.

    return {
      success: true,
      data: { since: input.since, changes, next_cursor: nextCursor },
      metadata: {
        responseTokens: 0,
        executionMs: 0,
        documentsAccessed: kept.map((d) => d.id),
        details: {
          eventType: 'document.diff_history',
          since: input.since,
          folder: input.folder ?? null,
          limit,
          has_cursor: cursor !== null,
          returned_count: changes.length,
        },
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Cursor codec
// ---------------------------------------------------------------------------

/**
 * Opaque cursor shape. Callers never see the JSON — they receive and
 * replay `next_cursor` verbatim. Format is base64-encoded JSON with
 * `t` (ISO-8601 timestamp of the last row's updatedAt) and `id`
 * (documents.id of the same row, never a joined-row id).
 */
interface CursorPayload {
  t: string;
  id: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

function decodeCursor(raw: string): CursorPayload | null {
  try {
    const json = Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as { t?: unknown }).t !== 'string' ||
      typeof (parsed as { id?: unknown }).id !== 'string'
    ) {
      return null;
    }
    const { t, id } = parsed as CursorPayload;
    const parsedDate = new Date(t);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString() !== t) {
      return null;
    }
    if (!UUID_RE.test(id)) return null;
    return { t, id };
  } catch {
    return null;
  }
}
