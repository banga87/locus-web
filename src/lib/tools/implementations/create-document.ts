// create_document — agent-authored document creation.
//
// This is a thin wrapper over the same DB operations the
// POST /api/brain/documents route performs. The tool validates input
// shape via its JSON Schema (ajv, run by the executor before `call()`),
// resolves the folder from the path's leading segment, inserts the
// document + initial version row, and fires manifest regeneration.
//
// Path shape: "{folder_slug}/{doc_slug}" — the tool accepts this as a
// single string and splits on the first `/`. The folder must already
// exist in the brain; the tool does NOT create folders. Doc slug is
// derived from the path's trailing segment and must match /^[a-z0-9-]+$/.
//
// Reserved frontmatter fields are NOT accepted as input — the system
// manages `path`, `version`, `updated_at`, `created_by_workflow`, etc.
// Pass them and the executor's ajv schema will reject the call before
// `call()` is reached (additionalProperties: false).
//
// On duplicate path the tool returns { error: { code: 'PATH_TAKEN' } }
// rather than throwing — the caller can suggest a different slug without
// a noisy exception trace.
//
// Actor plumbing: `context.actor.id` is written as `changedBy` in the
// version row and as `ownerId` on the document (platform_agent writes
// set the requesting user as the owner via `AgentActor.userId`). This
// mirrors what the route does with `ctx.userId`.

import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { documents, documentVersions } from '@/db/schema';
import { folders } from '@/db/schema/folders';
import { extractDocumentTypeFromContent, maybeScheduleSkillManifestRebuild } from '@/lib/brain/save';
import { tryRegenerateManifest } from '@/lib/brain/manifest-regen';
import { parseOutboundLinks } from '@/lib/brain-pulse/markdown-links';
import type { LocusTool, ToolContext, ToolResult } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreateDocumentInput {
  path: string;
  title: string;
  body: string;
  status?: 'draft' | 'active' | 'archived';
  confidenceLevel?: 'high' | 'medium' | 'low';
  summary?: string;
}

interface CreateDocumentOutput {
  documentId: string;
  path: string;
  title: string;
  version: number;
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9-]+$/;

export const createDocumentTool: LocusTool<
  CreateDocumentInput,
  CreateDocumentOutput
