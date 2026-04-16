// GET /api/admin/oauth-connections — list the current user's connected
// MCP clients (i.e. the set of oauth_clients they currently have at least
// one un-revoked refresh token for).
//
// Grouped per client: earliest connectedAt, latest lastUsedAt. This is a
// per-user view — connections are personal to the signing-in user, not
// shared across the company.

import { NextResponse } from 'next/server';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import { oauthClients, oauthRefreshTokens } from '@/db/schema';
import { requireAuth } from '@/lib/api/auth';
import { ApiAuthError } from '@/lib/api/errors';

export const runtime = 'nodejs';

export async function GET() {
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

  const rows = await db
    .select({
      clientId: oauthClients.clientId,
      clientName: oauthClients.clientName,
      connectedAt: sql<Date>`MIN(${oauthRefreshTokens.createdAt})`,
      lastUsedAt: sql<Date | null>`MAX(${oauthRefreshTokens.lastUsedAt})`,
    })
    .from(oauthRefreshTokens)
    .innerJoin(
      oauthClients,
      eq(oauthClients.clientId, oauthRefreshTokens.clientId),
    )
    .where(
      and(
        eq(oauthRefreshTokens.userId, ctx.userId),
        isNull(oauthRefreshTokens.revokedAt),
      ),
    )
    .groupBy(oauthClients.clientId, oauthClients.clientName);

  return NextResponse.json(rows);
}
