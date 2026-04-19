import { describe, expect, it } from 'vitest';
import { validateOutputContract } from '../validators';
import type { OutputContract } from '../types';

describe('validateOutputContract', () => {
  it('returns ok when no validator is present', () => {
    const contract: OutputContract = { type: 'freeform' };
    expect(validateOutputContract('any text', contract)).toEqual({ ok: true });
  });

  it('delegates to the custom validator', () => {
    const contract: OutputContract = {
      type: 'freeform',
      validator: (t) => (t.length > 0 ? { ok: true } : { ok: false, reason: 'empty' }),
    };
    expect(validateOutputContract('hello', contract)).toEqual({ ok: true });
    expect(validateOutputContract('', contract)).toEqual({ ok: false, reason: 'empty' });
  });
});
