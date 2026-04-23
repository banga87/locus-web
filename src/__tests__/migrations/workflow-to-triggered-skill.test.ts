/**
 * @vitest-environment node
 */
// Integration test for scripts/migrate-workflow-to-triggered-skill.ts.
//
// Proves the one-shot migration rewrites an existing `type='workflow'` doc
// into a `type='skill'` doc with its four trigger fields nested under
// `metadata.trigger` AND under a `trigger:` block in the YAML frontmatter
// of the content body — while preserving unrelated metadata fields
// (e.g. outbound_links) and the body of the content byte-for-byte.
//
// Runs against LIVE Supabase via Drizzle (DATABASE_URL). Each test seeds
// a fresh company + brain + folder + doc so nothing leaks between runs.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import yaml from 'js-yaml';

import { db } from '@/db';
import { companies } from '@/db/schema/companies';
import { brains } from '@/db/schema/brains';
import { folders } from '@/db/schema/folders';
import { documents } from '@/db/schema/documents';

import { migrate } from '../../../scripts/migrate-workflow-to-triggered-skill';

interface Fixtures {
  companyId: string;
  brainId: string;
  folderId: string;
  workflowDocId: string;
  unrelatedDocId: string;
}

const suffix = `mig-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function setupFixtures(): Promise<Fixtures> {
  const [company] = await db
    .insert(companies)
    .values({ name: `Mig Co ${suffix}`, slug: `mig-${suffix}` })
    .returning({ id: companies.id });

  const [brain] = await db
    .insert(brains)
    .values({
      companyId: company!.id,
      name: 'Mig Brain',
      slug: `mig-brain-${suffix}`,
    })
    .returning({ id: brains.id });

  const [folder] = await db
    .insert(folders)
    .values({
      companyId: company!.id,
      brainId: brain!.id,
      slug: `workflows-${suffix}`,
      name: 'Workflows',
    })
    .returning({ id: folders.id });

  // The workflow doc — old-style frontmatter with flat trigger fields.
  const oldContent = [
    '---',
    'type: workflow',
    'output: document',
    'output_category: null',
    'requires_mcps:',
    '  - linear',
    'schedule: null',
    '---',
    '',
    'hello',
  ].join('\n');

  const [workflowDoc] = await db
    .insert(documents)
    .values({
      companyId: company!.id,
      brainId: brain!.id,
      folderId: folder!.id,
      title: `Weekly standup ${suffix}`,
      slug: `weekly-standup-${suffix}`,
      path: `workflows-${suffix}/weekly-standup-${suffix}`,
      content: oldContent,
      type: 'workflow',
      version: 1,
      metadata: {
        output: 'document',
        output_category: null,
        requires_mcps: ['linear'],
        schedule: null,
        outbound_links: [],
      },
    })
    .returning({ id: documents.id });

  // An unrelated doc that must NOT be touched — regular skill.
  const [unrelatedDoc] = await db
    .insert(documents)
    .values({
      companyId: company!.id,
      brainId: brain!.id,
      folderId: folder!.id,
      title: `Regular skill ${suffix}`,
      slug: `regular-skill-${suffix}`,
      path: `workflows-${suffix}/regular-skill-${suffix}`,
      content: '---\ntype: skill\nname: "Regular"\n---\n\nbody',
      type: 'skill',
      version: 1,
      metadata: { outbound_links: [] },
    })
    .returning({ id: documents.id });

  return {
    companyId: company!.id,
    brainId: brain!.id,
    folderId: folder!.id,
    workflowDocId: workflowDoc!.id,
    unrelatedDocId: unrelatedDoc!.id,
  };
}

async function teardownFixtures(f: Fixtures): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`ALTER TABLE document_versions DISABLE TRIGGER document_versions_immutable`,
    );
    await tx.delete(brains).where(eq(brains.id, f.brainId));
    await tx.execute(
      sql`ALTER TABLE document_versions ENABLE TRIGGER document_versions_immutable`,
    );
  });
  await db.delete(companies).where(eq(companies.id, f.companyId));
}

let fix: Fixtures;

beforeAll(async () => {
  fix = await setupFixtures();
}, 60_000);

afterAll(async () => {
  await teardownFixtures(fix);
}, 60_000);

describe('migrate-workflow-to-triggered-skill', () => {
  it('rewrites a workflow doc into a triggered skill with nested trigger:', async () => {
    const result = await migrate({ dryRun: false });
    expect(result.touched).toBeGreaterThanOrEqual(1);

    const [row] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, fix.workflowDocId));

    expect(row).toBeDefined();

    // type column flipped to 'skill'.
    expect(row!.type).toBe('skill');

    // metadata now has a `trigger` sub-object; flat keys removed; unrelated
    // `outbound_links` preserved.
    const metadata = row!.metadata as Record<string, unknown>;
    expect(metadata.trigger).toEqual({
      output: 'document',
      output_category: null,
      requires_mcps: ['linear'],
      schedule: null,
    });
    expect(metadata.output).toBeUndefined();
    expect(metadata.requires_mcps).toBeUndefined();
    expect(metadata.output_category).toBeUndefined();
    expect(metadata.schedule).toBeUndefined();
    expect(metadata.outbound_links).toEqual([]);

    // Content frontmatter rewritten: top-level `type: skill` + nested
    // `trigger:` block. Body (`hello`) preserved verbatim.
    const content = row!.content;
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n)?/);
    expect(fmMatch).not.toBeNull();

    const parsed = yaml.load(fmMatch![1]) as Record<string, unknown>;
    expect(parsed.type).toBe('skill');
    expect(parsed.trigger).toEqual({
      output: 'document',
      output_category: null,
      requires_mcps: ['linear'],
      schedule: null,
    });
    // Flat workflow fields gone from top-level frontmatter.
    expect(parsed.output).toBeUndefined();
    expect(parsed.requires_mcps).toBeUndefined();

    // Body preserved.
    const body = content.slice(fmMatch![0].length).replace(/^\r?\n/, '');
    expect(body).toBe('hello');
  });

  it('leaves the unrelated skill doc untouched', async () => {
    const [row] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, fix.unrelatedDocId));

    expect(row!.type).toBe('skill');
    // Did not grow a trigger block — metadata stays intact.
    const metadata = row!.metadata as Record<string, unknown>;
    expect(metadata.trigger).toBeUndefined();
    expect(metadata.outbound_links).toEqual([]);
  });

  it('is idempotent — a second run touches nothing', async () => {
    // First call in the prior test already migrated. This second call
    // should find zero candidates because the row is now `type='skill'`
    // with `metadata.trigger` present.
    const result = await migrate({ dryRun: false });
    expect(result.touched).toBe(0);

    // Row still looks correct.
    const [row] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, fix.workflowDocId));
    const metadata = row!.metadata as Record<string, unknown>;
    expect(metadata.trigger).toBeDefined();
  });
});
