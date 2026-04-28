import { describe, expect, it } from 'vitest';
import { typeSchemaRegistry } from '../index';

describe('per-type frontmatter schemas', () => {
  describe('canonical', () => {
    const schema = typeSchemaRegistry.canonical.schema;
    it('accepts {owner, last_reviewed_at}', () => {
      expect(
        schema.safeParse({
          owner: 'angus',
          last_reviewed_at: '2026-04-01',
        }).success,
      ).toBe(true);
    });
    it('rejects missing owner', () => {
      expect(
        schema.safeParse({ last_reviewed_at: '2026-04-01' }).success,
      ).toBe(false);
    });
  });

  describe('decision', () => {
    const schema = typeSchemaRegistry.decision.schema;
    it('accepts {decided_by, decided_on}', () => {
      expect(
        schema.safeParse({
          decided_by: ['angus', 'sam'],
          decided_on: '2026-04-01',
        }).success,
      ).toBe(true);
    });
    it('accepts optional supersedes/superseded_by', () => {
      expect(
        schema.safeParse({
          decided_by: ['angus'],
          decided_on: '2026-04-01',
          supersedes: 'doc-prior',
        }).success,
      ).toBe(true);
    });
    it('rejects empty decided_by', () => {
      expect(
        schema.safeParse({ decided_by: [], decided_on: '2026-04-01' })
          .success,
      ).toBe(false);
    });
  });

  describe('note', () => {
    const schema = typeSchemaRegistry.note.schema;
    it('accepts captured_from = meeting', () => {
      expect(
        schema.safeParse({ captured_from: 'meeting' }).success,
      ).toBe(true);
    });
    it('rejects unknown captured_from', () => {
      expect(
        schema.safeParse({ captured_from: 'desk' }).success,
      ).toBe(false);
    });
  });

  describe('fact', () => {
    const schema = typeSchemaRegistry.fact.schema;
    it('accepts {evidence, valid_from}', () => {
      expect(
        schema.safeParse({
          evidence: 'doc-2026-04',
          valid_from: '2026-01-01',
        }).success,
      ).toBe(true);
    });
    it('rejects missing valid_from', () => {
      expect(
        schema.safeParse({ evidence: 'doc-2026-04' }).success,
      ).toBe(false);
    });
  });

  describe('procedure', () => {
    const schema = typeSchemaRegistry.procedure.schema;
    it('accepts non-empty applies_to', () => {
      expect(
        schema.safeParse({ applies_to: ['refund-request'] }).success,
      ).toBe(true);
    });
    it('rejects empty applies_to', () => {
      expect(schema.safeParse({ applies_to: [] }).success).toBe(false);
    });
  });

  describe('entity', () => {
    const schema = typeSchemaRegistry.entity.schema;
    it('accepts a customer person', () => {
      expect(
        schema.safeParse({
          kind: 'person',
          relationship: 'customer',
          current_state: 'active subscriber',
        }).success,
      ).toBe(true);
    });
    it('rejects unknown kind', () => {
      expect(
        schema.safeParse({
          kind: 'spaceship',
          relationship: 'customer',
          current_state: 'x',
        }).success,
      ).toBe(false);
    });
  });

  describe('artifact', () => {
    const schema = typeSchemaRegistry.artifact.schema;
    it('accepts a live artifact', () => {
      expect(
        schema.safeParse({
          lifecycle: 'live',
          version: 1,
          owner: 'angus',
        }).success,
      ).toBe(true);
    });
    it('rejects negative version', () => {
      expect(
        schema.safeParse({
          lifecycle: 'live',
          version: -1,
          owner: 'angus',
        }).success,
      ).toBe(false);
    });
  });

  it('registry covers all seven standard types', () => {
    expect(Object.keys(typeSchemaRegistry).sort()).toEqual([
      'artifact',
      'canonical',
      'decision',
      'entity',
      'fact',
      'note',
      'procedure',
    ]);
  });

  it('every entry has a non-empty `example`', () => {
    for (const [type, entry] of Object.entries(typeSchemaRegistry)) {
      expect(
        Object.keys(entry.example).length,
        `example for ${type} must be non-empty`,
      ).toBeGreaterThan(0);
    }
  });
});
