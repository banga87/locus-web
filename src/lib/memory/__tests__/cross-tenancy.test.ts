// CORRECTNESS-CRITICAL: this suite is the multi-tenancy invariant.
// Any regression here is a security regression. If a test fails, STOP
// immediately and audit retrieve() before proceeding.
//
// Seeds two companies, each with its own brain + documents, then
// asserts that retrieve() scoped to company A never returns company B
// documents and vice versa.
//
// Queries use single, unambiguous terms rather than boolean OR because
// retrieve() uses plainto_tsquery, which treats the entire input as
// plain text with implicit AND between tokens (and strips common-case
// stopwords like 'or'). The cases below are designed to exercise the
// (company_id, brain_id) predicate pair without needing tsquery
// operator syntax.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { retrieve } from '../core';
import {
  seedBrainInCompany,
  teardownSeed,
  type SeededBrain,
} from './_fixtures';

describe('cross-tenancy isolation', () => {
  let a: SeededBrain;
  let b: SeededBrain;

  beforeAll(async () => {
    // Unique per-corpus terms: only "Acme" appears in A, only "narrative"
    // appears in B. No shared vocabulary so any cross-leak is unambiguous.
    a = await seedBrainInCompany({
      docs: [{ title: 'SECRET-A', content: 'Acme signed the contract terms.' }],
    });
    b = await seedBrainInCompany({
      docs: [{ title: 'OTHER-B', content: 'Unrelated narrative paragraph.' }],
    });
    expect(a.companyId).not.toBe(b.companyId);
    expect(a.brainId).not.toBe(b.brainId);
  });

  afterAll(async () => {
    await teardownSeed(a);
    await teardownSeed(b);
  });

  it('A-scope query for an A-only term returns A doc, no B doc', async () => {
    const res = await retrieve({
      companyId: a.companyId,
      brainId: a.brainId,
      query: 'Acme',
      mode: 'hybrid',
      tierCeiling: 'extracted',
      limit: 50,
    });
    const slugs = res.map((r) => r.slug);
    expect(slugs).toContain(a.docs[0].slug);
    expect(slugs).not.toContain(b.docs[0].slug);
  });

  it('A-scope query for a B-only term returns nothing (no cross-leak)', async () => {
    const res = await retrieve({
      companyId: a.companyId,
      brainId: a.brainId,
      query: 'narrative',
      mode: 'hybrid',
      tierCeiling: 'extracted',
      limit: 50,
    });
    expect(res).toEqual([]);
  });

  it('retrieve with wrong brainId for the company returns nothing', async () => {
    // Pass company A's id with company B's brainId — the compound
    // (company_id, brain_id) predicate should reject because the tuple
    // is not consistent with any row.
    const res = await retrieve({
      companyId: a.companyId,
      brainId: b.brainId,
      query: 'narrative',
      mode: 'scan',
      tierCeiling: 'extracted',
      limit: 50,
    });
    expect(res).toEqual([]);
  });

  it('B-scope query for a B-only term returns B doc, no A doc', async () => {
    const res = await retrieve({
      companyId: b.companyId,
      brainId: b.brainId,
      query: 'narrative',
      mode: 'hybrid',
      tierCeiling: 'extracted',
      limit: 50,
    });
    const slugs = res.map((r) => r.slug);
    expect(slugs).toContain(b.docs[0].slug);
    expect(slugs).not.toContain(a.docs[0].slug);
  });
});
