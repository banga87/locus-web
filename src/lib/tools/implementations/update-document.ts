// update_document — agent-authored partial update to an existing document.
//
// Accepts a `path` (preferred) or `documentId` to identify the target,
// plus any subset of the user-editable fields. Increments `version`,
// writes a `document_versions` snapshot, and fires manifest regeneration —
// the same operations the PATCH /api/brain/documents/[id] route performs.
//
// Reserved / system-managed fields are explicitly excluded from the input
// schema (additionalProperties: false + no path/version/updated_at/
// created_by_workflow* keys). The executor's ajv validation enforces this
// before `call()` is reached.
//
// At least one editable field must be present. The tool enforces this at
// runtime because JSON Schema `minProperties` counts all properties
// including `path`/`documentId`, which aren't content changes.
//
// On doc-not-found the tool returns { error: { code: 'DOCUMENT_NOT_FOUND' } }
// rather than throwing — mirrors the create tool's non-throwing error contract.

import { and, eq, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { documents, documentVersions } from '@/db/schema';
import { extractDocumentTypeFromContent, maybeScheduleSkillManifestRebuild } from '@/lib/brain/save';
import { tryRegenerateManifest } from '@/lib/brain/manifest-regen';
import { parseOutboundLinks } from '@/lib/brain-pulse/markdown-links';
import type { LocusTool, ToolContext, ToolResult } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UpdateDocumentInput {
  // Exactly one identifier required — enforced at runtime.
  path?: string;
  documentId?: string;
  // Editable fields — at least one required alongside the identifier.
  title?: string;
  body?: string;
  status?: 'draft' | 'active' | 'archived';
  confidenceLevel?: 'high' | 'medium' | 'low';
  summary?: string | null;
}

interface UpdateDocumentOutput {
  documentId: string;
  path: string;
  title: string;
  version: number;
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

/** Fields that are identifiers, not content edits. */
const IDENTIFIER_KEYS = new Set(['path', 'documentId']);

export const updateDocumentTool: LocusTool<
  UpdateDocumentInput,
  UpdateDocumentOutput
> = {
  name: 'update_document',
  description:
    'Partially update an existing brain document. ' +
    'Supply `path` OR `documentId` to identify the target (not both). ' +
    'Provide any subset of: title, body, status, confidenceLevel, summary. ' +
    'At least one editable field is required. ' +
    'System fields (path, version, updated_at, created_by_workflow, etc.) ' +
    'are not accepted — the system manages them automatically.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        minLength: 1,
        description: 'Document path, e.g. "brand/brand-voice-guide".',
      },
      documentId: {
        type: 'string',
        format: 'uuid',
        description: 'Document UUID. Use path instead if you have it.',
      },
      title: { type: 'string', minLength: 1, maxLength: 500 },
      body: { type: 'string', description: 'Full replacement markdown content.' },
      status: { type: 'string', enum: ['draft', 'active', 'archived'] },
      confidenceLevel: { type: 'string', enum: ['high', 'medium', 'low'] },
      summary: { type: ['string', 'null'] },
    },
    additionalProperties: false,
    // NOTE: "exactly one of path/documentId" and "at least one editable field"
    // are enforced at runtime in call() rather than via JSON Schema — ajv
    // doesn't support these cross-field constraints without oneOf/if-then,
    // and Anthropic's tool input_schema rejects those constructs.
  },

  action: 'write' as const,
  resourceType: 'document' as const,

  isReadOnly() {
    return false;
  },

  async call(
    input: UpdateDocumentInput,
    context: ToolContext,
  ): Promise<ToolResult<UpdateDocumentOutput>> {
    // ---- Validate: exactly one identifier --------------------------------
    const hasPath =
      typeof input.path === 'string' && input.path.length > 0;
    const hasId =
      typeof input.documentId === 'string' && input.documentId.length > 0;

    if (hasPath === hasId) {
      return {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: hasPath
            ? 'Provide exactly one of `path` or `documentId`, not both.'
            : 'Provide exactly one of `path` or `documentId`.',
          hint: 'Use `path` when you know the document path (e.g. "brand/brand-voice"). Use `documentId` when you have the UUID.',
          retryable: false,
        },
        metadata: { responseTokens: 0, executionMs: 0, documentsAccessed: [] },
      };
    }

    // ---- Validate: at least one editable field ---------------------------
    const editableKeys = Object.keys(input).filter(
      (k) => !IDENTIFIER_KEYS.has(k),
    );
    if (editableKeys.length === 0) {
      return {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message:
            'At least one editable field is required (title, body, status, confidenceLevel, or summary).',
          retryable: false,
        },
        metadata: { responseTokens: 0, executionMs: 0, documentsAccessed: [] },
      };
    }

    // ---- Lookup existing document ----------------------------------------
    const whereClause = hasId
      ? and(
          eq(documents.id, input.documentId!),
          eq(documents.brainId, context.brainId),
          isNull(documents.deletedAt),
        )
      : and(
          eq(documents.path, input.path!),
          eq(documents.brainId, context.brainId),
          isNull(documents.deletedAt),
        );

    const [existing] = await db
      .select()
      .from(documents)
      .where(whereClause)
      .limit(1);

    if (!existing) {
      const target = hasPath
        ? `path "${input.path}"`
        : `id "${input.documentId}"`;
      return {
        success: false,
        error: {
          code: 'DOCUMENT_NOT_FOUND',
          message: `No document matches ${target} in this brain.`,
          hint: 'Call search_documents to discover valid paths.',
          retryable: false,
        },
        metadata: { responseTokens: 0, executionMs: 0, documentsAccessed: [] },
      };
    }

    // ---- Compute update set ---------------------------------------------
    const nextVersion = existing.version + 1;
    const nextContent = input.body ?? existing.content;

    // Re-derive the denormalised `type` column when content changes.
    const newType =
      input.body !== undefined
        ? extractDocumentTypeFromContent(input.body)
        : existing.type;
    const typeUpdate =
      input.body !== undefined ? { type: newType } : {};

    // Recompute outbound links when content changes; preserve other metadata.
    // Also merge workflow last-touched stamps if this call originates from a
    // workflow run. Stamps are written inside the transaction for atomicity.
    // The stamp fields are intentionally NOT in the user-facing input schema
    // (additionalProperties: false) — they travel via ToolContext.workflowRunContext.
    const workflowStamp = context.workflowRunContext
      ? {
          last_touched_by_workflow: context.workflowRunContext.workflowDocRef,
          last_touched_by_workflow_run_id: context.workflowRunContext.runId,
        }
      : {};

    const metadataUpdate =
      input.body !== undefined
        ? {
            metadata: {
              ...((existing.metadata as Record<string, unknown> | null) ?? {}),
              outbound_links: parseOutboundLinks(input.body),
              ...workflowStamp,
            },
          }
        : Object.keys(workflowStamp).length > 0
          ? {
              metadata: {
                ...((existing.metadata as Record<string, unknown> | null) ?? {}),
                ...workflowStamp,
              },
            }
          : {};

    const changeSummary = `updated by agent: ${editableKeys.join(', ')}`;

    // ---- Atomic update: document row + version snapshot -----------------
    // Wrapped in a transaction so a crash between the two writes can't
    // leave the `documents.version` column incremented with no matching
    // `document_versions` row. Side effects run AFTER commit — they're
    // best-effort and should not hold a transaction open across network
    // I/O.
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(documents)
        .set({
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.body !== undefined ? { content: input.body } : {}),
          ...(input.summary !== undefined ? { summary: input.summary } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.confidenceLevel !== undefined
            ? { confidenceLevel: input.confidenceLevel }
            : {}),
          ...typeUpdate,
          ...metadataUpdate,
          version: nextVersion,
          // Use DB clock (now()) rather than app-clock new Date() — same
          // discipline as status.ts. `documents.createdAt`/`updatedAt` are
          // defaultNow() on insert, so reads in either direction end up
          // comparing like-clock timestamps. Scope: only this one field
          // in this one file — other updatedAt writes elsewhere in the
          // codebase are unchanged by this fix.
          updatedAt: sql`now()`,
        })
        .where(eq(documents.id, existing.id))
        .returning();

      // `.returning()` should always yield the single updated row. Guard
      // against an empty array to convert an "impossible" condition into
      // a controlled error rather than an opaque undefined-access.
      if (!row) {
        throw new Error('documents update returned no row');
      }

      await tx.insert(documentVersions).values({
        companyId: context.companyId,
        documentId: existing.id,
        versionNumber: nextVersion,
        content: nextContent,
        changeSummary,
        changedBy: context.actor.id,
        changedByType: 'agent',
        metadataSnapshot: {
          title: row.title,
          status: row.status,
          confidenceLevel: row.confidenceLevel,
        },
      });

      return row;
    });

    // ---- Side effects (best-effort, outside the transaction) ------------
    await tryRegenerateManifest(context.brainId);
    // Fire on both old and new type so skill manifest stays consistent when
    // a doc is re-typed (e.g. knowledge → skill or vice-versa).
    maybeScheduleSkillManifestRebuild(context.companyId, existing.type);
    if (newType !== existing.type) {
      maybeScheduleSkillManifestRebuild(context.companyId, newType);
    }
    // Invalidate the layout tree so the sidebar picks up title/status/
    // folder/pin changes on the next nav without a hard reload. Swallow
    // the invariant when called outside a Next request context (tests,
    // post-flush waitUntil) — same rationale as create-document.
    try {
      revalidatePath('/', 'layout');
    } catch {
      // no-op
    }

    return {
      success: true,
      data: {
        documentId: updated.id,
        path: updated.path,
        title: updated.title,
        version: updated.version,
      },
      metadata: {
        responseTokens: 0,
        executionMs: 0,
        documentsAccessed: [updated.id],
        details: {
          eventType: 'document.update',
          path: updated.path,
          changedFields: editableKeys,
        },
      },
    };
  },
};
