import { describe, it, expect } from 'vitest';
import {
  encodeCredentials,
  decodeCredentials,
  type CredentialsBearer,
  type CredentialsOAuth,
} from '../credentials';

describe('credentials envelope', () => {
  it('round-trips a bearer credential', () => {
    const input: CredentialsBearer = { kind: 'bearer', token: 'sk_live_abc' };
    const encoded = encodeCredentials(input);
    expect(typeof encoded).toBe('string');
    expect(decodeCredentials(encoded)).toEqual(input);
  });

  it('round-trips an oauth credential', () => {
    const input: CredentialsOAuth = {
      kind: 'oauth',
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: '2026-04-17T12:00:00.000Z',
      tokenType: 'Bearer',
      scope: 'read write',
      dcrClientId: 'c',
      dcrClientSecret: null,
      authServerMetadata: {
        authorizationEndpoint: 'https://x/authorize',
        tokenEndpoint: 'https://x/token',
        registrationEndpoint: 'https://x/register',
        revocationEndpoint: null,
        scopesSupported: ['read', 'write'],
      },
    };
    expect(decodeCredentials(encodeCredentials(input))).toEqual(input);
  });

  it('rejects an unknown kind', () => {
    expect(() => decodeCredentials('{"kind":"weird"}')).toThrow(/unknown credential kind/);
  });

  it('rejects malformed JSON', () => {
    expect(() => decodeCredentials('not json')).toThrow(/malformed/);
  });
});
