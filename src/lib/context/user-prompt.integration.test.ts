// Integration test for the UserPromptSubmit user-prompt payload builder.
//
// Runs against live Supabase via the Drizzle superuser connection
// (DATABASE_URL — bypasses RLS so we can seed + read without the
// Supabase Auth dance). Mirrors the fixture pattern in
// `loader.integration.test.ts` + `scaffolding.integration.test.ts` —
// create a fresh company + brain + category + one skill doc + one
// agent-definition doc referencing the skill, rebuild the manifest,
// then exercise `buildUserPromptPayload` end-to-end with the live
// DB-backed repo.
//
// Coverage (matches Task 6 Step 7 in the Phase 1.5 plan):
//   1. Happy path — matching skill lands as an injected block.
//   2. Candidate-pool isolation — when the agent does NOT list the
//      skill, the matcher still scores against the manifest but the
//      candidate filter excludes the skill.
//
// Not covered here (deliberate):
//   - Attachments: Task 8 ships the `session_attachments` pipeline.
//     Until then `getExtractedAttachments` is stubbed to `[]`; there
//     is nothing meaningful to integration-test on the DB side.
//   - Ingestion-filing co-injection: Task 10 seeds the built-in
//     `ingestion-filing` skill. Until the seed lands, the filing
//     lookup returns `null`.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import yaml from 'js-yaml';

import { db } from '@/db';
import { brains, categories, companies, documents } from '@/db/schema';
import { rebuildManifest } from '@/lib/skills/loader';

import {
  createDbAgentSkillsRepo,
  createDbUserPromptRepo,
} from './repos';
import { buildUserPromptPayload } from './user-prompt';

// ---- Fixture --------------------------------------------------------------

const suffix = `up-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let companyId: string;
let brainId: string;
let categoryId: string;
let skillDocId: string;
let agentDefinitionDocId: string;

function skillContent(): string {
  return `---
type: skill
title: Draft a Landing Page
description: Use when the user asks to draft a landing page.
triggers:
  phrases:
    - landing page
  allOf: []
  anyOf: []
  minScore: 1
priority: 5
---

Open with a hook, lead with the single best benefit, close with a CTA.`;
}

beforeAll(async () => {
  const [company] = await db
    .insert(companies)
    .values({ name: `User-prompt Test Co ${suffix}`, slug: `up-${suffix}` })
    .returning({ id: companies.id });
  companyId = company.id;

  const [brain] = await db
    .insert(brains)
    .values({ companyId, name: 'Main', slug: 'main' })
    .returning({ id: brains.id });
  brainId = brain.id;

  const [category] = await db
    .insert(categories)
    .values({
      companyId,
      brainId,
      slug: `up-cat-${suffix}`,
      name: 'User-prompt fixtures',
    })
    .returning({ id: categories.id });
  categoryId = category.id;

  const [skill] = await db
    .insert(documents)
    .values({
      companyId,
      brainId,
      categoryId,
      title: 'Draft a Landing Page',
      slug: `draft-landing-page-${suffix}`,
      path: `up-cat-${suffix}/draft-landing-page-${suffix}`,
      content: skillContent(),
      type: 'skill',
      version: 1,
    })
    .returning({ id: documents.id });
  skillDocId = skill.id;

  // Agent-definition — frontmatter-only, arrays via js-yaml so the
  // read path can round-trip them. Mirrors what `buildAgentDefinition
  // Doc` in `src/lib/agents/definitions.ts` produces.
  const agentFrontmatter = {
    type: 'agent-definition',
    title: 'Marketing Copywriter',
    slug: `marketing-copywriter-${suffix}`,
    model: 'claude-sonnet-4-6',
    tool_allowlist: null,
    baseline_docs: [],
    skills: [skillDocId],
    system_prompt_snippet: 'You are a senior marketing copywriter.',
  };
  const yamlStr = yaml.dump(agentFrontmatter, { lineWidth: 120 }).trimEnd();
  const agentContent = `---\n${yamlStr}\n---\n`;

  const [agentDef] = await db
    .insert(documents)
    .values({
      companyId,
      brainId,
      categoryId,
      title: 'Marketing Copywriter',
      slug: `marketing-copywriter-${suffix}`,
      path: `up-cat-${suffix}/marketing-copywriter-${suffix}`,
      content: agentContent,
      type: 'agent-definition',
      version: 1,
    })
    .returning({ id: documents.id });
  agentDefinitionDocId = agentDef.id;

  // Build the manifest synchronously (don't route through the
  // scheduler — setTimeout handles leak across a test run).
  await rebuildManifest(companyId);
}, 60_000);

