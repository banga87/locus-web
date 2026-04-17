import { describe, it, expect } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import {
  generatePkce,
  signState,
  verifyState,
} from '../pkce';

const SECRET = randomBytes(32).toString('hex');

describe('generatePkce', () => {
  it('produces a URL-safe verifier ≥ 43 chars', () => {
    const { verifier } = generatePkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('challenge = base64url(sha256(verifier))', () => {
    const { verifier, challenge } = generatePkce();
    const expected = createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(expected);
  });
});

describe('signState / verifyState', () => {
  it('round-trips a payload', () => {
    const state = signState({ connectionId: 'abc', csrf: 'def' }, SECRET, 600);
    const verified = verifyState(state, SECRET);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.connectionId).toBe('abc');
      expect(verified.payload.csrf).toBe('def');
    }
  });

  it('rejects tampered state', () => {
    const state = signState({ connectionId: 'abc', csrf: 'def' }, SECRET, 600);
    const tampered = state.slice(0, -1) + (state.slice(-1) === 'a' ? 'b' : 'a');
    const verified = verifyState(tampered, SECRET);
    expect(verified.ok).toBe(false);
  });

  it('rejects a state signed with a different secret', () => {
    const state = signState({ connectionId: 'abc', csrf: 'def' }, SECRET, 600);
    const verified = verifyState(state, 'f'.repeat(64));
    expect(verified.ok).toBe(false);
  });

  it('rejects an expired state', () => {
    const state = signState({ connectionId: 'abc', csrf: 'def' }, SECRET, -1);
    const verified = verifyState(state, SECRET);
    expect(verified.ok).toBe(false);
  });
});
