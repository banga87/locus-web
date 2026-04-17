// PKCE code generator + HMAC-signed state helper.
//
// `signState` embeds an expiry in the payload so `verifyState` can reject
// stale states without a server-side cache lookup. The signing secret
// lives in CONNECTORS_STATE_SECRET (32-byte hex).

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function generatePkce(): PkcePair {
  // 64 random bytes → 86 base64url chars, within the 43–128 spec window.
  const verifier = randomBytes(64).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export interface StatePayload {
  connectionId: string;
  csrf: string;
}

interface SignedState {
  payload: StatePayload;
  expiresAt: number; // epoch seconds
}

export function signState(
  payload: StatePayload,
  secretHex: string,
  ttlSeconds: number,
): string {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body: SignedState = { payload, expiresAt };
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = createHmac('sha256', Buffer.from(secretHex, 'hex'))
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export type VerifyResult =
  | { ok: true; payload: StatePayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export function verifyState(state: string, secretHex: string): VerifyResult {
  const parts = state.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [encoded, sig] = parts;

  const expected = createHmac('sha256', Buffer.from(secretHex, 'hex'))
    .update(encoded)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let body: SignedState;
  try {
    body = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (body.expiresAt < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, payload: body.payload };
}
