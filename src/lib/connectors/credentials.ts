// Typed JSON envelope for encrypted credentials. The `kind` discriminator
// is the only field callers need to switch on. Stored as the plaintext
// that encryptCredential() receives — the envelope is inside the
// pgcrypto ciphertext, not next to it.

export interface CredentialsBearer {
  kind: 'bearer';
  token: string;
}

export interface AuthServerMetadata {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string | null;
  revocationEndpoint: string | null;
  scopesSupported: string[] | null;
}

export interface CredentialsOAuth {
  kind: 'oauth';
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO-8601
  tokenType: string;
  scope: string | null;
  dcrClientId: string;
  dcrClientSecret: string | null;
  authServerMetadata: AuthServerMetadata;
}

export type Credentials = CredentialsBearer | CredentialsOAuth;

export function encodeCredentials(c: Credentials): string {
  return JSON.stringify(c);
}

export function decodeCredentials(raw: string): Credentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('malformed credentials JSON');
  }
  if (!parsed || typeof parsed !== 'object' || !('kind' in parsed)) {
    throw new Error('malformed credentials JSON');
  }
  const kind = (parsed as { kind: unknown }).kind;
  if (kind !== 'bearer' && kind !== 'oauth') {
    throw new Error(`unknown credential kind: ${String(kind)}`);
  }
  return parsed as Credentials;
}
