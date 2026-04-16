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

    // ---- Check for path collision ----------------------------------------
    // `documents.path` has no unique DB constraint (slug uniqueness within
    // a folder is the enforced invariant), but two docs at the same path
    // within a brain is a corruption we must prevent. Check proactively so
    // we can return a clean PATH_TAKEN error instead of an ambiguous slug
    // error from the DB's folder-scoped unique index.
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

    // ---- Insert document -------------------------------------------------
    let doc: typeof documents.$inferSelect;
    try {
      const rows = await db
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
          metadata: { outbound_links: parseOutboundLinks(input.body) },
          version: 1,
        })
        .returning();
      doc = rows[0];
    } catch (e) {
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

    // ---- Write initial version row ---------------------------------------
    await db.insert(documentVersions).values({
      companyId: context.companyId,
      documentId: doc.id,
      versionNumber: 1,
      content: input.body,
      changeSummary: 'created by agent',
      changedBy: context.actor.id,
      changedByType: 'agent',
      metadataSnapshot: {
        title: doc.title,
        status: doc.status,
        confidenceLevel: doc.confidenceLevel,
      },
    });

    // ---- Side effects (best-effort) -------------------------------------
    await tryRegenerateManifest(context.brainId);
    maybeScheduleSkillManifestRebuild(context.companyId, documentType);

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
