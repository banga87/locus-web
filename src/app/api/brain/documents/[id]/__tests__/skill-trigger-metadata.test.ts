// Tests for the skill-trigger frontmatter → metadata sync in the PATCH route.
//
// When a triggerable skill doc's body is updated with new YAML frontmatter
// (e.g. a changed requires_mcps array under the nested `trigger:` block), the
// PATCH handler parses the body's frontmatter with js-yaml, validates the
// nested `trigger` block via validateSkillTrigger, and mirrors the authored
// fields into `documents.metadata.trigger`. Without this sync the trigger
// route's preflight reads stale metadata and the user's edits are silently
// invisible at run time.
//
// Strategy: mock auth + brain lookup, and use a query-builder mock that
// records the `.set()` payload on the update() chain so we can assert on
// the exact metadata the route writes.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Auth mock ------------------------------------------------------------

const requireAuth = vi.fn();
const requireRole = vi.fn();
vi.mock('@/lib/api/auth', () => ({
  requireAuth: (...a: unknown[]) => requireAuth(...a),
  requireRole: (...a: unknown[]) => requireRole(...a),
}));

// ---- Brain / manifest mocks ----------------------------------------------

vi.mock('@/lib/brain/queries', () => ({
  getBrainForCompany: vi.fn(async () => ({ id: 'brain-1', companyId: 'co-1' })),
}));

vi.mock('@/lib/brain/manifest-regen', () => ({
  tryRegenerateManifest: vi.fn(async () => {}),
}));

vi.mock('@/lib/ingestion/attachments', () => ({
  getAttachment: vi.fn(async () => null),
  markCommitted: vi.fn(async () => {}),
}));

// ---- DB mock --------------------------------------------------------------
//
// A small builder that returns scripted results for terminal awaits but
// also captures the most recent .set() and .values() payloads so the test
// can inspect exactly what the route wrote.

interface WriteCapture {
  setPayloads: Array<Record<string, unknown>>;
  valuesPayloads: Array<Record<string, unknown>>;
}
const writes: WriteCapture = { setPayloads: [], valuesPayloads: [] };

let nextResults: unknown[] = [];

function popResult() {
  return nextResults.shift() ?? [];
}

function makeBuilder() {
  // Each builder is a "thenable" — awaiting it pops the next scripted
  // result. Chain methods return the same builder.
  const b: Record<string, unknown> = {};
  b.where = () => b;
  b.limit = () => b;
  b.orderBy = () => b;
  b.leftJoin = () => b;
  b.innerJoin = () => b;
  b.from = () => b;
  b.returning = () => b;
  b.set = (payload: Record<string, unknown>) => {
    writes.setPayloads.push(payload);
    return b;
  };
  b.values = (payload: Record<string, unknown>) => {
    writes.valuesPayloads.push(payload);
    return b;
  };
  b.then = (resolve: (v: unknown) => void) => resolve(popResult());
  return b;
}

vi.mock('@/db', () => ({
  db: {
    select: () => makeBuilder(),
    insert: () => makeBuilder(),
    update: () => makeBuilder(),
    delete: () => makeBuilder(),
  },
}));

vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => a,
  or: (...a: unknown[]) => a,
  eq: () => undefined,
  desc: () => undefined,
  asc: () => undefined,
  isNull: () => undefined,
  lt: () => undefined,
  max: () => undefined,
  sql: Object.assign(() => undefined, { raw: () => undefined }),
}));

vi.mock('@/db/schema', () => ({
  documents: {},
  documentVersions: {},
  folders: {},
  users: {},
}));

// ---- Subject --------------------------------------------------------------

import { PATCH as itemPATCH } from '@/app/api/brain/documents/[id]/route';

function ctxOf(role: 'owner' | 'admin' | 'editor' | 'viewer') {
  return {
    userId: 'u-1',
    companyId: 'co-1',
    role,
    email: 'a@example.com',
    fullName: 'Alice',
  };
}

