// GET /api/cron/zombie-sweeper — runs every 5 minutes via Vercel Cron.
//
// Flips any workflow_run stuck in `running` with no updated_at activity for
// >15 minutes to `failed`. This catches runs where the waitUntil promise
// died silently (function timeout, OOM, unhandled crash) without writing a
// terminal status.
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. Constant-
// time comparison (same pattern as session-cleanup) to avoid timing leaks.
//
// Returns: { swept: number } — count of rows flipped.

import { timingSafeEqual } from 'node:crypto';

import { sweepZombies } from '@/lib/workflow/queries';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // Misconfigured deployment — refuse rather than accept any caller.
    return new Response('cron_secret_missing', { status: 500 });
  }

  // Constant-time bearer comparison — mirrors session-cleanup cron pattern.
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${expected}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    return new Response('unauthorized', { status: 401 });
  }

  // Flip any run stuck in 'running' for >15 min of inactivity to 'failed'.
  const swept = await sweepZombies({ inactivityMinutes: 15 });

  return Response.json({ swept });
}
