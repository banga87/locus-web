// GET /api/brain/documents — list documents for the caller's brain.
// POST /api/brain/documents — create a new (user-authored, non-core) document.
//
// Auth: Viewer+ on GET, Editor+ on POST. All queries scoped by brainId
// (defence in depth — RLS enforces the same boundary at the DB).
//
// POST side-effects: creates an initial `document_versions` row and fires
// a manifest regeneration (best-effort).

import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import yaml from 'js-yaml';
import { z } from 'zod';

import { db } from '@/db';
import { documents, documentVersions, folders } from '@/db/schema';
import { requireRole } from '@/lib/api/auth';
import { withAuth, requireCompany } from '@/lib/api/handler';
import { decodeCursor, encodeCursor } from '@/lib/api/pagination';
import { created, error, paginated } from '@/lib/api/response';
import { parseOutboundLinks } from '@/lib/brain-pulse/markdown-links';
import { getBrainForCompany } from '@/lib/brain/queries';
import { validateWorkflowFrontmatter } from '@/lib/brain/frontmatter';
import { tryRegenerateManifest } from '@/lib/brain/manifest-regen';
import {
  extractDocumentTypeFromContent,
  maybeScheduleSkillManifestRebuild,
} from '@/lib/brain/save';
import {
  getAttachment,
  markCommitted,
} from '@/lib/ingestion/attachments';

const SLUG_RE = /^[a-z0-9-]+$/;

const listQuerySchema = z.object({
  folderId: z.string().uuid().optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  isCore: z.enum(['true', 'false']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(500),
  slug: z.string().regex(SLUG_RE, 'slug must match /^[a-z0-9-]+$/'),
  content: z.string(),
  folderId: z.string().uuid(),
  summary: z.string().optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  confidenceLevel: z.enum(['high', 'medium', 'low']).optional(),
  // Phase 1.5 Task 8: when the proposal being approved originated
  // from an extracted attachment, the client forwards the attachment
  // id. On a successful create we flip the attachment's status to
  // `committed` and link `committed_doc_id` → new doc. Optional —
  // non-ingestion proposals (agent-authored drafts) omit this field.
  attachmentId: z.string().uuid().optional(),
});

export const GET = (req: Request) =>
  withAuth(async (ctx) => {
    const companyId = requireCompany(ctx);
    if (typeof companyId !== 'string') return companyId;

    const url = new URL(req.url);
    const parsed = listQuerySchema.safeParse(
      Object.fromEntries(url.searchParams),
    );
    if (!parsed.success) {
      return error('invalid_query', 'Invalid query parameters.', 400, parsed.error.issues);
    }
    const q = parsed.data;

    const brain = await getBrainForCompany(companyId);

    // User-document listing: the `type IS NULL` filter keeps
    // scaffolding/skills/agent-definitions out of the main brain view.
    const conds = [
      eq(documents.brainId, brain.id),
      isNull(documents.deletedAt),
      isNull(documents.type),
    ];
    if (q.folderId) conds.push(eq(documents.folderId, q.folderId));
    if (q.status) conds.push(eq(documents.status, q.status));
    if (q.isCore !== undefined) conds.push(eq(documents.isCore, q.isCore === 'true'));

    if (q.cursor) {
      try {
        const cur = decodeCursor<{ updatedAt: string; id: string }>(q.cursor);
        const cursorDate = new Date(cur.updatedAt);
        // (updated_at, id) < (cursorUpdatedAt, cursorId) in desc order
        conds.push(
          or(
            lt(documents.updatedAt, cursorDate),
            and(eq(documents.updatedAt, cursorDate), lt(documents.id, cur.id)),
          )!,
        );
      } catch {
        return error('invalid_cursor', 'Cursor is malformed.', 400);
      }
    }

    const rows = await db
      .select()
      .from(documents)
      .where(and(...conds))
      .orderBy(desc(documents.updatedAt), desc(documents.id))
      .limit(q.limit + 1);

    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ updatedAt: last.updatedAt.toISOString(), id: last.id })
        : null;

    return paginated(page, nextCursor);
  });