function makeReq(body: unknown) {
  return new Request('http://x', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: 'd-1' });

// A triggerable skill doc — `type: 'skill'` with a nested `trigger:` block
// in both the content body and mirrored under metadata.trigger. Mirrors the
// shape produced by the PATCH/POST sync in production.
const triggerableSkillDoc = {
  id: 'd-1',
  companyId: 'co-1',
  brainId: 'brain-1',
  folderId: 'f-1',
  title: 'Triggerable Skill',
  slug: 'skill',
  path: 'folder/skill',
  content:
    '---\ntype: skill\ntrigger:\n  output: document\n  output_category: null\n  requires_mcps:\n    - sentry\n  schedule: null\n---\n\nbody',
  summary: null,
  status: 'draft',
  ownerId: 'u-1',
  confidenceLevel: 'medium',
  isCore: false,
  version: 1,
  tags: [],
  relatedDocuments: [],
  // existing metadata — seeded to simulate a prior sync.
  metadata: {
    outbound_links: [],
    trigger: {
      output: 'document',
      output_category: null,
      requires_mcps: ['sentry'],
      schedule: null,
    },
  },
  type: 'skill',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
  tokenEstimate: 0,
};

beforeEach(() => {
  requireAuth.mockReset();
  requireRole.mockReset();
  nextResults = [];
  writes.setPayloads = [];
  writes.valuesPayloads = [];
});

