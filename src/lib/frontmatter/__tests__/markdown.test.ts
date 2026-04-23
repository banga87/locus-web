import { describe, it, expect } from 'vitest';
import { splitFrontmatter, joinFrontmatter, emitSchemaYaml } from '../markdown';
import type { FrontmatterSchema } from '../schemas/types';

// Fake flat-field schema used to exercise the schema-aware markdown emitter.
// Shape mirrors the pre-unification workflow schema (four flat keys) — kept
// as a convenient stand-in for any non-empty flat schema; the markdown
// module is agnostic about which doc-type carries the schema.
const fakeSchema: FrontmatterSchema = {
  type: 'skill',
  label: 'Skill',
  fields: [
    { kind: 'enum', name: 'output', label: 'Output', options: ['document', 'message', 'both'], required: true },
    { kind: 'nullable-string', name: 'output_category', label: 'Category' },
    { kind: 'string-array', name: 'requires_mcps', label: 'Required MCPs' },
    { kind: 'nullable-string', name: 'schedule', label: 'Schedule' },
  ],
  defaults: () => ({ output: 'document', output_category: null, requires_mcps: [], schedule: null }),
  validate: () => ({ ok: true, value: {} }),
};

describe('splitFrontmatter', () => {
  it('splits a well-formed document', () => {
    const raw = '---\ntype: skill\noutput: document\n---\n\nHello world\n';
    const { frontmatterText, body } = splitFrontmatter(raw);
    expect(frontmatterText).toBe('type: skill\noutput: document');
    expect(body).toBe('Hello world\n');
  });

  it('handles CRLF line endings', () => {
    const raw = '---\r\ntype: skill\r\n---\r\n\r\nBody\r\n';
    const { frontmatterText, body } = splitFrontmatter(raw);
    expect(frontmatterText).toBe('type: skill');
    expect(body).toBe('Body\r\n');
  });

  it('returns null frontmatter when block is missing', () => {
    const raw = '# Just a heading\n\nSome prose.\n';
    const { frontmatterText, body } = splitFrontmatter(raw);
    expect(frontmatterText).toBeNull();
    expect(body).toBe(raw);
  });

  it('returns null frontmatter when the closing --- is missing', () => {
    const raw = '---\ntype: skill\n# never closed\nbody\n';
    const { frontmatterText, body } = splitFrontmatter(raw);
    expect(frontmatterText).toBeNull();
    expect(body).toBe(raw);
  });

  it('preserves a body that itself contains a --- thematic break', () => {
    const raw = '---\ntype: skill\noutput: document\n---\n\nBefore\n\n---\n\nAfter\n';
    const { frontmatterText, body } = splitFrontmatter(raw);
    expect(frontmatterText).toBe('type: skill\noutput: document');
    expect(body).toBe('Before\n\n---\n\nAfter\n');
  });
});

describe('emitSchemaYaml', () => {
  it('emits canonical YAML with null literals and inline empty arrays', () => {
    const out = emitSchemaYaml(
      { output: 'document', output_category: null, requires_mcps: [], schedule: null },
      fakeSchema,
    );
    expect(out).toBe(
      'type: skill\noutput: document\noutput_category: null\nrequires_mcps: []\nschedule: null',
    );
  });

  it('emits block-form arrays for non-empty string arrays', () => {
    const out = emitSchemaYaml(
      { output: 'document', output_category: null, requires_mcps: ['sentry', 'axiom'], schedule: null },
      fakeSchema,
    );
    expect(out).toBe(
      'type: skill\noutput: document\noutput_category: null\nrequires_mcps:\n  - sentry\n  - axiom\nschedule: null',
    );
  });

  it('emits ordered keys per schema.fields, with type first', () => {
    const out = emitSchemaYaml(
      // deliberately-shuffled input
      { schedule: null, output_category: 'Reports', requires_mcps: [], output: 'message' },
      fakeSchema,
    );
    expect(out).toBe(
      'type: skill\noutput: message\noutput_category: Reports\nrequires_mcps: []\nschedule: null',
    );
  });
});

const fakeWithString: FrontmatterSchema = {
  type: 'doc',
  label: 'Doc',
  fields: [{ kind: 'string', name: 'name', label: 'Name' }],
  defaults: () => ({ name: '' }),
  validate: () => ({ ok: true, value: {} }),
};

describe('emitSchemaYaml — string kind edge cases', () => {
  it('emits empty scalar when a string value is null (documents silent-empty)', () => {
    const out = emitSchemaYaml({ name: null }, fakeWithString);
    expect(out).toBe('type: doc\nname: ');
  });
});

describe('joinFrontmatter', () => {
  it('produces a canonical file with a blank line between fences and body', () => {
    const joined = joinFrontmatter(
      { output: 'document', output_category: null, requires_mcps: [], schedule: null },
      'Body line\n',
      fakeSchema,
    );
    expect(joined).toBe(
      '---\ntype: skill\noutput: document\noutput_category: null\nrequires_mcps: []\nschedule: null\n---\n\nBody line\n',
    );
  });

  it('returns body unchanged when schema is null', () => {
    const joined = joinFrontmatter(null, '# No frontmatter\n', null);
    expect(joined).toBe('# No frontmatter\n');
  });

  it('returns body unchanged when value is null but schema is provided', () => {
    const joined = joinFrontmatter(null, 'Body only\n', fakeSchema);
    expect(joined).toBe('Body only\n');
  });

  it('is byte-stable: split→join with the same value reproduces the file', () => {
    const original =
      '---\ntype: skill\noutput: document\noutput_category: null\nrequires_mcps: []\nschedule: null\n---\n\nHello\n';
    const { body } = splitFrontmatter(original);
    const joined = joinFrontmatter(
      { output: 'document', output_category: null, requires_mcps: [], schedule: null },
      body,
      fakeSchema,
    );
    expect(joined).toBe(original);
  });
});