export const POST = (req: Request) =>
  withAuth(async (ctx) => {
    requireRole(ctx, 'editor');
    const companyId = requireCompany(ctx);
    if (typeof companyId !== 'string') return companyId;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return error('invalid_json', 'Request body must be JSON.', 400);
    }

    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return error('invalid_body', 'Invalid document.', 400, parsed.error.issues);
    }
    const input = parsed.data;

    const brain = await getBrainForCompany(companyId);

    // Folder must belong to the same brain.
    const [folder] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, input.folderId), eq(folders.brainId, brain.id)))
      .limit(1);
    if (!folder) {
      return error('folder_not_found', 'Folder does not belong to your brain.', 400);
    }

    // Validate the optional attachment id before the transaction —
    // a mismatched tenant is a 400, not a silent skip. Deferring the
    // `markCommitted` call until AFTER the insert succeeds so we
    // never commit an attachment against a doc that failed to create.
    if (input.attachmentId) {
      const attachment = await getAttachment(input.attachmentId, companyId);
      if (!attachment) {
        return error(
          'attachment_not_found',
          'Attachment does not exist or belongs to a different company.',
          400,
        );
      }
    }

    const path = `${folder.slug}/${input.slug}`;

    // Phase 1.5: mirror the frontmatter `type` field into the
    // denormalised column so manifest rebuilds + agent-scaffolding
    // lookups can hit the index instead of parsing content.
    const documentType = extractDocumentTypeFromContent(input.content);

    // Phase 1.5 workflow-doc frontmatter sync: mirrors the PATCH route's
    // logic (see /api/brain/documents/[id]/route.ts). When the new doc is a
    // workflow, parse the YAML body and seed metadata with the authored
    // fields so the trigger route's preflight reads the right values on the
    // very first run — without this, a freshly-created workflow doc has no
    // `output`/`requires_mcps` in metadata and every Run click fails
    // validation until the doc is saved at least once.
    //
    // Silent-skip policy: invalid YAML or an invalid workflow frontmatter
    // shape does not block creation. Trigger-time validation catches bad
    // shapes at run time.
    let workflowMetadata: Record<string, unknown> = {};
    if (documentType === 'workflow') {
      const fmMatch = input.content.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        try {
          const parsed = yaml.load(fmMatch[1]) as unknown;
          const validated = validateWorkflowFrontmatter(parsed);
          if (validated.ok) {
            workflowMetadata = {
              output: validated.value.output,
              output_category: validated.value.output_category,
              requires_mcps: validated.value.requires_mcps,
              schedule: validated.value.schedule,
            };
          }
        } catch {
          // YAML parse error — skip sync; trigger-time validation will catch it.
        }
      }
    }

    try {
      const [doc] = await db
        .insert(documents)
        .values({
          companyId,
          brainId: brain.id,
          folderId: input.folderId,
          title: input.title,
          slug: input.slug,
          path,
          content: input.content,
          summary: input.summary ?? null,
          status: input.status ?? 'draft',
          confidenceLevel: input.confidenceLevel ?? 'medium',
          isCore: false,
          ownerId: ctx.userId,
          type: documentType,
          metadata: {
            outbound_links: parseOutboundLinks(input.content),
            ...workflowMetadata,
          },
          version: 1,
        })
        .returning();

      await db.insert(documentVersions).values({
        companyId,
        documentId: doc.id,
        versionNumber: 1,
        content: input.content,
        changeSummary: 'created',
        changedBy: ctx.userId,
        changedByType: 'human',
        metadataSnapshot: {
          title: doc.title,
          status: doc.status,
          confidenceLevel: doc.confidenceLevel,
        },
      });

      await tryRegenerateManifest(brain.id);
      maybeScheduleSkillManifestRebuild(companyId, documentType);

      // Transition the originating attachment (if any) to `committed`.
      // Fire-and-forget: if the update fails, the doc has still been
      // created — the attachment will linger at `extracted` and a
      // future maintenance pass can reconcile. We log but do not fail
      // the request on this step.
      if (input.attachmentId) {
        try {
          await markCommitted(input.attachmentId, doc.id);
        } catch (err) {
          console.error('[api/brain/documents] markCommitted failed', err);
        }
      }

      return created(doc);
    } catch (e) {
      // Unique slug violation etc.
      const msg = e instanceof Error ? e.message : String(e);
      if (/unique|duplicate/i.test(msg)) {
        return error('slug_conflict', 'A document with that slug already exists.', 409);
      }
      throw e;
    }
  });
