// Tests for src/lib/oauth/codes.ts — one-time authorization-code repo.
// Live DB. Seeds a company + user + client, cleans all oauth_codes rows
// at the end (the table is entirely owned by OAuth flows).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'crypto';
import { inArray, eq } from 'drizzle-orm';
import { db } from '@/db';
import { oauthClients, users, companies, oauthCodes } from '@/db/schema';
import { generateCode, consumeCode } from '../codes';

let clientId: string;
let userId: string;
let companyId: string;

beforeAll(async () => {
  const [comp] = await db
    .insert(companies)
    .values({
      name: 'Codes Test',
      slug: `codes-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    })
    .returning();
  companyId = comp.id;

  userId = '00000000-0000-0000-0000-00000000c0de';
  await db
    .insert(users)
    .values({
      id: userId,
      companyId,
      fullName: 'Test',
      email: 't@example.com',
      status: 'active',
    })
    .onConflictDoNothing();

  const [c] = await db
    .insert(oauthClients)
    .values({
      clientName: 'Codes Test',
      redirectUris: ['http://localhost:3000/cb'],
    })
    .returning();
  clientId = c.clientId;
});

afterAll(async () => {
  await db.delete(oauthCodes);
  await db.delete(oauthClients).where(inArray(oauthClients.clientId, [clientId]));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(companies).where(eq(companies.id, companyId));
});

function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

describe('oauth codes repo', () => {
  it('generates then consumes successfully with matching verifier', async () => {
    const { verifier, challenge } = pkcePair();
    const { code } = await generateCode({
      clientId,
      userId,
      companyId,
      redirectUri: 'http://localhost:3000/cb',
      codeChallenge: challenge,
    });
    const r = await consumeCode({
      code,
      redirectUri: 'http://localhost:3000/cb',
      codeVerifier: verifier,
    });
    expect(r).toEqual({ ok: true, userId, companyId, clientId });
  });

  it('rejects reuse of a consumed code', async () => {
    const { verifier, challenge } = pkcePair();
    const { code } = await generateCode({
      clientId,
      userId,
      companyId,
      redirectUri: 'http://localhost:3000/cb',
      codeChallenge: challenge,
    });
    await consumeCode({
      code,
      redirectUri: 'http://localhost:3000/cb',
      codeVerifier: verifier,
    });
    const r = await consumeCode({
      code,
      redirectUri: 'http://localhost:3000/cb',
      codeVerifier: verifier,
    });
    expect(r).toEqual({ ok: false, reason: 'unknown' });
  });

  it('rejects wrong code_verifier', async () => {
    const { challenge } = pkcePair();
    const { code } = await generateCode({
      clientId,
      userId,
      companyId,
      redirectUri: 'http://localhost:3000/cb',
      codeChallenge: challenge,
    });
    const r = await consumeCode({
      code,
      redirectUri: 'http://localhost:3000/cb',
      codeVerifier: 'wrong',
    });
    expect(r).toEqual({ ok: false, reason: 'pkce_mismatch' });
  });

  it('rejects wrong redirect_uri', async () => {
    const { verifier, challenge } = pkcePair();
    const { code } = await generateCode({
      clientId,
      userId,
      companyId,
      redirectUri: 'http://localhost:3000/cb',
      codeChallenge: challenge,
    });
    const r = await consumeCode({
      code,
      redirectUri: 'http://localhost:9999/cb',
      codeVerifier: verifier,
    });
    expect(r).toEqual({ ok: false, reason: 'redirect_mismatch' });
  });

  it('rejects expired code', async () => {
    const { verifier, challenge } = pkcePair();
    const code = randomBytes(32).toString('hex');
    const codeHash = createHash('sha256').update(code).digest('hex');
    await db.insert(oauthCodes).values({
      codeHash,
      clientId,
      userId,
      companyId,
      redirectUri: 'http://localhost:3000/cb',
      codeChallenge: challenge,
      expiresAt: new Date(Date.now() - 1000),
    });
    const r = await consumeCode({
      code,
      redirectUri: 'http://localhost:3000/cb',
      codeVerifier: verifier,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('expired');
  });
});
