// Integration test for `scripts/seed-builtins.ts`.
//
// Runs against live Supabase via the Drizzle superuser connection
// (DATABASE_URL — bypasses RLS so we can seed + read without the
// Supabase Auth dance). Fresh company + brain in beforeAll, tear
// down in afterAll.
//
// Coverage:
//   1. `seedBuiltins(companyId)` inserts:
//       - the ingestion-filing skill (via writeSkillTree — type='skill')
//       - the skill-creator skill + description-writing resource
//       - default agent-scaffolding (direct insert — type='agent-scaffolding')
//   2. A second `seedBuiltins(companyId)` call on the same company is
//      a no-op — no duplicate rows are created.
//
// Task 19 note: skill seeds are now routed through writeSkillTree so they
// share document structure (slug = slugify(name), path = skills/<slug>,
// content has Tatara-native frontmatter) with user-authored and imported skills.
// The legacy `.builtins/ingestion-filing` path is no longer produced.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import { brains, companies, documents } from '@/db/schema';

import { seedBuiltins } from '../seed-builtins';

// ---- Fixture --------------------------------------------------------------

const suffix = `seed-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let companyId: string;
let brainId: string;

beforeAll(async () => {
  const [company] = await db
    .insert(companies)
    .values({ name: `Seed-builtins Test Co ${suffix}`, slug: `seed-b-${suffix}` })
    .returning({ id: companies.id });
  companyId = company.id;

  const [brain] = await db
    .insert(brains)
    .values({ companyId, name: 'Main', slug: 'main' })
    .returning({ id: brains.id });
  brainId = brain.id;
}, 60_000);

afterAll(async () => {
  // `document_versions` immutability trigger must be disabled for the
  // cascade. Seed-builtins itself never writes to document_versions
  // (it bypasses the document save helper which does version tracking
  // — seeds are authored markdown, not user edits), but we wrap
  // defensively in case future seed content triggers version writes.
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`ALTER TABLE document_versions DISABLE TRIGGER document_versions_immutable`,
    );
    await tx.delete(brains).where(eq(brains.id, brainId));
    await tx.execute(
      sql`ALTER TABLE document_versions ENABLE TRIGGER document_versions_immutable`,
    );
  });
  await db.delete(companies).where(eq(companies.id, companyId));
}, 60_000);

// ---- Tests ----------------------------------------------------------------

describe('seedBuiltins (integration)', () => {
  it('inserts the ingestion-filing skill + skill-creator skill + default scaffolding', async () => {
    await seedBuiltins(companyId);

    const rows = await db
      .select({
        id: documents.id,
        type: documents.type,
        slug: documents.slug,
        title: documents.title,
        content: documents.content,
        folderId: documents.folderId,
        status: documents.status,
        path: documents.path,
        parentSkillId: documents.parentSkillId,
      })
      .from(documents)
      .where(
        and(eq(documents.companyId, companyId), isNull(documents.deletedAt)),
      );

    // Expected rows:
    //   1. ingestion-filing skill root (type='skill')
    //   2. skill-creator skill root (type='skill')
    //   3. description-writing resource (type='skill-resource')
    //   4. default agent-scaffolding (type='agent-scaffolding')
    expect(rows).toHaveLength(4);

    // ---- ingestion-filing skill -------------------------------------------
    const ingestionSkill = rows.find(
      (r) => r.type === 'skill' && r.title === 'Ingestion filing rules',
    );
    expect(ingestionSkill).toBeDefined();
    // writeSkillTree slugifies the name: 'Ingestion filing rules' → 'ingestion-filing-rules'
    expect(ingestionSkill!.slug).toBe('ingestion-filing-rules');
    expect(ingestionSkill!.path).toBe('skills/ingestion-filing-rules');
    expect(ingestionSkill!.folderId).toBeNull();
    expect(ingestionSkill!.status).toBe('active');
    // Body content present.
    expect(ingestionSkill!.content).toContain('Inspect first');
    expect(ingestionSkill!.content).toContain("Propose, don't write");
    // Tatara-native frontmatter (no slug/title keys in frontmatter).
    expect(ingestionSkill!.content).toMatch(/^---\n/);
    expect(ingestionSkill!.content).toContain('name: Ingestion filing rules');
    // No resources for this single-file skill.
    const ingestionResources = rows.filter(
      (r) =>
        r.type === 'skill-resource' &&
        r.parentSkillId === ingestionSkill!.id,
    );
    expect(ingestionResources).toHaveLength(0);

    // ---- skill-creator skill ----------------------------------------------
    const skillCreator = rows.find(
      (r) => r.type === 'skill' && r.title === 'skill-creator',
    );
    expect(skillCreator).toBeDefined();
    expect(skillCreator!.slug).toBe('skill-creator');
    expect(skillCreator!.path).toBe('skills/skill-creator');
    expect(skillCreator!.folderId).toBeNull();
    expect(skillCreator!.status).toBe('active');
    expect(skillCreator!.content).toContain('Skill Creator');
    // Tatara-native frontmatter.
    expect(skillCreator!.content).toMatch(/^---\n/);
    expect(skillCreator!.content).toContain('name: skill-creator');

    // ---- skill-creator resource (description-writing) --------------------
    const descWriting = rows.find(
      (r) => r.type === 'skill-resource',
    );
    expect(descWriting).toBeDefined();
    expect(descWriting!.parentSkillId).toBe(skillCreator!.id);
    expect(descWriting!.content.length).toBeGreaterThan(10);

    // ---- default agent-scaffolding ----------------------------------------
    const scaffolding = rows.find((r) => r.type === 'agent-scaffolding');
    expect(scaffolding).toBeDefined();
    expect(scaffolding!.slug).toBe('company-scaffolding');
    expect(scaffolding!.title).toBe('How [Company] Works');
    expect(scaffolding!.content).toContain('## Departments');
    expect(scaffolding!.content).toContain('## Voice and tone');
    expect(scaffolding!.content).toContain('## Vocabulary');
    expect(scaffolding!.content).toContain('## Conventions');
    expect(scaffolding!.folderId).toBeNull();
    expect(scaffolding!.path).toBe('.builtins/company-scaffolding');
    expect(scaffolding!.status).toBe('active');
  });

  it('is idempotent — a second call produces no duplicate rows', async () => {
    // First call already ran in the previous `it`. Call it again and
    // assert the row count stays at 4 and the ids haven't changed.
    const beforeRows = await db
      .select({ id: documents.id, slug: documents.slug, type: documents.type })
      .from(documents)
      .where(
        and(eq(documents.companyId, companyId), isNull(documents.deletedAt)),
      );
    expect(beforeRows).toHaveLength(4);

    await seedBuiltins(companyId);

    const afterRows = await db
      .select({ id: documents.id, slug: documents.slug, type: documents.type })
      .from(documents)
      .where(
        and(eq(documents.companyId, companyId), isNull(documents.deletedAt)),
      );
    expect(afterRows).toHaveLength(4);

    // Id stability — the idempotent branch did not delete + reinsert.
    const beforeById = new Map(beforeRows.map((r) => [r.slug, r.id]));
    const afterById = new Map(afterRows.map((r) => [r.slug, r.id]));

    expect(afterById.get('ingestion-filing-rules')).toBe(
      beforeById.get('ingestion-filing-rules'),
    );
    expect(afterById.get('skill-creator')).toBe(
      beforeById.get('skill-creator'),
    );
    expect(afterById.get('company-scaffolding')).toBe(
      beforeById.get('company-scaffolding'),
    );
  });
});
