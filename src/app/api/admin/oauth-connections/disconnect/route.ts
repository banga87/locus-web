// POST /api/admin/oauth-connections/disconnect — user-initiated disconnect
// of an MCP client. Revokes every active refresh token for
// (currentUser, clientId). Idempotent: if the user has no rows for that
// client (including an unknown clientId), the revoke is a no-op and we
// still return 200.

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAuth } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';
import { revokeChain } from '@/lib/oauth/refresh';

export const runtime = 'nodejs';

const bodySchema = z.object({
  client_id: z.string().uuid(),
});

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireAuth();
  } catch (e) {
    if (e instanceof ApiAuthError) {
      return NextResponse.json(
        { error: e.code, message: e.message },
        { status: e.statusCode },
      );
    }
    throw e;
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_json', message: 'Request body must be JSON.' },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'invalid_body',
        message: 'client_id must be a UUID.',
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  await revokeChain({ userId: ctx.userId, clientId: parsed.data.client_id });

  return NextResponse.json({ ok: true });
}
