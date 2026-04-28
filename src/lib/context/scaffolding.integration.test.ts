// Integration test for the SessionStart scaffolding loader.
//
// Runs against live Supabase via the Drizzle superuser connection
// (DATABASE_URL — bypasses RLS so we can seed + read without the
// Supabase Auth dance). Mirrors the fixture pattern in
// `src/lib/skills/loader.integration.test.ts` — create a fresh
// company + brain in beforeAll, tear down in afterAll. We skip
// `seedBrainFromUniversalPack` on purpose: the universal pack adds
// noise the scaffolding test doesn't need, and the `agent-
// scaffolding` doc must be the ONLY row of its type in the company
// (partial-unique constraint from migration 0008).
//
// Why the direct-call approach instead of end-to-end through
// `runAgentTurn`: the hook bus rethrows handler errors today and the
// Phase 1 `inject` decision path throws until Phase 2 wires splice
// semantics. End-to-end through `runAgentTurn` would either need a
// Phase 2 stub to consume the inject payload or a denylist of Phase
// 1 behaviour that contradicts the hook contract. Both are fragile.
// Invoking `buildScaffoldingPayload` directly with a real DB repo is
// the tight test: it proves the queries + frontmatter parse + block
// assembly all work end-to-end; the wrapper logic (try/catch +
// idempotence) is covered by the unit tests in `scaffolding.test.ts`.
//
// Coverage:
//   1. Happy path — scaffolding + agent-definition + 2 baseline docs
//      all present, blocks materialise in the expected order with
//      bodies stripped of frontmatter.
//   2. A baseline doc flipped to `status = 'archived'` shows up in
//      the payload with the archived annotation appended.
//   3. Stale `agentDefinitionId` (soft-deleted) degrades to
//      scaffolding-only without throwing.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import yaml from 'js-yaml';

import { db } from '@/db';
import { brains, companies, documents, folders } from '@/db/schema';

import {
  __clearScaffoldingCacheForTests,
  createDbScaffoldingRepo,
} from './repos';
import { buildScaffoldingPayload } from './scaffolding';

// ---- Fixture --------------------------------------------------------------

const suffix = `scaf-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let companyId: string;
let brainId: string;
let folderId: string;
let scaffoldingDocId: string;
let agentDefinitionDocId: string;
let baselineDoc1Id: string;
let baselineDoc2Id: string;

function scaffoldingContent(): string {
  return `---
type: agent-scaffolding
title: How ${suffix} Works
version: 2
---

${suffix} is a marketing agency that helps brands find their voice.
Use this context on every turn.`;
}

function baselineContent(title: string, body: string): string {
  return `---
type: knowledge
title: ${title}
---

