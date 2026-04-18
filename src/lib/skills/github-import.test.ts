import { describe, it, expect } from 'vitest';
import { parseSkillUrl } from './github-import';

describe('parseSkillUrl', () => {
  it('parses skills.sh URLs', () => {
    expect(parseSkillUrl('https://skills.sh/remotion-dev/skills/remotion-best-practices'))
      .toEqual({ owner: 'remotion-dev', repo: 'skills', skillName: 'remotion-best-practices' });
  });
  it('parses github.com repo root (skillName omitted)', () => {
    expect(parseSkillUrl('https://github.com/anthropics/skills'))
      .toEqual({ owner: 'anthropics', repo: 'skills', skillName: null });
  });
  it('parses github.com repo + explicit skill name from the caller', () => {
    expect(parseSkillUrl('https://github.com/anthropics/skills', 'skill-creator'))
      .toEqual({ owner: 'anthropics', repo: 'skills', skillName: 'skill-creator' });
  });
  it('rejects unrelated URLs', () => {
    expect(() => parseSkillUrl('https://example.com/foo')).toThrow(/unrecognised URL/);
  });
});
