// Unit tests for resolveAgentConfigBySlug.
//
// Follows the mock pattern established in
// `src/app/api/agents/__tests__/agents.test.ts`: a chainable Proxy DB
// mock that pops scripted results, plus no-op mocks for drizzle-orm
// operators and the schema objects. No live DB connection required.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- DB mock — chainable builder that pops scripted results ---------------

let nextResults: unknown[] = [];
function popResult() {
  return nextResults.shift() ?? [];
}

type Q = Record<string, (..._: unknown[]) => Q> & { _end: () => Promise<unknown> };
function chain(): Q {
  const q = {} as Q;
  const self = new Proxy(q, {
    get(_t, prop: string) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve(popResult());
      }
      return () => self;
    },
  });
  return self;
}

vi.mock('@/db', () => ({
  db: {
    select: () => chain(),
  },
}));

vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => a,
  eq: () => undefined,
  isNull: () => undefined,
}));

vi.mock('@/db/schema', () => ({
  documents: {},
}));

// ---- Subject under test ---------------------------------------------------

import { db } from '@/db';
import {
  resolveAgentConfigBySlug,
  AgentNotFoundError,
  PLATFORM_AGENT_SLUG,
} from '../resolve';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build minimal frontmatter content matching buildAgentDefinitionDoc output.
 *
 * Pass a key with value `undefined` to omit it from the generated YAML,
 * which is useful for simulating missing / corrupt frontmatter.
 */
function makeContent(overrides: Record<string, unknown> = {}): string {
  const base: Record<string, unknown> = {
    type: 'agent-definition',
    title: 'Test Agent',
    slug: 'test-agent',
    model: 'claude-sonnet-4-6',
    tool_allowlist: null,
    baseline_docs: [],
    skills: [],
    system_prompt_snippet: 'You are a test agent.',
    capabilities: [],
  };
  // Merge overrides; undefined values remove the key from base.
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) {
      delete base[k];
    } else {
      base[k] = v;
    }
  }
  const lines = Object.entries(base).map(([k, v]) => {
    if (v === null) return `${k}: null`;
    if (Array.isArray(v)) {
      if (v.length === 0) return `${k}: []`;
      return `${k}:\n${v.map((x) => `  - ${x}`).join('\n')}`;
    }
    // Empty string must be quoted — bare `key: ` parses to YAML null,
    // which would collapse the empty-string test into the null branch.
    if (v === '') return `${k}: ""`;
    return `${k}: ${v}`;
  });
  return `---\n${lines.join('\n')}\n---\n`;
}

const BRAIN_ID = 'brain-abc';
const SLUG = 'test-agent';

beforeEach(() => {
  nextResults = [];
});

// ---------------------------------------------------------------------------
// Platform-agent short-circuits (no DB call)
// ---------------------------------------------------------------------------

