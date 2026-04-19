import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveModel, slugToEnv } from '../resolve';

describe('slugToEnv', () => {
  it('transforms PascalCase to SCREAMING_SNAKE_CASE', () => {
    expect(slugToEnv('BrainExplore')).toBe('BRAIN_EXPLORE');
    expect(slugToEnv('DCPVerifier')).toBe('DCP_VERIFIER');
    expect(slugToEnv('WebResearch')).toBe('WEB_RESEARCH');
    expect(slugToEnv('ChangeClassifier')).toBe('CHANGE_CLASSIFIER');
  });
});

describe('resolveModel', () => {
  const ORIGINAL_ENV = { ...process.env };
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    warnSpy.mockClear();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('uses the default when no env override is set', () => {
    delete process.env.TATARA_MODEL_OVERRIDE_BRAIN_EXPLORE;
    const model = resolveModel('BrainExplore', 'anthropic/claude-haiku-4.5');
    expect(model).toBeDefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('uses a valid env override', () => {
    process.env.TATARA_MODEL_OVERRIDE_BRAIN_EXPLORE = 'google/gemini-2.5-flash-lite';
    const model = resolveModel('BrainExplore', 'anthropic/claude-haiku-4.5');
    expect(model).toBeDefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns and falls back when the env override is not in APPROVED_MODELS', () => {
    process.env.TATARA_MODEL_OVERRIDE_BRAIN_EXPLORE = 'openai/gpt-5';
    const model = resolveModel('BrainExplore', 'anthropic/claude-haiku-4.5');
    expect(model).toBeDefined();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/Invalid override/);
  });
});
