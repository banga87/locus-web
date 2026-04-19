import { describe, it, expect } from 'vitest';
import {
  APPROVED_MODELS,
  isApprovedModelId,
} from '../approved-models';

describe('APPROVED_MODELS', () => {
  it('exports anthropic + google models in the pilot scope', () => {
    expect(APPROVED_MODELS).toContain('anthropic/claude-haiku-4.5');
    expect(APPROVED_MODELS).toContain('anthropic/claude-sonnet-4.6');
    expect(APPROVED_MODELS).toContain('google/gemini-2.5-flash-lite');
    expect(APPROVED_MODELS).toContain('google/gemini-2.5-pro');
  });

  it('has no duplicates', () => {
    expect(new Set(APPROVED_MODELS).size).toBe(APPROVED_MODELS.length);
  });
});

describe('isApprovedModelId', () => {
  it('accepts approved ids', () => {
    expect(isApprovedModelId('anthropic/claude-haiku-4.5')).toBe(true);
  });

  it('rejects unknown ids', () => {
    expect(isApprovedModelId('anthropic/claude-opus-5')).toBe(false);
    expect(isApprovedModelId('')).toBe(false);
    expect(isApprovedModelId('anthropic:claude-haiku-4.5')).toBe(false); // wrong separator
  });
});
