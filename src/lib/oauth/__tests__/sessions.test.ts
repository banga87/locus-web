// Tests for src/lib/oauth/sessions.ts — pre-consent in-flight auth sessions.
// Live-DB. Seeds one client in beforeAll, tracks session_refs for afterAll.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db } from '@/db';
import { oauthClients, oauthSessions } from '@/db/schema';
import { createSession, getSession, deleteSession } from '../sessions';

let clientId: string;
const sessions: string[] = [];

beforeAll(async () => {
  const [c] = await db
    .insert(oauthClients)
    .values({
      clientName: 'Sess Test',
      redirectUris: ['http://localhost:3000/cb'],
    })
    .returning();
  clientId = c.clientId;
});

afterAll(async () => {
  if (sessions.length) {
    await db.delete(oauthSessions).where(inArray(oauthSessions.sessionRef, sessions));
  }
  await db.delete(oauthClients).where(inArray(oauthClients.clientId, [clientId]));
});

describe('oauth sessions repo', () => {
  it('creates a session with a random 32-char ref and 5-min expiry', async () => {
    const s = await createSession({
      clientId,
      redirectUri: 'http://localhost:3000/cb',
      codeChallenge: 'abcd',
      state: 'xyz',
    });
    sessions.push(s.sessionRef);
    expect(s.sessionRef).toHaveLength(32);
    expect(s.expiresAt.getTime() - Date.now()).toBeGreaterThan(4 * 60_000);
    expect(s.expiresAt.getTime() - Date.now()).toBeLessThan(6 * 60_000);
  });

  it('getSession returns null for unknown ref', async () => {
    expect(await getSession('nope')).toBeNull();
  });

  it('getSession returns null for expired sessions', async () => {
    const ref = 'expired' + Date.now();
    await db.insert(oauthSessions).values({
      sessionRef: ref,
      clientId,
      redirectUri: 'http://localhost:3000/cb',
      codeChallenge: 'x',
      expiresAt: new Date(Date.now() - 1000),
    });
    sessions.push(ref);
    expect(await getSession(ref)).toBeNull();
  });

  it('deleteSession removes the row', async () => {
    const s = await createSession({
      clientId,
      redirectUri: 'http://localhost:3000/cb',
      codeChallenge: 'abcd',
    });
    sessions.push(s.sessionRef);
    await deleteSession(s.sessionRef);
    expect(await getSession(s.sessionRef)).toBeNull();
  });
});
