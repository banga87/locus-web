import { describe, it, expect } from 'vitest';
import { deriveResourceSlug, deriveResourcePath } from './resource-slug';

describe('deriveResourceSlug', () => {
  it('prefixes with _r- and takes the first 12 uuid chars', () => {
    const uuid = '0123abcd-ef45-6789-abcd-ef0123456789';
    expect(deriveResourceSlug(uuid)).toBe('_r-0123abcdef45');
  });
  it('strips hyphens so the full 12 chars stay available', () => {
    const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    expect(deriveResourceSlug(uuid)).toBe('_r-aaaaaaaabbbb');
  });
});

describe('deriveResourcePath', () => {
  it('namespaces under _skill-resource/<parent-slug>/<relative>', () => {
    const out = deriveResourcePath('ingestion-filing', 'templates/short.md');
    expect(out).toBe('_skill-resource/ingestion-filing/templates/short.md');
  });
  it('truncates to 512 chars when the derived path would exceed the column limit', () => {
    const long = 'a'.repeat(600);
    const out = deriveResourcePath('x', long);
    expect(out.length).toBeLessThanOrEqual(512);
  });
});