describe('PATCH /api/brain/documents/[id] — skill trigger frontmatter sync', () => {
  it('syncs requires_mcps from the nested trigger block into metadata.trigger', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});

    // Script the reads: 1) existing-doc lookup 2) update returning 3) insert version
    nextResults.push([triggerableSkillDoc]);
    nextResults.push([{ ...triggerableSkillDoc, version: 2 }]);
    nextResults.push([]);

    // New content: requires_mcps expanded from [sentry] to [sentry, posthog]
    const newContent = [
      '---',
      'type: skill',
      'trigger:',
      '  output: document',
      '  output_category: null',
      '  requires_mcps:',
      '    - sentry',
      '    - posthog',
      '  schedule: null',
      '---',
      '',
      'updated body',
    ].join('\n');

    const res = await itemPATCH(makeReq({ content: newContent }), { params });
    expect(res.status).toBe(200);

    // The update's .set() payload should carry metadata with the new trigger.
    const updateSet = writes.setPayloads.find(
      (p) => p.metadata !== undefined,
    );
    expect(updateSet).toBeDefined();

    const metadata = updateSet!.metadata as Record<string, unknown>;
    const trigger = metadata.trigger as Record<string, unknown>;
    expect(trigger).toBeDefined();
    expect(trigger.requires_mcps).toEqual(['sentry', 'posthog']);
    expect(trigger.output).toBe('document');
    expect(trigger.output_category).toBeNull();
    expect(trigger.schedule).toBeNull();
    // Existing non-trigger metadata fields are preserved:
    expect(metadata.outbound_links).toBeDefined();
  });

  it('silently skips sync when YAML is malformed; existing metadata.trigger preserved', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});

    nextResults.push([triggerableSkillDoc]);
    nextResults.push([{ ...triggerableSkillDoc, version: 2 }]);
    nextResults.push([]);

    // Broken YAML — unbalanced brackets.
    const brokenContent = [
      '---',
      'type: skill',
      'trigger:',
      '  output: document',
      '  requires_mcps: [sentry, posthog', // missing closing bracket
      '---',
      '',
      'body',
    ].join('\n');

    const res = await itemPATCH(
      makeReq({ content: brokenContent }),
      { params },
    );
    expect(res.status).toBe(200);

    const updateSet = writes.setPayloads.find(
      (p) => p.metadata !== undefined,
    );
    expect(updateSet).toBeDefined();

    const metadata = updateSet!.metadata as Record<string, unknown>;
    // The ORIGINAL metadata.trigger is preserved via the existingMetadata
    // spread (silent-skip policy) — NOT the broken parse's result.
    const trigger = metadata.trigger as Record<string, unknown>;
    expect(trigger).toBeDefined();
    expect(trigger.requires_mcps).toEqual(['sentry']);
  });

  it('preserves existing metadata.trigger when the new frontmatter omits the trigger block', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});

    nextResults.push([triggerableSkillDoc]);
    nextResults.push([{ ...triggerableSkillDoc, version: 2 }]);
    nextResults.push([]);

    // Valid skill frontmatter but without a `trigger:` block. Per the silent-
    // skip policy the existing metadata.trigger must survive unchanged —
    // otherwise removing the trigger block from the body would silently
    // disable the skill's triggerability on save.
    const newContent = [
      '---',
      'type: skill',
      '---',
      '',
      'body with no trigger',
    ].join('\n');

    const res = await itemPATCH(makeReq({ content: newContent }), { params });
    expect(res.status).toBe(200);

    const updateSet = writes.setPayloads.find(
      (p) => p.metadata !== undefined,
    );
    expect(updateSet).toBeDefined();

    const metadata = updateSet!.metadata as Record<string, unknown>;
    const trigger = metadata.trigger as Record<string, unknown>;
    expect(trigger).toBeDefined();
    expect(trigger.requires_mcps).toEqual(['sentry']);
    expect(trigger.output).toBe('document');
  });

  it('silently skips sync when the trigger block is invalid shape; existing metadata.trigger preserved', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});

    nextResults.push([triggerableSkillDoc]);
    nextResults.push([{ ...triggerableSkillDoc, version: 2 }]);
    nextResults.push([]);

    // Valid YAML parse, but the trigger block is missing required `output`
    // and `requires_mcps`. validateSkillTrigger rejects → silent-skip.
    const newContent = [
      '---',
      'type: skill',
      'trigger:',
      '  schedule: null',
      '---',
      '',
      'body',
    ].join('\n');

    const res = await itemPATCH(makeReq({ content: newContent }), { params });
    expect(res.status).toBe(200);

    const updateSet = writes.setPayloads.find(
      (p) => p.metadata !== undefined,
    );
    expect(updateSet).toBeDefined();

    const metadata = updateSet!.metadata as Record<string, unknown>;
    const trigger = metadata.trigger as Record<string, unknown>;
    // Existing metadata.trigger preserved — not overwritten with the invalid
    // shape.
    expect(trigger).toBeDefined();
    expect(trigger.requires_mcps).toEqual(['sentry']);
    expect(trigger.output).toBe('document');
  });

  it('does not sync trigger fields for non-skill docs', async () => {
    requireAuth.mockResolvedValue(ctxOf('editor'));
    requireRole.mockImplementation(() => {});

    // Plain knowledge doc (type: null), not a skill.
    const plainDoc = {
      ...triggerableSkillDoc,
      type: null,
      metadata: { outbound_links: [] },
    };
    nextResults.push([plainDoc]);
    nextResults.push([{ ...plainDoc, version: 2 }]);
    nextResults.push([]);

    // Even if body accidentally contains a trigger-shaped frontmatter, a plain
    // doc (type: null) won't sync trigger fields. Here the new content has no
    // frontmatter at all.
    const newContent = 'plain markdown body, no frontmatter';

    const res = await itemPATCH(makeReq({ content: newContent }), { params });
    expect(res.status).toBe(200);

    const updateSet = writes.setPayloads.find(
      (p) => p.metadata !== undefined,
    );
    expect(updateSet).toBeDefined();

    const metadata = updateSet!.metadata as Record<string, unknown>;
    // Non-skill doc gets outbound_links recomputed; no trigger sub-object
    // appears because the sync is scoped to newType === 'skill'.
    expect(metadata.trigger).toBeUndefined();
  });
});
