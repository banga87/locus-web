// Integration test for the skill manifest loader.
//
// Runs against live Supabase via the Drizzle superuser connection
// (DATABASE_URL — bypasses RLS so we can seed fixtures without the
// Supabase Auth dance). Mirrors the fixture pattern in
// `src/db/__tests__/schema.test.ts` and `src/__tests__/integration/`:
// create a unique company + brain in `beforeAll`, tear down in
// `afterAll`. We deliberately skip `seedBrainFromUniversalPack` here —
// the loader test wants a clean slate, and seeded universal docs would
// only add noise to the manifest assertions.
//
// Coverage:
//   1. Insert one skill doc, rebuild, assert the manifest row exists
//      and contains exactly that skill.
//   2. Update the doc's title (re-parsed from frontmatter), rebuild,
//      assert the new title flows through and `built_at` advances.
//   3. Soft-delete the doc (deletedAt = now()), rebuild, assert the
//      skill is absent from the manifest.
//   4. Insert a malformed-frontmatter skill alongside a good skill,
//      rebuild, assert the good skill survives and the bad skill
//      surfaces as a diagnostic — proving one bad doc never poisons
//      the rest of the manifest.
//
// Important: this file uses `rebuildManifest` directly, never
// `scheduleManifestRebuild`. The scheduler uses setTimeout which would
// leak handles across the test run.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { db } from '@/db';
import {
  brains,
  categories,
  companies,
  documents,
  skillManifests,
} from '@/db/schema';

import { rebuildManifest, loadManifest } from './loader';
import type { SkillManifest } from './manifest-compiler';

// ---- Fixture --------------------------------------------------------------
//
// Plain company/brain/category — no Universal Pack seeding so the only
// docs in this brain are the ones the test creates.

const suffix = `loader-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let companyId: string;
let brainId: string;
let categoryId: string;
let skillDocId: string;

const skillContent = `---
type: skill
title: Draft a Landing Page
description: Use when the user asks to draft a landing page or hero copy.
triggers:
  phrases:
    - landing page
    - hero section
  allOf:
    - [draft, write]
  anyOf:
    - conversion
  minScore: 2
priority: 7
---