> = {
  name: 'create_document',
  description:
    'Create a new brain document at the given path. ' +
    '`path` must be "{folder_slug}/{doc_slug}" — the folder must already exist. ' +
    'Both segments must match /^[a-z0-9-]+$/. ' +
    'Returns the new document id, path, title, and version (always 1). ' +
    'Fails with PATH_TAKEN if a document at that path already exists.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        minLength: 3,
        description: '"{folder_slug}/{doc_slug}" — both segments must match /^[a-z0-9-]+$/',
      },
      title: { type: 'string', minLength: 1, maxLength: 500 },
      body: { type: 'string', description: 'Markdown content body.' },
      status: { type: 'string', enum: ['draft', 'active', 'archived'] },
      confidenceLevel: { type: 'string', enum: ['high', 'medium', 'low'] },
      summary: { type: 'string' },
    },
    required: ['path', 'title', 'body'],
    additionalProperties: false,
  },

  action: 'write' as const,
  resourceType: 'document' as const,

  isReadOnly() {
    return false;
  },

  async call(
    input: CreateDocumentInput,
    context: ToolContext,
  ): Promise<ToolResult<CreateDocumentOutput>> {
    // ---- Parse and validate path shape -----------------------------------
    const slashIdx = input.path.indexOf('/');
    if (slashIdx <= 0 || slashIdx === input.path.length - 1) {
      return {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message:
            'path must be "{folder_slug}/{doc_slug}" with exactly one "/" separator.',
          hint: 'Example: "brand/brand-voice-guide"',
          retryable: false,
        },
        metadata: { responseTokens: 0, executionMs: 0, documentsAccessed: [] },
      };
    }

    const folderSlug = input.path.slice(0, slashIdx);
    const docSlug = input.path.slice(slashIdx + 1);

    if (!SLUG_RE.test(folderSlug) || !SLUG_RE.test(docSlug)) {
      return {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message:
            'Both the folder slug and doc slug must match /^[a-z0-9-]+$/. ' +
            `Got folder="${folderSlug}", doc="${docSlug}".`,
          hint: 'Use lowercase letters, digits, and hyphens only.',
          retryable: false,
        },
        metadata: { responseTokens: 0, executionMs: 0, documentsAccessed: [] },
      };
    }

    // ---- Resolve folder --------------------------------------------------
    const [folder] = await db
      .select({ id: folders.id, brainId: folders.brainId })
      .from(folders)
      .where(
        and(
          eq(folders.slug, folderSlug),
          eq(folders.brainId, context.brainId),
        ),
      )
      .limit(1);

    if (!folder) {
      return {
        success: false,
        error: {
          code: 'FOLDER_NOT_FOUND',
          message: `No folder with slug "${folderSlug}" exists in this brain.`,
          hint: 'Use search_documents or list_folders to discover valid folder slugs.',
          retryable: false,
        },
        metadata: { responseTokens: 0, executionMs: 0, documentsAccessed: [] },
      };
    }

    // ---- Check for path collision (fast-fail for friendlier UX) ---------
    // The DB-level partial unique index `documents_brain_slug_live_unique`
    // (migration 0016) is the authoritative guard against duplicate paths
    // within a brain. This proactive SELECT lets us return PATH_TAKEN
    // without a DB-error roundtrip in the common case; the transaction
    // below still catches the TOCTOU race where a concurrent insert lands
    // between this SELECT and our INSERT.
    const [existing] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.path, input.path),
          eq(documents.brainId, context.brainId),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);

    if (existing) {
      return {
        success: false,
        error: {
          code: 'PATH_TAKEN',
          message: `A document already exists at path "${input.path}".`,
          hint: 'Choose a different doc slug (the last segment of the path).',
          retryable: false,
        },
        metadata: {
          responseTokens: 0,
          executionMs: 0,
          documentsAccessed: [],
        },
      };
    }

    // ---- Derive document type from frontmatter (if body contains it) -----
    const documentType = extractDocumentTypeFromContent(input.body);

    // ---- Resolve owner id -----------------------------------------------
    // Only actor types that map to a real `users` row can be stored as
    // `owner_id` — human and platform_agent actors carry the user's UUID.
    // Agent-token actors carry the token id, which is NOT in `users`, so
    // we leave ownerId null to avoid a FK violation.
    const ownerId =
      context.actor.type === 'human' || context.actor.type === 'platform_agent'
        ? context.actor.id
        : null;

    // ---- Atomic insert: document row + initial version row --------------
    // Wrapped in a transaction so a crash between the two inserts can't
    // leave a documents row with no matching document_versions row.
    // Side effects (manifest regeneration, skill-manifest rebuild) run
    // AFTER commit — they're best-effort and should not hold a
    // transaction open across network I/O.
    let doc: typeof documents.$inferSelect;
    try {
      doc = await db.transaction(async (tx) => {
        // Merge workflow provenance stamps into metadata if this call
        // originates from a workflow run. Stamps are written inside the
        // transaction so they're atomic with the document insert — no
        // separate UPDATE needed. The stamp fields are intentionally NOT
        // in the user-facing input schema (additionalProperties: false),
        // which is why they travel via ToolContext rather than input.
        const workflowStamp = context.workflowRunContext
          ? {
              created_by_workflow: context.workflowRunContext.workflowDocRef,
              created_by_workflow_run_id: context.workflowRunContext.runId,
            }
          : {};

        const [inserted] = await tx
          .insert(documents)
          .values({
            companyId: context.companyId,
            brainId: context.brainId,
            folderId: folder.id,
            title: input.title,
            slug: docSlug,
            path: input.path,
            content: input.body,
            summary: input.summary ?? null,
            status: input.status ?? 'draft',
            confidenceLevel: input.confidenceLevel ?? 'medium',
            isCore: false,
            ownerId,
            type: documentType,
            metadata: { outbound_links: parseOutboundLinks(input.body), ...workflowStamp },
            version: 1,
          })
          .returning();

        // `.returning()` should always give us exactly one row for a
        // successful INSERT ... VALUES (single row). A guard here converts
        // an "impossible" empty-array result into a controlled error
        // instead of an opaque "Cannot read properties of undefined".
        if (!inserted) {
          throw new Error('documents insert returned no row');
        }

        await tx.insert(documentVersions).values({
          companyId: context.companyId,
          documentId: inserted.id,
          versionNumber: 1,
          content: input.body,
          changeSummary: 'created by agent',
          changedBy: context.actor.id,
          changedByType: 'agent',
          metadataSnapshot: {
            title: inserted.title,
            status: inserted.status,
            confidenceLevel: inserted.confidenceLevel,
          },
        });

        return inserted;
      });
    } catch (e) {
      // TOCTOU race: a concurrent create landed at the same
      // (brain_id, slug) between our proactive SELECT and the INSERT. The
      // partial unique index `documents_brain_slug_live_unique` rejects
      // it; surface the same clean PATH_TAKEN the proactive check returns.
      const msg = e instanceof Error ? e.message : String(e);
      if (/unique|duplicate/i.test(msg)) {
        return {
          success: false,
          error: {
            code: 'PATH_TAKEN',
            message: `A document already exists at path "${input.path}".`,
            hint: 'Choose a different doc slug (the last segment of the path).',
            retryable: false,
          },
          metadata: {
            responseTokens: 0,
            executionMs: 0,
            documentsAccessed: [],
          },
        };
      }
      throw e;
    }

    // ---- Side effects (best-effort, outside the transaction) ------------
    await tryRegenerateManifest(context.brainId);
    maybeScheduleSkillManifestRebuild(context.companyId, documentType);
    // Invalidate the layout's server-side tree so the next nav/refresh sees
    // the new doc in the sidebar. Without this, a workflow-created document
    // is only visible after a hard reload even though it's queryable by id.
    //
    // Swallow the "static generation store missing" invariant — `revalidatePath`
    // throws outside a Next.js request context (unit tests, and also
    // `waitUntil` after the response has flushed). Skipping there is safe:
    // the user will still see the doc on their next full navigation because
    // the Server Component re-queries on each request.
    try {
      revalidatePath('/', 'layout');
    } catch {
      // no-op
    }

    return {
      success: true,
      data: {
        documentId: doc.id,
        path: doc.path,
        title: doc.title,
        version: doc.version,
      },
      metadata: {
        responseTokens: 0,
        executionMs: 0,
        documentsAccessed: [doc.id],
        details: {
          eventType: 'document.create',
          path: doc.path,
        },
      },
    };
  },
};
