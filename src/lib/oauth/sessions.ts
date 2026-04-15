// Pre-consent auth session — the in-flight state between
// GET /api/oauth/authorize and POST /api/oauth/authorize/approve|deny.
// 5-minute TTL. session_ref is a 16-byte hex string, opaque to clients.

import { randomBytes } from 'crypto';
import { and, eq, gt } from 'drizzle-orm';
import { db } from '@/db';
import { oauthSessions } from '@/db/schema';

const SESSION_TTL_MS = 5 * 60 * 1000;

export type OauthSession = typeof oauthSessions.$inferSelect;

export async function createSession(params: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string | null;
}): Promise<OauthSession> {
  const sessionRef = randomBytes(16).toString('hex');
  const [row] = await db
    .insert(oauthSessions)
    .values({
      sessionRef,
      clientId: params.clientId,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state ?? null,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    })
    .returning();
  return row;
}

export async function getSession(sessionRef: string): Promise<OauthSession | null> {
  const [row] = await db
    .select()
    .from(oauthSessions)
    .where(
      and(
        eq(oauthSessions.sessionRef, sessionRef),
        gt(oauthSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function deleteSession(sessionRef: string): Promise<void> {
  await db.delete(oauthSessions).where(eq(oauthSessions.sessionRef, sessionRef));
}
