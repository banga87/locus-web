// Opaque refresh tokens. Rotation on every use — each successful rotate
// revokes the presented token and issues a brand-new one. Replay of any
// already-revoked token chain-revokes every active refresh row for the
// same (user_id, client_id) pair (RFC 6749 §10.4 reuse detection).

import { createHash, randomBytes } from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { oauthRefreshTokens } from '@/db/schema';

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hash(t: string): string {
  return createHash('sha256').update(t).digest('hex');
}

export async function issueRefreshToken(params: {
  clientId: string;
  userId: string;
  companyId: string;
}): Promise<{ refreshToken: string }> {
  const refreshToken = randomBytes(32).toString('hex');
  await db.insert(oauthRefreshTokens).values({
    tokenHash: hash(refreshToken),
    clientId: params.clientId,
    userId: params.userId,
    companyId: params.companyId,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  });
  return { refreshToken };
}

export async function revokeChain(params: {
  userId: string;
  clientId: string;
}): Promise<void> {
  await db
    .update(oauthRefreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(oauthRefreshTokens.userId, params.userId),
        eq(oauthRefreshTokens.clientId, params.clientId),
        isNull(oauthRefreshTokens.revokedAt),
      ),
    );
}

type RotateResult =
  | {
      ok: true;
      newRefreshToken: string;
      userId: string;
      companyId: string;
      clientId: string;
    }
  | { ok: false; reason: 'unknown' | 'expired' | 'revoked_chain_killed' };

export async function rotateRefreshToken(params: {
  refreshToken: string;
}): Promise<RotateResult> {
  const [row] = await db
    .select()
    .from(oauthRefreshTokens)
    .where(eq(oauthRefreshTokens.tokenHash, hash(params.refreshToken)))
    .limit(1);
  if (!row) return { ok: false, reason: 'unknown' };

  if (row.revokedAt) {
    // Replay of a revoked token — nuke every active sibling.
    await revokeChain({ userId: row.userId, clientId: row.clientId });
    return { ok: false, reason: 'revoked_chain_killed' };
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  await db
    .update(oauthRefreshTokens)
    .set({ revokedAt: new Date(), lastUsedAt: new Date() })
    .where(eq(oauthRefreshTokens.tokenHash, row.tokenHash));

  const { refreshToken: newRefreshToken } = await issueRefreshToken({
    userId: row.userId,
    companyId: row.companyId,
    clientId: row.clientId,
  });

  return {
    ok: true,
    newRefreshToken,
    userId: row.userId,
    companyId: row.companyId,
    clientId: row.clientId,
  };
}
