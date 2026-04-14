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
        // A valid nil UUID. The attachment branch now hits the real
        // session_attachments table; the column type is uuid, so an
        // arbitrary placeholder string would throw a 22P02. This
        // nil-uuid has no attachments — the branch short-circuits to
        // empty, which is what the skill-matching assertions need.
        sessionId: '00000000-0000-0000-0000-000000000000',
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
        // See note above about the nil-uuid. This test exercises the
        // "empty agent pool" short-circuit, so the session id doesn't
        // matter to what we're asserting — but it must parse as a
        // uuid now that the repo runs a real Drizzle query.
        sessionId: '00000000-0000-0000-0000-000000000000',
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

  it('returns [] for a session with no extracted attachments (Task 8 wired)', async () => {
    // Post-Task 8 this now hits the real `session_attachments` table.
    // The nil-uuid session has no rows, and the query filters on
    // `companyId = ? AND sessionId = ?` so even a sessionId collision
    // across tenants wouldn't surface rows into the wrong company's
    // turn. This exercises the "no attachments" short-circuit path
    // that the builder uses to skip the ingestion-filing co-injection.
    const repo = createDbUserPromptRepo();
    const attachments = await repo.getExtractedAttachments(
      companyId,
      '00000000-0000-0000-0000-000000000000',
    );
    expect(attachments).toEqual([]);
  });

  it('ignores user-authored docs titled like the built-in filing skill (slug guard, Task 10)', async () => {
    // The repo looks up the built-in ingestion-filing skill by the
    // stable slug `ingestion-filing` — NOT by title. This test seeds a
    // user-authored skill-type doc whose title contains "ingestion" /
    // "filing" but whose slug is distinct. An earlier draft of the
    // repo used `title ILIKE '%ingestion filing%'` and would have
    // silently injected e.g. "Canada Ingestion Filing SOPs" on every
    // attachment turn; the slug guard is what closes that door.
    //
    // This fixture deliberately skips `seedBuiltins`, so the repo
    // should return `null` — there is no doc with slug
    // `ingestion-filing` in this company. A separate integration test
    // at `scripts/__tests__/seed-builtins.integration.test.ts`
    // exercises the seeded-body-comes-through half of the contract.
    const [decoy] = await db
      .insert(documents)
      .values({
        companyId,
        brainId,
        categoryId,
        title: 'Canada Ingestion Filing SOPs',
        slug: `canada-ingestion-filing-sops-${suffix}`,
        path: `up-cat-${suffix}/canada-ingestion-filing-sops-${suffix}`,
        content: `---
type: skill
title: Canada Ingestion Filing SOPs
---

User-authored content that must NOT be injected as the built-in filing skill.`,
        type: 'skill',
        version: 1,
      })
      .returning({ id: documents.id });
    try {
      const repo = createDbUserPromptRepo();
      const filing = await repo.getIngestionFilingSkill(companyId);
      expect(filing).toBeNull();
    } finally {
      await db.delete(documents).where(eq(documents.id, decoy.id));
    }
  });
});