Skill body here.`;

beforeAll(async () => {
  const [company] = await db
    .insert(companies)
    .values({ name: `Loader Test Co ${suffix}`, slug: `loader-${suffix}` })
    .returning({ id: companies.id });
  companyId = company.id;

  const [brain] = await db
    .insert(brains)
    .values({ companyId, name: 'Loader Brain', slug: 'main' })
    .returning({ id: brains.id });
  brainId = brain.id;

  const [category] = await db
    .insert(categories)
    .values({
      companyId,
      brainId,
      slug: `skills-${suffix}`,
      name: 'Skills',
    })
    .returning({ id: categories.id });
  categoryId = category.id;
}, 60_000);

afterAll(async () => {
  // Order matters: skill_manifests cascades off companies, but documents
  // / categories cascade off brains. document_versions has an
  // immutability trigger; the loader test creates no version rows
  // (we INSERT directly, not via the route handler) so we can skip the
  // trigger dance — but to be safe we wrap brain delete the same way.
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`ALTER TABLE document_versions DISABLE TRIGGER document_versions_immutable`,
    );
    await tx.delete(brains).where(eq(brains.id, brainId));
    await tx.execute(
      sql`ALTER TABLE document_versions ENABLE TRIGGER document_versions_immutable`,
    );
  });
  // Cascade drops skill_manifests row.
  await db.delete(companies).where(eq(companies.id, companyId));
}, 60_000);

// ---- Tests ----------------------------------------------------------------

describe('rebuildManifest (integration)', () => {
  it('compiles a single skill doc into the cached manifest', async () => {
    const [doc] = await db
      .insert(documents)
      .values({
        companyId,
        brainId,
        categoryId,
        title: 'Draft a Landing Page',
        slug: 'draft-landing-page',
        path: `skills-${suffix}/draft-landing-page`,
        content: skillContent,
        type: 'skill',
        version: 1,
      })
      .returning({ id: documents.id });
    skillDocId = doc.id;

    await rebuildManifest(companyId);

    const manifest = await loadManifest(companyId);
    expect(manifest).not.toBeNull();
    expect(manifest!.version).toBe(1);
    expect(manifest!.skills).toHaveLength(1);
    expect(manifest!.skills[0].id).toBe(skillDocId);
    expect(manifest!.skills[0].title).toBe('Draft a Landing Page');
    expect(manifest!.skills[0].priority).toBe(7);
    expect(manifest!.skills[0].triggers.phrases).toContain('landing page');
    expect(manifest!.diagnostics).toHaveLength(0);

    // Sanity: the skill_manifests row's built_at column matches the
    // manifest body's timestamp roughly.
    const [row] = await db
      .select()
      .from(skillManifests)
      .where(eq(skillManifests.companyId, companyId));
    expect(row).toBeDefined();
    expect(row.builtAt).toBeInstanceOf(Date);
  });

  it('reflects updates to a skill doc on the next rebuild', async () => {
    const before = await loadManifest(companyId);
    expect(before).not.toBeNull();
    const beforeBuiltAt = before!.builtAt;

    const updatedContent = skillContent.replace(
      'Draft a Landing Page',
      'Draft a Killer Landing Page',
    );
    await db
      .update(documents)
      .set({
        content: updatedContent,
        title: 'Draft a Killer Landing Page',
        updatedAt: new Date(),
      })
      .where(eq(documents.id, skillDocId));

    // Make sure the new builtAt is strictly later than the previous one.
    // setTimeout(0) inside this fixture would still resolve in the same
    // millisecond on a fast machine — block on a no-op delay instead.
    await new Promise((r) => setTimeout(r, 5));

    await rebuildManifest(companyId);

    const after = await loadManifest(companyId);
    expect(after).not.toBeNull();
    expect(after!.skills).toHaveLength(1);
    expect(after!.skills[0].title).toBe('Draft a Killer Landing Page');
    expect(new Date(after!.builtAt).getTime()).toBeGreaterThan(
      new Date(beforeBuiltAt).getTime(),
    );
  });

  it('drops soft-deleted skill docs from the next rebuild', async () => {
    await db
      .update(documents)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(documents.id, skillDocId));

    await rebuildManifest(companyId);

    const manifest = await loadManifest(companyId);
    expect(manifest).not.toBeNull();
    expect(manifest!.skills).toHaveLength(0);
    expect(manifest!.diagnostics).toHaveLength(0);
  });

  it('keeps good skills when a sibling skill has malformed frontmatter', async () => {
    // Insert a fresh good skill so we have something to survive the bad doc.
    const goodId = randomUUID();
    const [good] = await db
      .insert(documents)
      .values({
        id: goodId,
        companyId,
        brainId,
        categoryId,
        title: 'Good Skill',
        slug: `good-skill-${suffix}`,
        path: `skills-${suffix}/good-skill-${suffix}`,
        content: skillContent.replace(
          'Draft a Landing Page',
          'Good Skill',
        ),
        type: 'skill',
        version: 1,
      })
      .returning({ id: documents.id });

    // And a malformed one — frontmatter present but no `triggers` block.
    const [bad] = await db
      .insert(documents)
      .values({
        companyId,
        brainId,
        categoryId,
        title: 'Bad Skill',
        slug: `bad-skill-${suffix}`,
        path: `skills-${suffix}/bad-skill-${suffix}`,
        content: `---\ntype: skill\ntitle: Bad Skill\n---\nno triggers block`,
        type: 'skill',
        version: 1,
      })
      .returning({ id: documents.id });

    await rebuildManifest(companyId);

    const manifest = (await loadManifest(companyId)) as SkillManifest;
    expect(manifest).not.toBeNull();
    // Good skill made it through.
    const skillIds = manifest.skills.map((s) => s.id);
    expect(skillIds).toContain(good.id);
    // Bad skill did not.
    expect(skillIds).not.toContain(bad.id);
    // And it surfaced as a diagnostic instead.
    const diagDocIds = manifest.diagnostics.map((d) => d.docId);
    expect(diagDocIds).toContain(bad.id);
  });
});
