// Unit tests for the pure brain-save helpers.
//
// These tests pin two contracts:
//   1. `extractDocumentTypeFromFrontmatter` — permissive scalar extractor.
//      Task 1 only extracts; reserved-type validation ships in a later
//      task.
//   2. `parseFrontmatterRaw` + `extractDocumentTypeFromContent` — the
//      end-to-end path the route handlers call with raw document body.

import { describe, it, expect } from 'vitest';

import {
  extractDocumentTypeFromContent,
  extractDocumentTypeFromFrontmatter,
  parseFrontmatterRaw,
} from './save';

describe('extractDocumentTypeFromFrontmatter', () => {
  it('returns the string value when `type` is a non-empty string', () => {
    expect(extractDocumentTypeFromFrontmatter({ type: 'skill' })).toBe('skill');
    expect(
      extractDocumentTypeFromFrontmatter({ type: 'agent-scaffolding' }),
    ).toBe('agent-scaffolding');
    expect(
      extractDocumentTypeFromFrontmatter({ type: 'agent-definition' }),
    ).toBe('agent-definition');
    // Arbitrary vocabulary types flow through unchanged — validation is
    // a later task.
    expect(
      extractDocumentTypeFromFrontmatter({ type: 'pricing-model' }),
    ).toBe('pricing-model');
  });

  it('returns null when `type` is missing', () => {
    expect(extractDocumentTypeFromFrontmatter({})).toBeNull();
    expect(extractDocumentTypeFromFrontmatter({ title: 'Hello' })).toBeNull();
  });

  it('returns null when `type` is a non-string value', () => {
    expect(extractDocumentTypeFromFrontmatter({ type: 42 })).toBeNull();
    expect(extractDocumentTypeFromFrontmatter({ type: true })).toBeNull();
    expect(extractDocumentTypeFromFrontmatter({ type: null })).toBeNull();
    expect(extractDocumentTypeFromFrontmatter({ type: undefined })).toBeNull();
    expect(
      extractDocumentTypeFromFrontmatter({ type: { nested: 'skill' } }),
    ).toBeNull();
    expect(
      extractDocumentTypeFromFrontmatter({ type: ['skill'] }),
    ).toBeNull();
  });

  it('returns null for an empty string `type`', () => {
    expect(extractDocumentTypeFromFrontmatter({ type: '' })).toBeNull();
  });

  it('returns null for null or undefined frontmatter objects', () => {
    expect(extractDocumentTypeFromFrontmatter(null)).toBeNull();
    expect(extractDocumentTypeFromFrontmatter(undefined)).toBeNull();
  });
});

describe('parseFrontmatterRaw', () => {
  it('returns {} when content has no frontmatter preamble', () => {
    expect(parseFrontmatterRaw('hello body')).toEqual({});
    expect(parseFrontmatterRaw('')).toEqual({});
  });

  it('returns {} when the frontmatter block has no closing marker', () => {
    expect(parseFrontmatterRaw('---\ntype: skill\nbody only')).toEqual({});
  });

  it('parses the scalar vocabulary into a flat record', () => {
    const raw =
      '---\n' +
      'type: skill\n' +
      'title: "Draft a Landing Page"\n' +
      'priority: 5\n' +
      'is_core: true\n' +
      'owner: null\n' +
      '---\n' +
      'body text\n';
    expect(parseFrontmatterRaw(raw)).toEqual({
      type: 'skill',
      title: 'Draft a Landing Page',
      priority: 5,
      is_core: true,
      owner: null,
    });
  });

  it('preserves unknown keys (no allowlist)', () => {
    const raw = '---\ntype: pricing-model\ncustom_field: foo\n---\n';
    const fm = parseFrontmatterRaw(raw);
    expect(fm.type).toBe('pricing-model');
    expect(fm.custom_field).toBe('foo');
  });
});

describe('extractDocumentTypeFromContent', () => {
  it('returns the frontmatter type from full document content', () => {
    const content =
      '---\ntype: agent-definition\ntitle: "Marketing Copywriter"\n---\n\nbody';
    expect(extractDocumentTypeFromContent(content)).toBe('agent-definition');
  });

  it('returns null when there is no frontmatter', () => {
    expect(extractDocumentTypeFromContent('just a plain body')).toBeNull();
  });

  it('returns null when frontmatter omits `type`', () => {
    const content = '---\ntitle: "Hello"\n---\n\nbody';
    expect(extractDocumentTypeFromContent(content)).toBeNull();
  });

  it('returns null when frontmatter has an empty type', () => {
    const content = '---\ntype:\ntitle: "Hello"\n---\n\nbody';
    expect(extractDocumentTypeFromContent(content)).toBeNull();
  });
});
