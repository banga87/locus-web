// One-time authorization codes bound to (client_id, user_id, redirect_uri,
// code_challenge). The raw code is returned to the caller; only sha256(code)
// is persisted. One-time-use is enforced by DELETE ... RETURNING: the row
// is gone the moment it's read, so a second consume gets `unknown`.

import { createHash, randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { oauthCodes } from '@/db/schema';
import { verifyPkce } from './pkce';

const CODE_TTL_MS = 60 * 1000;

function hash(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export async function generateCode(params: {
  clientId: string;
  userId: string;
  companyId: string;
  redirectUri: string;
  codeChallenge: string;
}): Promise<{ code: string }> {
  const code = randomBytes(32).toString('hex');
  await db.insert(oauthCodes).values({
    codeHash: hash(code),
    clientId: params.clientId,
    userId: params.userId,
    companyId: params.companyId,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  return { code };
}

type ConsumeResult =
  | { ok: true; userId: string; companyId: string; clientId: string }
  | { ok: false; reason: 'unknown' | 'expired' | 'redirect_mismatch' | 'pkce_mismatch' };

export async function consumeCode(params: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<ConsumeResult> {
  const codeHash = hash(params.code);

  // DELETE ... RETURNING gives us atomic one-time-use: if the row is
  // already gone (consumed or never existed), `row` is undefined.
  const [row] = await db
    .delete(oauthCodes)
    .where(eq(oauthCodes.codeHash, codeHash))
    .returning();
  if (!row) return { ok: false, reason: 'unknown' };

  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };
  if (row.redirectUri !== params.redirectUri) return { ok: false, reason: 'redirect_mismatch' };
  if (!verifyPkce(params.codeVerifier, row.codeChallenge)) {
    return { ok: false, reason: 'pkce_mismatch' };
  }

  return { ok: true, userId: row.userId, companyId: row.companyId, clientId: row.clientId };
}