describe('platform-agent short-circuits', () => {
  it('returns null for null slug without hitting the DB', async () => {
    const selectSpy = vi.spyOn(db, 'select');
    const result = await resolveAgentConfigBySlug(BRAIN_ID, null);
    expect(result).toBeNull();
    // Hard guarantee: the DB client was never touched.
    expect(selectSpy).not.toHaveBeenCalled();
    // Secondary signal — the scripted-results queue also wasn't drained.
    expect(nextResults).toHaveLength(0);
    selectSpy.mockRestore();
  });

  it('returns null for the platform-agent slug without hitting the DB', async () => {
    const selectSpy = vi.spyOn(db, 'select');
    const result = await resolveAgentConfigBySlug(BRAIN_ID, PLATFORM_AGENT_SLUG);
    expect(result).toBeNull();
    expect(selectSpy).not.toHaveBeenCalled();
    expect(nextResults).toHaveLength(0);
    selectSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('resolveAgentConfigBySlug — happy path', () => {
  it('returns full AgentRuntimeConfig for a valid slug', async () => {
    nextResults.push([
      {
        id: 'doc-1',
        content: makeContent({
          model: 'claude-sonnet-4-6',
          tool_allowlist: ['web_search', 'calculator'],
          baseline_docs: ['uuid-a', 'uuid-b'],
          skills: ['skill-1'],
          system_prompt_snippet: 'You are a helper.',
          capabilities: ['web'],
        }),
      },
    ]);

    const config = await resolveAgentConfigBySlug(BRAIN_ID, SLUG);

    expect(config).not.toBeNull();
    expect(config!.id).toBe('doc-1');
    expect(config!.slug).toBe(SLUG);
    expect(config!.model).toBe('claude-sonnet-4-6');
    expect(config!.toolAllowlist).toEqual(['web_search', 'calculator']);
    expect(config!.baselineDocIds).toEqual(['uuid-a', 'uuid-b']);
    expect(config!.skillIds).toEqual(['skill-1']);
    expect(config!.systemPromptSnippet).toBe('You are a helper.');
    expect(config!.capabilities).toEqual(['web']);
  });
});

// ---------------------------------------------------------------------------
// AgentNotFoundError cases
// ---------------------------------------------------------------------------

describe('resolveAgentConfigBySlug — AgentNotFoundError', () => {
  it('throws AgentNotFoundError when no doc matches the slug', async () => {
    nextResults.push([]); // empty result set

    await expect(resolveAgentConfigBySlug(BRAIN_ID, SLUG)).rejects.toThrow(
      AgentNotFoundError,
    );
    await expect(resolveAgentConfigBySlug(BRAIN_ID, SLUG)).rejects.toThrow(
      `Agent not found: "${SLUG}"`,
    );
  });

  it('throws AgentNotFoundError when the matching doc is soft-deleted (deletedAt IS NOT NULL)', async () => {
    // The query filters isNull(documents.deletedAt) so soft-deleted rows
    // are not returned. Simulate this by returning an empty result.
    nextResults.push([]);

    await expect(resolveAgentConfigBySlug(BRAIN_ID, SLUG)).rejects.toBeInstanceOf(
      AgentNotFoundError,
    );
  });

  it('throws AgentNotFoundError when the doc exists in a different brainId (tenant isolation)', async () => {
    // The query includes eq(documents.brainId, brainId) — a doc in
    // another brain returns no rows for this brainId.
    nextResults.push([]);

    await expect(
      resolveAgentConfigBySlug('other-brain', SLUG),
    ).rejects.toBeInstanceOf(AgentNotFoundError);
  });

  it('throws AgentNotFoundError when the doc type is not agent-definition', async () => {
    // The query filters eq(documents.type, 'agent-definition') so a doc
    // of another type returns no rows.
    nextResults.push([]);

    await expect(resolveAgentConfigBySlug(BRAIN_ID, SLUG)).rejects.toBeInstanceOf(
      AgentNotFoundError,
    );
  });
});

// ---------------------------------------------------------------------------
// Corruption case
// ---------------------------------------------------------------------------

describe('resolveAgentConfigBySlug — corruption', () => {
  it('throws a plain Error (not AgentNotFoundError) when the doc has no model field', async () => {
    nextResults.push([
      {
        id: 'doc-corrupt',
        content: makeContent({ model: undefined }),
      },
    ]);

    const err = await resolveAgentConfigBySlug(BRAIN_ID, SLUG).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AgentNotFoundError);
    expect(err.message).toContain(`Agent definition '${SLUG}' has no 'model' field`);
  });

  it('throws a plain Error when model is an empty string (treated identically to absent)', async () => {
    nextResults.push([
      {
        id: 'doc-empty-model',
        content: makeContent({ model: '' }),
      },
    ]);

    const err = await resolveAgentConfigBySlug(BRAIN_ID, SLUG).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AgentNotFoundError);
    expect(err.message).toContain(`Agent definition '${SLUG}' has no 'model' field`);
  });
});

// ---------------------------------------------------------------------------
// tool_allowlist semantics
// ---------------------------------------------------------------------------

describe('resolveAgentConfigBySlug — tool_allowlist', () => {
  it('returns null for toolAllowlist when the field is absent in frontmatter', async () => {
    nextResults.push([
      {
        id: 'doc-2',
        content: makeContent({ tool_allowlist: undefined }),
      },
    ]);

    const config = await resolveAgentConfigBySlug(BRAIN_ID, SLUG);
    expect(config!.toolAllowlist).toBeNull();
  });

  it('returns [] for toolAllowlist when tool_allowlist is an empty array (intentional no-tools signal)', async () => {
    nextResults.push([
      {
        id: 'doc-3',
        content: makeContent({ tool_allowlist: [] }),
      },
    ]);

    const config = await resolveAgentConfigBySlug(BRAIN_ID, SLUG);
    expect(config!.toolAllowlist).toEqual([]);
    // Confirm [] is distinct from null
    expect(config!.toolAllowlist).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AgentNotFoundError shape
// ---------------------------------------------------------------------------

describe('AgentNotFoundError', () => {
  it('exposes slug property and name', () => {
    const err = new AgentNotFoundError('my-slug');
    expect(err.name).toBe('AgentNotFoundError');
    expect(err.slug).toBe('my-slug');
    expect(err.message).toBe('Agent not found: "my-slug"');
    expect(err).toBeInstanceOf(Error);
  });
});
