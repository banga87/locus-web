import { describe, expect, it } from 'vitest';
import { isLocalhostRedirectUri } from '../redirect-uri';

describe('isLocalhostRedirectUri', () => {
  it.each([
    'http://localhost/cb',
    'http://localhost:33418/cb',
    'http://127.0.0.1/cb',
    'http://127.0.0.1:5000/callback',
    'http://[::1]/cb',
    'http://[::1]:3000/cb',
    'https://localhost:4000/cb',
  ])('accepts valid localhost URI: %s', (uri) => {
    expect(isLocalhostRedirectUri(uri)).toBe(true);
  });

  it.each([
    'https://evil.com/cb',
    'http://localhost.evil.com/cb',
    'http://evil.com/?localhost',
    'http://localhost@evil.com/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'http://127.0.0.2/',
    'http://2130706433/',
    'http://0x7f000001/',
    '',
    'not a url at all',
  ])('rejects attack URI: %s', (uri) => {
    expect(isLocalhostRedirectUri(uri)).toBe(false);
  });
});
