// userDefinedAgents — real-DB integration tests.
//
// Seeds `agent-definition` documents directly into the DB and asserts
// that `listUserDefinedAgents` materialises them into the correct
// `BuiltInAgentDefinition` shape. Uses the same setup/teardown
// fixture pattern as `src/lib/workflow/__tests__/run.test.ts`.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import yaml from 'js-yaml';

import { db } from '@/db';
import { companies } from '@/db/schema/companies';
import { brains } from '@/db/schema/brains';
import { documents } from '@/db/schema/documents';

import { listUserDefinedAgents } from '../userDefinedAgents';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

interface Fixtures {
  companyId: string;
  brainId: string;
  /** A second company for isolation tests. */
  otherCompanyId: string;
  otherBrainId: string;
}

async function setupFixtures(): Promise<Fixtures> {
  const suffix = `udag-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const [company] = await db
    .insert(companies)
    .values({ name: `UDA Co ${suffix}`, slug: `uda-${suffix}` })
    .returning({ id: companies.id });

  const [brain] = await db
    .insert(brains)
    .values({ companyId: company!.id, name: 'UDA Brain', slug: `uda-brain-${suffix}` })
    .returning({ id: brains.id });

  const otherSuffix = `udao-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [otherCompany] = await db
    .insert(companies)
    .values({ name: `UDA Other ${otherSuffix}`, slug: `udao-${otherSuffix}` })
    .returning({ id: companies.id });

  const [otherBrain] = await db
    .insert(brains)
    .values({
      companyId: otherCompany!.id,
      name: 'UDA Other Brain',
      slug: `udao-brain-${otherSuffix}`,
    })
    .returning({ id: brains.id });

  return {
    companyId: company!.id,
    brainId: brain!.id,
    otherCompanyId: otherCompany!.id,
    otherBrainId: otherBrain!.id,
  };
}

async function teardownFixtures(f: Fixtures): Promise<void> {
  // Brains cascade to documents; disable the immutable-trigger guard.
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`ALTER TABLE document_versions DISABLE TRIGGER document_versions_immutable`,
    );
    await tx.delete(brains).where(eq(brains.id, f.brainId));
    await tx.delete(brains).where(eq(brains.id, f.otherBrainId));
    await tx.execute(
      sql`ALTER TABLE document_versions ENABLE TRIGGER document_versions_immutable`,
    );
  });
  await db.delete(companies).where(eq(companies.id, f.companyId));
  await db.delete(companies).where(eq(companies.id, f.otherCompanyId));
}

/** Build a minimal agent-definition document content string. */
function buildAgentDefContent(
  fields: Record<string, unknown>,
): string {
  const frontmatter = { type: 'agent-definition', ...fields };
  const yamlStr = yaml.dump(frontmatter, { lineWidth: 120 }).trimEnd();
  return `---\n${yamlStr}\n---\n`;
}

