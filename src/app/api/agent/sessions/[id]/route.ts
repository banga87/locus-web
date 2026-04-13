// Single session detail + status mutation.
//
//   GET    /api/agent/sessions/[id]    — session row + ordered turns.
//   PATCH  /api/agent/sessions/[id]    — body { status: 'completed' }.
//                                        Active → completed only.
//   DELETE /api/agent/sessions/[id]    — soft-archive: status = completed.
//                                        Hard delete is Phase 2+.
//
// Auth: caller must own the session. Cross-tenant id guesses return 404
// (not 403) so we don't leak existence across tenants.

import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db';
import { sessions, sessionTurns } from '@/db/schema';
import { withAuth } from '@/lib/api/handler';
import { error, success } from '@/lib/api/response';

type RouteCtx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  status: z.literal('completed'),
});

// ---------- GET ---------------------------------------------------------

export const GET = (_req: Request, { params }: RouteCtx) =>
  withAuth(async (ctx) => {
    const { id } = await params;

    // Scope by userId — RLS enforces the same boundary at the DB.
    const [session] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.userId, ctx.userId)))
      .limit(1);

    if (!session) {
      return error('not_found', 'Session not found.', 404);
    }

    // TODO(Phase 2): paginate turns when context-window compaction lands.
    // Hard cap for now so a long session can't dump every jsonb blob
    // over the wire on a single GET.
    const turns = await db
      .select()
      .from(sessionTurns)
      .where(eq(sessionTurns.sessionId, id))
      .orderBy(asc(sessionTurns.turnNumber))
      .limit(200);

    return success({ session, turns });
  });

// ---------- PATCH -------------------------------------------------------

export const PATCH = (req: Request, { params }: RouteCtx) =>
  withAuth(async (ctx) => {
    const { id } = await params;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return error('invalid_json', 'Request body must be JSON.', 400);
    }

    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return error(
        'invalid_body',
        'Only { status: "completed" } is supported.',
        400,
        parsed.error.issues,
      );
    }

    const [existing] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.userId, ctx.userId)))
      .limit(1);
    if (!existing) {
      return error('not_found', 'Session not found.', 404);
    }
    if (existing.status === 'completed') {
      // Already in the terminal state — return idempotently.
      return success(existing);
    }

    const [row] = await db
      .update(sessions)
      .set({ status: 'completed' })
      .where(eq(sessions.id, id))
      .returning();

    return success(row);
  });

// ---------- DELETE ------------------------------------------------------

export const DELETE = (_req: Request, { params }: RouteCtx) =>
  withAuth(async (ctx) => {
    const { id } = await params;

    const [existing] = await db
      .select({ id: sessions.id, status: sessions.status })
      .from(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.userId, ctx.userId)))
      .limit(1);
    if (!existing) {
      return error('not_found', 'Session not found.', 404);
    }

    // Soft-archive only — the row + turns persist for audit + replay.
    if (existing.status !== 'completed') {
      await db
        .update(sessions)
        .set({ status: 'completed' })
        .where(eq(sessions.id, id));
    }

    return success({ id, status: 'completed' as const });
  });
