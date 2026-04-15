// Tests for src/lib/oauth/refresh.ts — refresh tokens with rotation and
// chain-revoke on replay. Live DB; seeds company + user + client, wipes
// oauth_refresh_tokens at the end.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/db';
import {
  oauthClients,
  oauthRefreshTokens,
  users,
  companies,
} from '@/db/schema';
import { issueRefreshToken, rotateRefreshToken, revokeChain } from '../refresh';

let clientId: string;
let userId: string;
let companyId: string;

beforeAll(async () => {
  const [comp] = await db
    .insert(companies)
    .values({
      name: 'Refresh Test',
      slug: `refresh-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    })
    .returning();
  companyId = comp.id;

  userId = '00000000-0000-0000-0000-00000000ef00';
  await db
    .insert(users)
    .values({
      id: userId,
      companyId,
      fullName: 'Refresh Test',
      email: 'r@example.com',
      status: 'active',
    })
    .onConflictDoNothing();

  const [c] = await db
    .insert(oauthClients)
    .values({
      clientName: 'Refresh Test',
      redirectUris: ['http://localhost:3000/cb'],
    })
    .returning();
  clientId = c.clientId;
});

afterAll(async () => {
  await db.delete(oauthRefreshTokens);
  await db.delete(oauthClients).where(inArray(oauthClients.clientId, [clientId]));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(companies).where(eq(companies.id, companyId));
});

function hash(t: string): string {
  return createHash('sha256').update(t).digest('hex');
}

describe('oauth refresh token repo', () => {
  it('rotates: issues new token, revokes old row, new row is active', async () => {
    const { refreshToken: t0 } = await issueRefreshToken({ clientId, userId, companyId });
    const r = await rotateRefreshToken({ refreshToken: t0 });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected ok');
    expect(r.userId).toBe(userId);
    expect(r.clientId).toBe(clientId);
    expect(r.companyId).toBe(companyId);
    expect(r.newRefreshToken).not.toBe(t0);

    const [oldRow] = await db
      .select()
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.tokenHash, hash(t0)))
      .limit(1);
    expect(oldRow.revokedAt).not.toBeNull();

    const [newRow] = await db
      .select()
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.tokenHash, hash(r.newRefreshToken)))
      .limit(1);
    expect(newRow.revokedAt).toBeNull();

    // Clean up so subsequent tests start with no active rows for this user.
    await db.delete(oauthRefreshTokens);
  });

  it('returns unknown for a bogus refresh token', async () => {
    const r = await rotateRefreshToken({ refreshToken: 'bogus-not-in-db' });
    expect(r).toEqual({ ok: false, reason: 'unknown' });
  });

  it('returns expired when the row is past its expiresAt', async () => {
    const token = 'expired-' + Date.now();
    await db.insert(oauthRefreshTokens).values({
      tokenHash: hash(token),
      clientId,
      userId,
      companyId,
      expiresAt: new Date(Date.now() - 1000),
    });
    const r = await rotateRefreshToken({ refreshToken: token });
    expect(r).toEqual({ ok: false, reason: 'expired' });
    await db.delete(oauthRefreshTokens);
  });

  it('replay of a revoked token chain-revokes all active siblings', async () => {
    // First rotation: t0 -> t1. After this, t0 is revoked and t1 is active.
    const { refreshToken: t0 } = await issueRefreshToken({ clientId, userId, companyId });
    const r1 = await rotateRefreshToken({ refreshToken: t0 });
    expect(r1.ok).toBe(true);
    if (!r1.ok) throw new Error('expected ok');
    const t1 = r1.newRefreshToken;

    // Replay the revoked t0: should chain-revoke and kill t1 too.
    const r2 = await rotateRefreshToken({ refreshToken: t0 });
    expect(r2).toEqual({ ok: false, reason: 'revoked_chain_killed' });

    const [t1Row] = await db
      .select()
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.tokenHash, hash(t1)))
      .limit(1);
    expect(t1Row.revokedAt).not.toBeNull();

    // No active rows remain for this (user, client) pair.
    const active = await db
      .select()
      .from(oauthRefreshTokens)
      .where(
        and(
          eq(oauthRefreshTokens.userId, userId),
          eq(oauthRefreshTokens.clientId, clientId),
          isNull(oauthRefreshTokens.revokedAt),
        ),
      );
    expect(active).toHaveLength(0);

    await db.delete(oauthRefreshTokens);
  });

  it('revokeChain sets revokedAt on all active rows for the (user, client) pair', async () => {
    await issueRefreshToken({ clientId, userId, companyId });
    await issueRefreshToken({ clientId, userId, companyId });
    await issueRefreshToken({ clientId, userId, companyId });

    const before = await db
      .select()
      .from(oauthRefreshTokens)
      .where(
        and(
          eq(oauthRefreshTokens.userId, userId),
          eq(oauthRefreshTokens.clientId, clientId),
          isNull(oauthRefreshTokens.revokedAt),
        ),
      );
    expect(before.length).toBeGreaterThanOrEqual(3);

    await revokeChain({ userId, clientId });

    const after = await db
      .select()
      .from(oauthRefreshTokens)
      .where(
        and(
          eq(oauthRefreshTokens.userId, userId),
          eq(oauthRefreshTokens.clientId, clientId),
          isNull(oauthRefreshTokens.revokedAt),
        ),
      );
    expect(after).toHaveLength(0);

    await db.delete(oauthRefreshTokens);
  });
});