/** Insert an agent-definition doc and return its id. */
async function seedAgentDef(
  companyId: string,
  brainId: string,
  slug: string,
  fields: Record<string, unknown>,
  overrides: { deletedAt?: Date } = {},
): Promise<string> {
  const content = buildAgentDefContent({ slug, ...fields });
  const [row] = await db
    .insert(documents)
    .values({
      companyId,
      brainId,
      title: typeof fields.title === 'string' ? fields.title : slug,
      slug,
      path: `agents/${slug}`,
      content,
      type: 'agent-definition',
      version: 1,
      ...(overrides.deletedAt ? { deletedAt: overrides.deletedAt } : {}),
    })
    .returning({ id: documents.id });
  return row!.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let f: Fixtures;

beforeAll(async () => {
  f = await setupFixtures();
});

afterAll(async () => {
  await teardownFixtures(f);
});

describe('listUserDefinedAgents — happy path', () => {
  it('returns one entry with correctly materialised fields', async () => {
    await seedAgentDef(f.companyId, f.brainId, 'project-manager', {
      title: 'Project Manager',
      description: 'Manages project tasks and timelines.',
      model: 'claude-sonnet-4-6',
      tool_allowlist: ['create_document', 'search_documents'],
      system_prompt_snippet: 'You manage projects.',
      capabilities: ['web'],
      skills: [],
    });

    const agents = await listUserDefinedAgents(f.companyId);
    const pm = agents.find((a) => a.agentType === 'project-manager');

    expect(pm).toBeDefined();
    expect(pm!.agentType).toBe('project-manager');
    expect(pm!.whenToUse).toBe('Manages project tasks and timelines.');
    expect(pm!.model).toBe('anthropic/claude-sonnet-4.6');
    expect(pm!.tools).toEqual(['create_document', 'search_documents']);
    expect(pm!.omitBrainContext).toBe(false);
    expect(typeof pm!.getSystemPrompt).toBe('function');
    // System prompt should include the slug and snippet.
    const sp = pm!.getSystemPrompt();
    expect(sp).toContain('project-manager');
    expect(sp).toContain('You manage projects.');
  });
});

describe('listUserDefinedAgents — whenToUse fallbacks', () => {
  it('falls back to "Run the <slug> agent." when description is empty', async () => {
    const slug = `no-desc-${randomUUID().slice(0, 8)}`;
    await seedAgentDef(f.companyId, f.brainId, slug, {
      title: 'No Desc',
      description: '',
      model: 'claude-sonnet-4-6',
    });

    const agents = await listUserDefinedAgents(f.companyId);
    const agent = agents.find((a) => a.agentType === slug);
    expect(agent).toBeDefined();
    expect(agent!.whenToUse).toBe(`Run the ${slug} agent.`);
  });

  it('falls back when description field is absent', async () => {
    const slug = `no-desc-field-${randomUUID().slice(0, 8)}`;
    await seedAgentDef(f.companyId, f.brainId, slug, {
      title: 'No Desc Field',
      model: 'claude-sonnet-4-6',
    });

    const agents = await listUserDefinedAgents(f.companyId);
    const agent = agents.find((a) => a.agentType === slug);
    expect(agent).toBeDefined();
    expect(agent!.whenToUse).toBe(`Run the ${slug} agent.`);
  });
});

describe('listUserDefinedAgents — model fallback', () => {
  it('uses inherit when model field is absent', async () => {
    const slug = `no-model-${randomUUID().slice(0, 8)}`;
    await seedAgentDef(f.companyId, f.brainId, slug, {
      title: 'No Model',
      description: 'desc',
    });

    const agents = await listUserDefinedAgents(f.companyId);
    const agent = agents.find((a) => a.agentType === slug);
    expect(agent).toBeDefined();
    expect(agent!.model).toBe('inherit');
  });

  it('uses inherit when model is an unknown string', async () => {
    const slug = `bad-model-${randomUUID().slice(0, 8)}`;
    await seedAgentDef(f.companyId, f.brainId, slug, {
      title: 'Bad Model',
      description: 'desc',
      model: 'gpt-99-ultra',
    });

    const agents = await listUserDefinedAgents(f.companyId);
    const agent = agents.find((a) => a.agentType === slug);
    expect(agent).toBeDefined();
    expect(agent!.model).toBe('inherit');
  });
});

describe('listUserDefinedAgents — tool_allowlist fallback', () => {
  it('leaves tools undefined when tool_allowlist is absent', async () => {
    const slug = `no-tools-${randomUUID().slice(0, 8)}`;
    await seedAgentDef(f.companyId, f.brainId, slug, {
      title: 'No Tools',
      description: 'desc',
      model: 'claude-sonnet-4-6',
    });

    const agents = await listUserDefinedAgents(f.companyId);
    const agent = agents.find((a) => a.agentType === slug);
    expect(agent).toBeDefined();
    expect(agent!.tools).toBeUndefined();
  });

  it('leaves tools undefined when tool_allowlist is null', async () => {
    const slug = `null-tools-${randomUUID().slice(0, 8)}`;
    await seedAgentDef(f.companyId, f.brainId, slug, {
      title: 'Null Tools',
      description: 'desc',
      model: 'claude-sonnet-4-6',
      tool_allowlist: null,
    });

    const agents = await listUserDefinedAgents(f.companyId);
    const agent = agents.find((a) => a.agentType === slug);
    expect(agent).toBeDefined();
    expect(agent!.tools).toBeUndefined();
  });
});

describe('listUserDefinedAgents — company isolation', () => {
  it('does not return docs seeded for a different company', async () => {
    const slug = `isolated-${randomUUID().slice(0, 8)}`;
    // Seed only for the OTHER company.
    await seedAgentDef(f.otherCompanyId, f.otherBrainId, slug, {
      title: 'Other Agent',
      description: 'desc',
      model: 'claude-sonnet-4-6',
    });

    const agents = await listUserDefinedAgents(f.companyId);
    const leaked = agents.find((a) => a.agentType === slug);
    expect(leaked).toBeUndefined();
  });
});

describe('listUserDefinedAgents — soft-deleted', () => {
  it('excludes soft-deleted documents', async () => {
    const slug = `deleted-${randomUUID().slice(0, 8)}`;
    await seedAgentDef(
      f.companyId,
      f.brainId,
      slug,
      {
        title: 'Deleted Agent',
        description: 'desc',
        model: 'claude-sonnet-4-6',
      },
      { deletedAt: new Date() },
    );

    const agents = await listUserDefinedAgents(f.companyId);
    const found = agents.find((a) => a.agentType === slug);
    expect(found).toBeUndefined();
  });
});