${body}`;
}

beforeAll(async () => {
  const [company] = await db
    .insert(companies)
    .values({ name: `Scaffolding Test Co ${suffix}`, slug: `scaf-${suffix}` })
    .returning({ id: companies.id });
  companyId = company.id;

  const [brain] = await db
    .insert(brains)
    .values({ companyId, name: 'Main', slug: 'main' })
    .returning({ id: brains.id });
  brainId = brain.id;

  const [folder] = await db
    .insert(folders)
    .values({
      companyId,
      brainId,
      slug: `scaf-cat-${suffix}`,
      name: 'Scaffolding',
      path: `scaf-cat-${suffix}`,
    })
    .returning({ id: folders.id });
  folderId = folder.id;

  // Scaffolding doc — singleton per company (partial-unique index).
  const [scaffolding] = await db
    .insert(documents)
    .values({
      companyId,
      brainId,
      folderId,
      title: `How ${suffix} Works`,
      slug: `how-${suffix}-works`,
      path: `scaf-cat-${suffix}/how-${suffix}-works`,
      content: scaffoldingContent(),
      type: 'agent-scaffolding',
      version: 1,
    })
    .returning({ id: documents.id });
  scaffoldingDocId = scaffolding.id;

  // Two baseline docs the agent-definition points at.
  const [baseline1] = await db
    .insert(documents)
    .values({
      companyId,
      brainId,
      folderId,
      title: 'Brand Voice',
      slug: `brand-voice-${suffix}`,
      path: `scaf-cat-${suffix}/brand-voice-${suffix}`,
      content: baselineContent('Brand Voice', 'Friendly, direct, never corporate.'),
      status: 'active',
      type: 'knowledge',
      version: 1,
    })
    .returning({ id: documents.id });
  baselineDoc1Id = baseline1.id;

  const [baseline2] = await db
    .insert(documents)
    .values({
      companyId,
      brainId,
      folderId,
      title: 'Pricing Model',
      slug: `pricing-model-${suffix}`,
      path: `scaf-cat-${suffix}/pricing-model-${suffix}`,
      content: baselineContent('Pricing Model', 'Usage-based, opaque rates.'),
      status: 'active',
      type: 'knowledge',
      version: 1,
    })
    .returning({ id: documents.id });
  baselineDoc2Id = baseline2.id;

  // Agent-definition — frontmatter-only, arrays via js-yaml so the
  // read path can round-trip them. Mirrors what
  // `buildAgentDefinitionDoc` produces in `src/lib/agents/definitions.ts`.
  const agentFrontmatter = {
    type: 'agent-definition',
    title: 'Marketing Copywriter',
    slug: `marketing-copywriter-${suffix}`,
    model: 'claude-sonnet-4-6',
    tool_allowlist: null,
    baseline_docs: [baselineDoc1Id, baselineDoc2Id],
    skills: [],
    system_prompt_snippet:
      'You are a senior marketing copywriter. Lead with sharp hooks.',
  };
  const yamlStr = yaml.dump(agentFrontmatter, { lineWidth: 120 }).trimEnd();
  const agentContent = `---\n${yamlStr}\n---\n`;

  const [agentDef] = await db
    .insert(documents)
    .values({
      companyId,
      brainId,
      folderId,
      title: 'Marketing Copywriter',
      slug: `marketing-copywriter-${suffix}`,
      path: `scaf-cat-${suffix}/marketing-copywriter-${suffix}`,
      content: agentContent,
      type: 'agent-definition',
      version: 1,
    })
    .returning({ id: documents.id });
  agentDefinitionDocId = agentDef.id;

  // The repo caches scaffolding by (companyId, version); other
  // suites running in the same process could leave cache state
  // around. Clear before the first assertion.
  __clearScaffoldingCacheForTests();
}, 60_000);

afterAll(async () => {
  // Mirror the loader integration test's cleanup — disable the
  // document_versions immutability trigger inside a transaction so
  // the brain cascade can reach through any version rows.
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

describe('buildScaffoldingPayload (integration with live DB)', () => {
  it('materialises scaffolding + snippet + baseline blocks end-to-end', async () => {
    const repo = createDbScaffoldingRepo();
    const payload = await buildScaffoldingPayload(
      { companyId, agentDefinitionId: agentDefinitionDocId },
      repo,
    );

    expect(payload.blocks.map((b) => b.kind)).toEqual([
      'scaffolding',
      'agent-prompt-snippet',
      'baseline',
      'baseline',
    ]);

    // Scaffolding block: body is the content minus the frontmatter.
    const scaffolding = payload.blocks[0];
    expect(scaffolding.sourceDocId).toBe(scaffoldingDocId);
    expect(scaffolding.title).toBe(`How ${suffix} Works`);
    expect(scaffolding.body).toContain('marketing agency');
    // Frontmatter should NOT leak into the injected body.
    expect(scaffolding.body).not.toContain('type: agent-scaffolding');

    // Agent snippet: straight through from frontmatter.
    const snippet = payload.blocks[1];
    expect(snippet.sourceDocId).toBe(agentDefinitionDocId);
    expect(snippet.body).toContain('senior marketing copywriter');
    expect(snippet.title).toContain('Marketing Copywriter');

    // Baseline docs preserve the order the agent-definition recorded.
    const baselines = payload.blocks.slice(2);
    expect(baselines[0].sourceDocId).toBe(baselineDoc1Id);
    expect(baselines[0].body).toContain('Friendly, direct');
    expect(baselines[1].sourceDocId).toBe(baselineDoc2Id);
    expect(baselines[1].body).toContain('Usage-based');
  });

  it('degrades to scaffolding-only when agentDefinitionId is null', async () => {
    const repo = createDbScaffoldingRepo();
    const payload = await buildScaffoldingPayload(
      { companyId, agentDefinitionId: null },
      repo,
    );
    expect(payload.blocks.map((b) => b.kind)).toEqual(['scaffolding']);
  });

  it('annotates archived baseline docs with a staleness note', async () => {
    // Flip the first baseline to archived and re-run. Restore it at
    // the end so downstream tests in the same file see a clean state
    // (this file has no later tests today, but the habit keeps the
    // fixture honest).
    await db
      .update(documents)
      .set({ status: 'archived' })
      .where(eq(documents.id, baselineDoc1Id));

    try {
      const repo = createDbScaffoldingRepo();
      const payload = await buildScaffoldingPayload(
        { companyId, agentDefinitionId: agentDefinitionDocId },
        repo,
      );
      const first = payload.blocks.find(
        (b) => b.kind === 'baseline' && b.sourceDocId === baselineDoc1Id,
      );
      expect(first).toBeDefined();
      expect(first!.body).toMatch(/archived/i);
    } finally {
      await db
        .update(documents)
        .set({ status: 'active' })
        .where(eq(documents.id, baselineDoc1Id));
    }
  });

  it('degrades to scaffolding-only when the agent-definition is soft-deleted', async () => {
    // Simulate a session whose stored agentDefinitionId points at a
    // doc that's been soft-deleted. The repo filters by `deletedAt IS
    // NULL` so it returns null — the builder keeps scaffolding and
    // drops the rest.
    await db
      .update(documents)
      .set({ deletedAt: new Date() })
      .where(eq(documents.id, agentDefinitionDocId));

    try {
      const repo = createDbScaffoldingRepo();
      const payload = await buildScaffoldingPayload(
        { companyId, agentDefinitionId: agentDefinitionDocId },
        repo,
      );
      expect(payload.blocks.map((b) => b.kind)).toEqual(['scaffolding']);
    } finally {
      await db
        .update(documents)
        .set({ deletedAt: null })
        .where(eq(documents.id, agentDefinitionDocId));
    }
  });
});