afterAll(async () => {
  // Mirror the scaffolding integration test: disable the document_
  // versions immutability trigger inside a transaction so the brain
  // cascade can reach through any version rows. Manifests cascade
  // off companies, so dropping the company in the final DELETE
  // tears them down too.
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

describe('buildUserPromptPayload (integration with live DB)', () => {
  it('injects the matched skill when the agent candidate pool includes it', async () => {
    const agentRepo = createDbAgentSkillsRepo();
    const agentSkillIds = (await agentRepo.getAgentSkillIds(agentDefinitionDocId)) ?? [];
    expect(agentSkillIds).toEqual([skillDocId]);

    const repo = createDbUserPromptRepo();
    const payload = await buildUserPromptPayload(
      {
        companyId,
        sessionId: 'irrelevant-session-for-skill-matching',
        agentSkillIds,
        userMessage: 'please draft a landing page for our new product',
      },
      repo,
    );

    const skillBlocks = payload.blocks.filter((b) => b.kind === 'skill');
    expect(skillBlocks).toHaveLength(1);
    expect(skillBlocks[0].skillId).toBe(skillDocId);
    expect(skillBlocks[0].title).toBe('Draft a Landing Page');
    // Body is the skill doc's content minus frontmatter — the repo
    // stripFrontmatter helper handles this.
    expect(skillBlocks[0].body).toContain('Open with a hook');
    // Frontmatter must not leak into the injected body.
    expect(skillBlocks[0].body).not.toContain('type: skill');
  });

  it('excludes skills when the agent candidate pool is empty', async () => {
    const repo = createDbUserPromptRepo();
    const payload = await buildUserPromptPayload(
      {
        companyId,
        sessionId: 'n/a',
        agentSkillIds: [],
        userMessage: 'please draft a landing page for our new product',
      },
      repo,
    );
    expect(payload.blocks.filter((b) => b.kind === 'skill')).toHaveLength(0);
  });

  it('returns null agentSkillIds when the agent-definition is soft-deleted', async () => {
    // Flip the agent-definition to soft-deleted and back, asserting the
    // lookup degrades to null rather than throwing.
    await db
      .update(documents)
      .set({ deletedAt: new Date() })
      .where(eq(documents.id, agentDefinitionDocId));
    try {
      const agentRepo = createDbAgentSkillsRepo();
      const result = await agentRepo.getAgentSkillIds(agentDefinitionDocId);
      expect(result).toBeNull();
    } finally {
      await db
        .update(documents)
        .set({ deletedAt: null })
        .where(eq(documents.id, agentDefinitionDocId));
    }
  });

  it('returns no extracted attachments until Task 8 ships', async () => {
    // Smoke test the stub — the builder relies on this method
    // returning `[]` for the attachment branch to short-circuit.
    const repo = createDbUserPromptRepo();
    const attachments = await repo.getExtractedAttachments('any-session');
    expect(attachments).toEqual([]);
  });

  it('returns null for the ingestion-filing skill until Task 10 seeds it', async () => {
    // The company in this fixture has no `ingestion-filing` skill
    // seeded, so the ILIKE filter finds nothing. Once Task 10 lands
    // this test should be tightened to assert the seeded body comes
    // through.
    const repo = createDbUserPromptRepo();
    const filing = await repo.getIngestionFilingSkill(companyId);
    expect(filing).toBeNull();
  });
});
