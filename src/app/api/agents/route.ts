// GET /api/agents — list agent-definition docs for the caller's brain.
// POST /api/agents — create a new agent-definition via the wizard schema.
//
// Agent-definitions are plain brain documents (`documents.type =
// 'agent-definition'`). We reuse the existing `documents` table — no
// new schema. Writes flow through the same auth gate + manifest
// regeneration trigger as any other brain doc.
//
// Brain resolution: pre-MVP ships one brain per company. We resolve the
// brain via `getBrainForCompany(companyId)` — the same pattern used by
// `src/app/api/brain/documents/route.ts`. When multi-brain lands, both
// routes will take an explicit brain identifier together.
//
// Auth: Viewer+ on GET (everyone can see what agents exist),
// Editor+ on POST (writing a new agent is a knowledge-base edit).
// No agent-runtime access — the agent harness must NOT be able to
// hit `/api/agents`; CRUD over agent-definitions is a human surface
// only. See `AGENTS.md` (harness boundary) for rationale.

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { documents, documentVersions } from '@/db/schema';
import { requireRole } from '@/lib/api/auth';
import { withAuth, requireCompany } from '@/lib/api/handler';
import { created, error, success } from '@/lib/api/response';
import { getBrainForCompany } from '@/lib/brain/queries';
import { tryRegenerateManifest } from '@/lib/brain/manifest-regen';

import { buildAgentDefinitionDoc } from '@/lib/agents/definitions';
import { agentWizardInputSchema } from '@/lib/agents/wizard-schema';

// Stable path namespace for agent-definition docs. Category is NULL
// for agent-definitions (they're system configuration, not knowledge
// to be filed); we still need a non-null `path` since the column is
// `NOT NULL`. `agents/<slug>` is the conceptual address and keeps the
// MCP path lookup surface consistent.
const AGENT_PATH_PREFIX = 'agents/';

export const GET = () =>
  withAuth(async (ctx) => {
    const companyId = requireCompany(ctx);
    if (typeof companyId !== 'string') return companyId;

    const brain = await getBrainForCompany(companyId);

    const rows = await db
      .select({
        id: documents.id,
        title: documents.title,
        slug: documents.slug,
        path: documents.path,
        content: documents.content,
        status: documents.status,
        type: documents.type,
        version: documents.version,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .where(
        and(
          eq(documents.brainId, brain.id),
          eq(documents.type, 'agent-definition'),
          isNull(documents.deletedAt),
        ),
      );

    return success({ agents: rows });
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

    const parsed = agentWizardInputSchema.safeParse(body);
    if (!parsed.success) {
      return error(
        'invalid_body',
        'Invalid agent-definition input.',
        400,
        parsed.error.issues,
      );
    }
    const input = parsed.data;

    const brain = await getBrainForCompany(companyId);

    // Select-first guard for slug uniqueness within this brain. The
    // `(brain_id, slug)` unique index does NOT exist, and we don't want
    // two agents with the same slug in the same brain — the skill
    // manifest and agent scaffolding lookups use slugs in logs and
    // debug paths. A race here produces at worst two rows with the same
    // slug; the wizard UI retries on 409, so that's acceptable for MVP.
    const [existing] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.brainId, brain.id),
          eq(documents.slug, input.slug),
          eq(documents.type, 'agent-definition'),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);
    if (existing) {
      return error(
        'slug_conflict',
        'An agent with that slug already exists.',
        409,
      );
    }

    const built = buildAgentDefinitionDoc(input);
    const path = `${AGENT_PATH_PREFIX}${input.slug}`;

    // Belt-and-braces: the select-first check above leaves a race
    // window where a concurrent insert can sneak in. No
    // `(brain_id, slug, type)` unique index exists yet, so this
    // catch is defensive — if a future migration adds the index,
    // Postgres 23505 (unique_violation) will surface here and we
    // map it to the same 409 the select-first path returns. Until
    // then the wrap costs nothing.
    try {
      const [doc] = await db
        .insert(documents)
        .values({
          companyId,
          brainId: brain.id,
          categoryId: null,
          title: input.title,
          slug: input.slug,
          path,
          content: built.content,
          summary: null,
          status: 'active',
          confidenceLevel: 'medium',
          isCore: false,
          ownerId: ctx.userId,
          type: 'agent-definition',
          version: 1,
        })
        .returning();

      await db.insert(documentVersions).values({
        companyId,
        documentId: doc.id,
        versionNumber: 1,
        content: built.content,
        changeSummary: 'created',
        changedBy: ctx.userId,
        changedByType: 'human',
        metadataSnapshot: {
          title: doc.title,
          status: doc.status,
          confidenceLevel: doc.confidenceLevel,
        },
      });

      // Agent-definitions are not skills — skip the skill-manifest
      // rebuild (see Task 4 scope note in the plan). Still fire the
      // brain-manifest regeneration so the new doc shows up in brain
      // navigation + lookups.
      await tryRegenerateManifest(brain.id);

      return created(doc);
    } catch (e) {
      if (
        e !== null &&
        typeof e === 'object' &&
        'code' in e &&
        (e as { code?: unknown }).code === '23505'
      ) {
        return error(
          'slug_conflict',
          'An agent with that slug already exists.',
          409,
        );
      }
      throw e;
    }
  });
