// Sessions list + create.
//
//   GET  /api/agent/sessions          — list the caller's sessions,
//                                       newest-active-first, cursor-paginated.
//   POST /api/agent/sessions          — create a new session for the
//                                       caller. Body: { firstMessage?: string }.
//
// Auth: any authenticated user with a company. Sessions are per-user
// (RLS enforces it at the DB layer too).

import { and, desc, eq, lt, or } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db';
import { sessions } from '@/db/schema';
import { withAuth, requireCompany } from '@/lib/api/handler';
import { decodeCursor, encodeCursor } from '@/lib/api/pagination';
import { created, error, paginated } from '@/lib/api/response';
import { getBrainForCompany } from '@/lib/brain/queries';
import { sessionManager } from '@/lib/sessions/manager';

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(['active', 'completed']).optional(),
});

// TODO(phase-1.5-wizard): accept agentDefinitionId to bind a new session to a
// user-built agent. Until wired, every session runs as the default Platform Agent.
// See: src/app/api/agent/chat/route.ts — lookup reads sessions.agent_definition_id.
const createSchema = z.object({
  firstMessage: z.string().trim().max(500).optional(),
});

// ---------- GET ---------------------------------------------------------

export const GET = (req: Request) =>
  withAuth(async (ctx) => {
    const companyId = requireCompany(ctx);
    if (typeof companyId !== 'string') return companyId;

    const url = new URL(req.url);
    const parsed = listQuerySchema.safeParse(
      Object.fromEntries(url.searchParams),
    );
    if (!parsed.success) {
      return error(
        'invalid_query',
        'Invalid query parameters.',
        400,
        parsed.error.issues,
      );
    }
    const q = parsed.data;

    // Defence in depth: scope by userId (RLS enforces the same).
    const conds = [eq(sessions.userId, ctx.userId)];
    if (q.status) conds.push(eq(sessions.status, q.status));

    if (q.cursor) {
      try {
        const cur = decodeCursor<{ lastActiveAt: string; id: string }>(q.cursor);
        const cursorDate = new Date(cur.lastActiveAt);
        // (lastActiveAt, id) < (cursorLastActiveAt, cursorId) in desc order.
        conds.push(
          or(
            lt(sessions.lastActiveAt, cursorDate),
            and(
              eq(sessions.lastActiveAt, cursorDate),
              lt(sessions.id, cur.id),
            ),
          )!,
        );
      } catch {
        return error('invalid_cursor', 'Cursor is malformed.', 400);
      }
    }

    const rows = await db
      .select({
        id: sessions.id,
        status: sessions.status,
        turnCount: sessions.turnCount,
        firstMessage: sessions.firstMessage,
        createdAt: sessions.createdAt,
        lastActiveAt: sessions.lastActiveAt,
        totalTokens: sessions.totalTokens,
      })
      .from(sessions)
      .where(and(...conds))
      .orderBy(desc(sessions.lastActiveAt), desc(sessions.id))
      .limit(q.limit + 1);

    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({
            lastActiveAt: last.lastActiveAt.toISOString(),
            id: last.id,
          })
        : null;

    return paginated(page, nextCursor);
  });

// ---------- POST --------------------------------------------------------

export const POST = (req: Request) =>
  withAuth(async (ctx) => {
    const companyId = requireCompany(ctx);
    if (typeof companyId !== 'string') return companyId;

    let body: unknown = {};
    if (req.headers.get('content-length') !== '0') {
      try {
        body = await req.json();
      } catch {
        // Empty / invalid body is fine — POST has no required fields.
        body = {};
      }
    }

    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return error(
        'invalid_body',
        'Invalid session.',
        400,
        parsed.error.issues,
      );
    }

    const brain = await getBrainForCompany(companyId);

    const session = await sessionManager.create({
      companyId,
      brainId: brain.id,
      userId: ctx.userId,
      firstMessage: parsed.data.firstMessage,
    });

    return created(session);
  });
