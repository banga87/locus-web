// Integration test for the UserPromptSubmit user-prompt repo + builder.
//
// Runs against live Supabase via the Drizzle superuser connection
// (DATABASE_URL — bypasses RLS so we can seed + read without the
// Supabase Auth dance). Post-skills-rewrite the builder only emits
// attachment blocks; this test covers the repo's attachment lookup
// against the real `session_attachments` schema plus the sibling
// `AgentSkillsRepo` which reads the agent-definition doc's `skills:`
// frontmatter array.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import yaml from 'js-yaml';

import { db } from '@/db';
import { brains, companies, documents, folders } from '@/db/schema';

import {
  createDbAgentSkillsRepo,
  createDbUserPromptRepo,
} from './repos';
import { buildUserPromptPayload } from './user-prompt';

// ---- Fixture --------------------------------------------------------------

const suffix = `up-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let companyId: string;
let brainId: string;
let folderId: string;
let skillDocId: string;
let agentDefinitionDocId: string;

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

  const [folder] = await db
    .insert(folders)
    .values({
      companyId,
      brainId,
      slug: `up-cat-${suffix}`,
      name: 'User-prompt fixtures',
    })
    .returning({ id: folders.id });
  folderId = folder.id;

  const [skill] = await db
    .insert(documents)
    .values({
      companyId,
      brainId,
      folderId,
      title: 'Draft a Landing Page',
      slug: `draft-landing-page-${suffix}`,
      path: `up-cat-${suffix}/draft-landing-page-${suffix}`,
      content: `---\ntype: skill\ntitle: Draft a Landing Page\n---\n\nOpen with a hook.`,
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
      folderId,
      title: 'Marketing Copywriter',
      slug: `marketing-copywriter-${suffix}`,
      path: `up-cat-${suffix}/marketing-copywriter-${suffix}`,
      content: agentContent,
      type: 'agent-definition',
      version: 1,
    })
    .returning({ id: documents.id });
  agentDefinitionDocId = agentDef.id;
}, 60_000);

afterAll(async () => {
  // Mirror the scaffolding integration test: disable the document_
  // versions immutability trigger inside a transaction so the brain
  // cascade can reach through any version rows.
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

describe('createDbAgentSkillsRepo (integration with live DB)', () => {
  it('returns the agent-definition skills array from frontmatter', async () => {
    const agentRepo = createDbAgentSkillsRepo();
    const agentSkillIds = await agentRepo.getAgentSkillIds(agentDefinitionDocId);
    expect(agentSkillIds).toEqual([skillDocId]);
  });

  it('returns null when the agent-definition is soft-deleted', async () => {
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
});

describe('createDbUserPromptRepo (integration with live DB)', () => {
  it('returns [] for a session with no extracted attachments', async () => {
    // The nil-uuid session has no rows, and the query filters on
    // `companyId = ? AND sessionId = ?` so even a sessionId collision
    // across tenants wouldn't surface rows into the wrong company's
    // turn. Exercises the "no attachments" short-circuit path that
    // the builder uses to emit an empty payload.
    const repo = createDbUserPromptRepo();
    const attachments = await repo.getExtractedAttachments(
      companyId,
      '00000000-0000-0000-0000-000000000000',
    );
    expect(attachments).toEqual([]);
  });

  it('emits an empty payload when no attachments exist for the session', async () => {
    const repo = createDbUserPromptRepo();
    const payload = await buildUserPromptPayload(
      {
        companyId,
        sessionId: '00000000-0000-0000-0000-000000000000',
        userMessage: 'please draft a landing page for our new product',
      },
      repo,
    );
    expect(payload.blocks).toHaveLength(0);
  });
});
