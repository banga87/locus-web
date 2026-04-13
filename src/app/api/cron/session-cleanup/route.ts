// GET /api/cron/session-cleanup — hourly cron (`vercel.json`).
//
// Marks `active` sessions as `completed` once they've been idle for
// 24 hours. `last_active_at` is bumped on every persistTurn and resume,
// so this only catches truly abandoned sessions.
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. The
// route returns 401 for any other caller — there is no public access.
// Configure `CRON_SECRET` in Vercel project env (or `.env.local` for
// local dev, then `curl -H "Authorization: Bearer $CRON_SECRET" ...`).
//
// Returns: `{ closedCount: number }` so the cron logs surface activity.
//
// No audit event is emitted per closure: at MVP scale 24-hour idle
// closures are uninteresting noise. If we add session.completed to the
// audit surface later it should be the explicit DELETE/PATCH path that
// emits, not this cron.

import { lt, eq, and } from 'drizzle-orm';

import { db } from '@/db';
import { sessions } from '@/db/schema';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // Misconfigured deployment. Refuse to run rather than silently
    // accept any caller.
    return new Response('cron_secret_missing', { status: 500 });
  }

  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${expected}`) {
    return new Response('unauthorized', { status: 401 });
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const result = await db
    .update(sessions)
    .set({ status: 'completed' })
    .where(
      and(
        eq(sessions.status, 'active'),
        lt(sessions.lastActiveAt, cutoff),
      ),
    )
    .returning({ id: sessions.id });

  // The `postgres` driver returns the rows we asked for in `.returning`.
  const closedCount = result.length;

  return Response.json({ closedCount });
}
