// GET /api/cron/attachment-cleanup — nightly cron (Vercel).
//
// Phase 1.5 Task 8 STUB. The full implementation (pending a follow-up
// task) walks `session_attachments WHERE status = 'discarded' AND
// created_at < now() - interval '7 days'` and, for each, deletes the
// Storage object at `storage_key` then hard-deletes the DB row.
//
// Today the handler just authenticates + returns `{ purged: 0 }` so
// the cron endpoint exists and `vercel.json` can schedule it without
// 404ing. That lets us land the Phase 1.5 ingestion flow end-to-end
// without blocking on the purge worker.
//
// Auth mirrors `session-cleanup`'s pattern: Vercel Cron sets
// `Authorization: Bearer ${CRON_SECRET}` and nothing else hits the
// route (the route is not exposed to the public — add it to
// `vercel.json` crons with the secret configured in project env).
//
// TODO(Phase 2 — storage orphan cleanup): implement the storage purge
// loop. Two orphan classes to reconcile here:
//   1. `session_attachments` rows at `status = 'discarded'` older than
//      7 days → hard-delete the row and its Storage blob. The row
//      carries no audit value once the blob is gone.
//   2. Storage objects under `attachments/{company}/{session}/…` with
//      no matching DB row (aborted uploads that never finalised into a
//      session_attachments insert) → delete the object. Cross-check
//      against `session_attachments.id` before purge so a racing
//      insert isn't clobbered.
// Flagged as Important by the Task 8 reviewer; out of Phase 1.5 scope.

import { timingSafeEqual } from 'node:crypto';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return new Response('cron_secret_missing', { status: 500 });
  }

  // Constant-time bearer comparison. Matches the pattern used in
  // src/app/api/cron/session-cleanup/route.ts — see that file for the
  // timing-attack rationale.
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${expected}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    return new Response('unauthorized', { status: 401 });
  }

  // Intentional no-op. See module header for the pending work.
  return Response.json({ purged: 0 });
}
