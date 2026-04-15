// Integration test for `scripts/seed-builtins.ts`.
//
// Runs against live Supabase via the Drizzle superuser connection
// (DATABASE_URL — bypasses RLS so we can seed + read without the
// Supabase Auth dance). Mirrors the fixture pattern in
// `src/lib/skills/loader.integration.test.ts` and
// `src/lib/templates/__tests__/seed.test.ts`: create a fresh
// company + brain in beforeAll, tear down in afterAll.
//
// Coverage (Phase 1.5 Task 10 Step 8):
//   1. `seedBuiltins(companyId)` inserts the ingestion-filing skill +
//      default agent-scaffolding with the expected slug / type / title
//      values and the bodies parse cleanly.
//   2. A second `seedBuiltins(companyId)` call on the same company is
//      a no-op — no duplicate rows are created.
//   3. `createDbUserPromptRepo().getIngestionFilingSkill` now returns
//      the seeded skill for this company (was stubbed null pre-Task 10).
//   4. `rebuildManifest(companyId)` picks up the seeded skill and it
//      appears in the compiled manifest's `skills[]` array under the
//      stable `ingestion-filing` slug.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import { brains, companies, documents } from '@/db/schema';
import { rebuildManifest, loadManifest } from '@/lib/skills/loader';
import { createDbUserPromptRepo } from '@/lib/context/repos';

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
  // Mirror the loader integration test's cleanup. `document_versions`
  // immutability trigger must be disabled for the cascade. Seed-builtins
  // itself never writes to document_versions (it bypasses the document
  // save helper which does version tracking — seeds are authored
  // markdown, not user edits), but we wrap defensively in case future
  // seed content triggers version writes.
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`ALTER TABLE document_versions DISABLE TRIGGER document_versions_immutable`,
    );
    await tx.delete(brains).where(eq(brains.id, brainId));
    await tx.execute(
      sql`ALTER TABLE document_versions ENABLE TRIGGER document_versions_immutable`,
    );
  });
  // skill_manifests cascades off companies — dropping the company
  // cleans up the rebuilt manifest row.
  await db.delete(companies).where(eq(companies.id, companyId));
}, 60_000);

// ---- Tests ----------------------------------------------------------------

describe('seedBuiltins (integration)', () => {
  it('inserts the ingestion-filing skill + default scaffolding', async () => {
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
      })
      .from(documents)
      .where(
        and(eq(documents.companyId, companyId), isNull(documents.deletedAt)),
      );

    expect(rows).toHaveLength(2);

    const skill = rows.find((r) => r.type === 'skill');
    const scaffolding = rows.find((r) => r.type === 'agent-scaffolding');

    expect(skill).toBeDefined();
    expect(skill!.slug).toBe('ingestion-filing');
    expect(skill!.title).toBe('Ingestion filing rules');
    // Body markers — the 6-rule structure from the plan's Step 1.
    expect(skill!.content).toContain('Inspect first');
    expect(skill!.content).toContain('Propose, don\'t write');
    expect(skill!.content).toContain('Prefer update over create');
    // Frontmatter landed with the content (the repo strips it on
    // read, but the row on disk must carry it so manifest rebuilds
    // can re-parse `triggers:` on every subsequent compile).
    expect(skill!.content).toMatch(/^---\n/);
    expect(skill!.content).toContain('slug: ingestion-filing');
    // Built-in docs live outside the folder taxonomy under a
    // `.builtins/` path prefix.
    expect(skill!.folderId).toBeNull();
    expect(skill!.path).toBe('.builtins/ingestion-filing');

    expect(scaffolding).toBeDefined();
    expect(scaffolding!.slug).toBe('company-scaffolding');
    expect(scaffolding!.title).toBe('How [Company] Works');
    expect(scaffolding!.content).toContain('## Departments');
    expect(scaffolding!.content).toContain('## Voice and tone');
    expect(scaffolding!.content).toContain('## Vocabulary');
    expect(scaffolding!.content).toContain('## Conventions');
    expect(scaffolding!.folderId).toBeNull();
    expect(scaffolding!.path).toBe('.builtins/company-scaffolding');
    // Status defaults to `active` so scaffolding loads on every
    // SessionStart without requiring a publish step.
    expect(scaffolding!.status).toBe('active');
  });

  it('is idempotent — a second call produces no duplicate rows', async () => {
    // First call already ran in the previous `it`. Call it again and
    // assert the row count stays at 2 and the ids haven't changed.
    const beforeRows = await db
      .select({ id: documents.id, slug: documents.slug })
      .from(documents)
      .where(
        and(eq(documents.companyId, companyId), isNull(documents.deletedAt)),
      );
    expect(beforeRows).toHaveLength(2);

    await seedBuiltins(companyId);

    const afterRows = await db
      .select({ id: documents.id, slug: documents.slug })
      .from(documents)
      .where(
        and(eq(documents.companyId, companyId), isNull(documents.deletedAt)),
      );
    expect(afterRows).toHaveLength(2);

    // Id stability — the idempotent branch did not delete + reinsert.
    const beforeById = new Map(beforeRows.map((r) => [r.slug, r.id]));
    const afterById = new Map(afterRows.map((r) => [r.slug, r.id]));
    expect(afterById.get('ingestion-filing')).toBe(
      beforeById.get('ingestion-filing'),
    );
    expect(afterById.get('company-scaffolding')).toBe(
      beforeById.get('company-scaffolding'),
    );
  });

  it('exposes the seeded skill through `getIngestionFilingSkill` by slug', async () => {
    const repo = createDbUserPromptRepo();
    const filing = await repo.getIngestionFilingSkill(companyId);
    expect(filing).not.toBeNull();
    // Body should NOT include the frontmatter preamble (the repo
    // strips it on read). It SHOULD include the rule markers.
    expect(filing!.body).not.toContain('type: skill');
    expect(filing!.body).toContain('Inspect first');
    expect(filing!.body).toContain('Propose, don\'t write');
  });

  it('surfaces the seeded skill in the rebuilt manifest under the stable slug', async () => {
    // Drive the rebuild synchronously (don't route through the 5s-
    // debouncer that `seedBuiltins` schedules — that would leak a
    // setTimeout handle across the test run).
    await rebuildManifest(companyId);

    const manifest = await loadManifest(companyId);
    expect(manifest).not.toBeNull();
    const ingestionFiling = manifest!.skills.find(
      (s) => s.slug === 'ingestion-filing',
    );
    expect(ingestionFiling).toBeDefined();
    expect(ingestionFiling!.title).toBe('Ingestion filing rules');
    expect(ingestionFiling!.priority).toBe(10);
    // The `triggers.phrases` array from the seed frontmatter survives
    // the compile — this is what the matcher scores against on every
    // user turn.
    expect(ingestionFiling!.triggers.phrases).toContain('process this');
    expect(ingestionFiling!.triggers.phrases).toContain('file this');
    // `minScore: 1` — the seed authorises injection on a single
    // phrase hit so the ingestion flow doesn't require repeated
    // keywords in the user prompt.
    expect(ingestionFiling!.triggers.minScore).toBe(1);
    expect(manifest!.diagnostics).toHaveLength(0);
  });
});
