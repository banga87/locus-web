// Admin Agent Access Token — revoke endpoint.
//
// Auth: `requireOwner()` is stubbed inline pending Task 3. The token must
// belong to the caller's company or the route returns 404 (not 403, to avoid
// leaking existence across tenants).

import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { agentAccessTokens, users } from '@/db/schema';
import { createClient } from '@/lib/supabase/server';
import { logAuthEvent } from '@/lib/audit/helpers';
import { revokeToken } from '@/lib/auth/tokens';

// ---------- auth stub (replace with @/lib/auth/requireAuth in Task 3) ----

type OwnerContext = {
  userId: string;
  companyId: string;
  role: 'owner';
  actorName: string | null;
};

async function requireOwner(): Promise<OwnerContext | Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const [profile] = await db
    .select()
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  if (
    !profile ||
    profile.role !== 'owner' ||
    profile.status !== 'active' ||
    !profile.companyId
  ) {
    return new Response('Forbidden', { status: 403 });
  }

  return {
    userId: user.id,
    companyId: profile.companyId,
    role: 'owner',
    actorName: profile.fullName ?? null,
  };
}

function isResponse(x: unknown): x is Response {
  return x instanceof Response;
}

// ---------- DELETE /api/admin/tokens/[id] -------------------------------

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireOwner();
  if (isResponse(ctx)) return ctx;

  const { id } = await params;

  // Scope the lookup by both id AND companyId — cross-tenant id guesses
  // return 404, not 403, so we don't leak token existence across tenants.
  const [row] = await db
    .select({
      id: agentAccessTokens.id,
      tokenPrefix: agentAccessTokens.tokenPrefix,
      name: agentAccessTokens.name,
      status: agentAccessTokens.status,
    })
    .from(agentAccessTokens)
    .where(
      and(
        eq(agentAccessTokens.id, id),
        eq(agentAccessTokens.companyId, ctx.companyId)
      )
    )
    .limit(1);

  if (!row) {
    return NextResponse.json(
      { error: 'not_found', message: 'Token not found.' },
      { status: 404 }
    );
  }

  await revokeToken(id);

  logAuthEvent({
    companyId: ctx.companyId,
    actorType: 'human',
    actorId: ctx.userId,
    actorName: ctx.actorName ?? undefined,
    eventType: 'token.revoked',
    tokenId: row.id,
    details: {
      tokenPrefix: row.tokenPrefix,
      name: row.name,
      previousStatus: row.status,
    },
  });

  return NextResponse.json({ ok: true });
}
