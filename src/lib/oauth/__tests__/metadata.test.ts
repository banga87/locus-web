import { describe, expect, it } from 'vitest';
import { protectedResourceMetadata, authorizationServerMetadata } from '../metadata';

describe('metadata', () => {
  it('protected-resource points at the authorization server', () => {
    const m = protectedResourceMetadata('https://locus.app');
    expect(m.resource).toBe('https://locus.app/api/mcp');
    expect(m.authorization_servers).toEqual(['https://locus.app']);
  });

  it('authorization-server advertises the expected endpoints', () => {
    const m = authorizationServerMetadata('https://locus.app');
    expect(m.issuer).toBe('https://locus.app');
    expect(m.authorization_endpoint).toBe('https://locus.app/api/oauth/authorize');
    expect(m.token_endpoint).toBe('https://locus.app/api/oauth/token');
    expect(m.registration_endpoint).toBe('https://locus.app/api/oauth/register');
    expect(m.code_challenge_methods_supported).toEqual(['S256']);
    expect(m.grant_types_supported).toContain('authorization_code');
    expect(m.grant_types_supported).toContain('refresh_token');
    expect(m.token_endpoint_auth_methods_supported).toEqual(['none']);
  });
});
