import { describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'crypto';
import { verifyPkce } from '../pkce';

describe('verifyPkce', () => {
  it('accepts a verifier whose base64url(sha256) matches the challenge', () => {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  it('rejects a mismatched verifier', () => {
    const verifier = 'wrong-verifier';
    const challenge = createHash('sha256').update('right-verifier').digest('base64url');
    expect(verifyPkce(verifier, challenge)).toBe(false);
  });

  it('rejects an empty verifier', () => {
    expect(verifyPkce('', 'anything')).toBe(false);
  });
});
