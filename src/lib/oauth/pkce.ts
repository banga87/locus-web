// PKCE S256 verification. See RFC 7636 §4.6.
// Use timing-safe comparison to avoid leaking challenge bytes via timing.

import { createHash, timingSafeEqual } from 'crypto';

export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!verifier) return false;
  const derived = createHash('sha256').update(verifier).digest('base64url');
  const a = Buffer.from(derived);
  const b = Buffer.from(challenge);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
