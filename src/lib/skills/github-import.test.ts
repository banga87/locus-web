import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseSkillUrl, fetchSkillPreview } from './github-import';

describe('parseSkillUrl', () => {
  it('parses skills.sh URLs', () => {
    expect(parseSkillUrl('https://skills.sh/remotion-dev/skills/remotion-best-practices'))
      .toEqual({ owner: 'remotion-dev', repo: 'skills', skillName: 'remotion-best-practices' });
  });
  it('parses github.com repo root (skillName omitted)', () => {
    expect(parseSkillUrl('https://github.com/anthropics/skills'))
      .toEqual({ owner: 'anthropics', repo: 'skills', skillName: null });
  });
  it('parses github.com repo + explicit skill name from the caller', () => {
    expect(parseSkillUrl('https://github.com/anthropics/skills', 'skill-creator'))
      .toEqual({ owner: 'anthropics', repo: 'skills', skillName: 'skill-creator' });
  });
  it('rejects unrelated URLs', () => {
    expect(() => parseSkillUrl('https://example.com/foo')).toThrow(/unrecognised URL/);
  });
});

// ---------------------------------------------------------------------------
// Helpers for fetchSkillPreview tests
// ---------------------------------------------------------------------------

const SKILL_MD_BODY = `---
name: My Cool Skill
description: Helps agents do cool things.
---
# My Cool Skill

Some content here.
`;

const SKILL_MD_BODY_EMPTY_DESC = `---
name: My Cool Skill
description:
---
# Body
`;

function makeTree(entries: Array<{ path: string; type?: string }>) {
  return {
    tree: entries.map((e) => ({
      path: e.path,
      type: e.type ?? 'blob',
      sha: 'blobsha_' + e.path.replace(/\W/g, '_'),
    })),
  };
}

function makeCommits(sha: string) {
  return [{ sha }];
}

/**
 * Build a fetch mock that handles the three types of GitHub calls.
 *
 * commitsResponse  – what the commits endpoint returns (array or error config)
 * treeResponse     – what the trees endpoint returns
 * rawBodies        – map of path → raw content (keyed by last path segment or full path)
 */
function makeFetchMock(opts: {
  commitsSha?: string;
  tree: ReturnType<typeof makeTree>;
  rawBodies: Map<string, string>;
  rateLimitUrl?: string;
  notFoundUrl?: string;
  skipCommits?: boolean;
}) {
  return vi.fn((url: string) => {
    // Rate-limit simulation
    if (opts.rateLimitUrl && url.includes(opts.rateLimitUrl)) {
      return Promise.resolve({
        ok: false,
        status: 403,
        headers: {
          get: (h: string) => {
            if (h === 'x-ratelimit-remaining') return '0';
            if (h === 'x-ratelimit-reset') return '1999999999';
            return null;
          },
        },
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(''),
      });
    }

    // 404 simulation
    if (opts.notFoundUrl && url.includes(opts.notFoundUrl)) {
      return Promise.resolve({
        ok: false,
        status: 404,
        headers: { get: () => null },
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(''),
      });
    }

    // Commits endpoint
    if (url.includes('/commits')) {
      const sha = opts.commitsSha ?? 'abc123sha';
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve(makeCommits(sha)),
        text: () => Promise.resolve(''),
      });
    }

    // Trees endpoint
    if (url.includes('/git/trees/')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve(opts.tree),
        text: () => Promise.resolve(''),
      });
    }

    // Raw content endpoint (raw.githubusercontent.com)
    if (url.includes('raw.githubusercontent.com')) {
      // Extract path from URL: https://raw.githubusercontent.com/{owner}/{repo}/{sha}/{...path}
      const rawMatch = url.match(/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.+)/);
      if (rawMatch) {
        const filePath = rawMatch[1];
        const body = opts.rawBodies.get(filePath);
        if (body !== undefined) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: () => Promise.resolve({}),
            text: () => Promise.resolve(body),
          });
        }
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        headers: { get: () => null },
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(''),
      });
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  });
}

describe('fetchSkillPreview', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // --------------------------------------------------------------------------
  // Test 1: Happy path — skills.sh URL (rootPath = skills/<name>)
  // --------------------------------------------------------------------------
  it('happy path: skills.sh URL with skill subfolder', async () => {
    const parsed = parseSkillUrl('https://skills.sh/acme-org/skills/my-cool-skill');
    // parsed = { owner: 'acme-org', repo: 'skills', skillName: 'my-cool-skill' }

    const rawBodies = new Map([
      ['skills/my-cool-skill/SKILL.md', SKILL_MD_BODY],
      ['skills/my-cool-skill/guide.md', '# Guide\nUseful content.'],
    ]);

    const tree = makeTree([
      { path: 'skills/my-cool-skill/SKILL.md' },
      { path: 'skills/my-cool-skill/guide.md' },
    ]);

    vi.stubGlobal('fetch', makeFetchMock({ commitsSha: 'deadbeef', tree, rawBodies }));

    const preview = await fetchSkillPreview(parsed);

    expect(preview.sha).toBe('deadbeef');
    expect(preview.name).toBe('My Cool Skill');
    expect(preview.description).toBe('Helps agents do cool things.');
    expect(preview.skillMdBody).toContain('# My Cool Skill');
    expect(preview.resources).toHaveLength(1);
    expect(preview.resources[0].relative_path).toBe('guide.md');
    expect(preview.resources[0].content).toContain('Useful content');
    expect(preview.resources[0].bytes).toBeGreaterThan(0);
    expect(preview.totalBytes).toBeGreaterThan(0);
    expect(preview.warnings).toEqual([]);

    // Spec compliance: raw.githubusercontent.com calls must NOT carry Authorization.
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const rawCalls = (fetchMock.mock.calls as [string, (RequestInit | undefined)?][]).filter(
      ([url]) => url.startsWith('https://raw.githubusercontent.com/'),
    );
    expect(rawCalls.length).toBeGreaterThan(0); // sanity-check that raw calls happened
    for (const [, init] of rawCalls) {
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.['Authorization']).toBeUndefined();
    }
  });

  // --------------------------------------------------------------------------
  // Test 2: github.com root URL (skillName=null, rootPath='')
  // --------------------------------------------------------------------------
  it('github.com root URL: finds SKILL.md at repo root', async () => {
    const parsed = parseSkillUrl('https://github.com/acme-org/my-skill');
    // parsed.skillName = null

    const rawBodies = new Map([
      ['SKILL.md', SKILL_MD_BODY],
      ['docs/extra.md', '# Extra docs'],
    ]);

    const tree = makeTree([
      { path: 'SKILL.md' },
      { path: 'docs/extra.md' },
    ]);

    vi.stubGlobal('fetch', makeFetchMock({ commitsSha: 'rootsha', tree, rawBodies }));

    const preview = await fetchSkillPreview(parsed);

    expect(preview.sha).toBe('rootsha');
    expect(preview.name).toBe('My Cool Skill');
    expect(preview.resources).toHaveLength(1);
    expect(preview.resources[0].relative_path).toBe('docs/extra.md');
    expect(preview.warnings).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // Test 3: Fallback — <rootPath>/SKILL.md missing, uses root SKILL.md
  // --------------------------------------------------------------------------
  it('falls back to root SKILL.md when subfolder SKILL.md is absent', async () => {
    const parsed = parseSkillUrl('https://skills.sh/acme-org/skills/my-cool-skill');

    const rawBodies = new Map([
      ['SKILL.md', SKILL_MD_BODY],
    ]);

    // Tree does NOT have skills/my-cool-skill/SKILL.md — only root SKILL.md
    const tree = makeTree([
      { path: 'SKILL.md' },
    ]);

    vi.stubGlobal('fetch', makeFetchMock({ commitsSha: 'fallbacksha', tree, rawBodies }));

    const preview = await fetchSkillPreview(parsed);

    expect(preview.sha).toBe('fallbacksha');
    expect(preview.name).toBe('My Cool Skill');
    expect(preview.warnings).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // Test 4: Non-md files → warnings; not fetched
  // --------------------------------------------------------------------------
  it('adds non-.md files to warnings and does not fetch them', async () => {
    const parsed = parseSkillUrl('https://skills.sh/acme-org/skills/my-cool-skill');

    const rawBodies = new Map([
      ['skills/my-cool-skill/SKILL.md', SKILL_MD_BODY],
    ]);

    const tree = makeTree([
      { path: 'skills/my-cool-skill/SKILL.md' },
      { path: 'skills/my-cool-skill/image.png' },
      { path: 'skills/my-cool-skill/config.json' },
    ]);

    vi.stubGlobal('fetch', makeFetchMock({ commitsSha: 'warnsha', tree, rawBodies }));

    const preview = await fetchSkillPreview(parsed);

    expect(preview.warnings).toHaveLength(2);
    expect(preview.warnings.some((w) => w.includes('image.png'))).toBe(true);
    expect(preview.warnings.some((w) => w.includes('config.json'))).toBe(true);
    expect(preview.resources).toHaveLength(0);

    // Verify the non-md files were not fetched (raw.githubusercontent.com only called for SKILL.md)
    const fetchMock = (globalThis.fetch as ReturnType<typeof vi.fn>);
    const rawCalls = (fetchMock.mock.calls as [string, ...unknown[]][]).filter(
      ([url]) => url.includes('raw.githubusercontent.com')
    );
    expect(rawCalls.every(([url]) => url.includes('SKILL.md'))).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Test 5: Empty description → throws specific error
  // --------------------------------------------------------------------------
  it('throws when description frontmatter is empty', async () => {
    const parsed = parseSkillUrl('https://skills.sh/acme-org/skills/my-cool-skill');

    const rawBodies = new Map([
      ['skills/my-cool-skill/SKILL.md', SKILL_MD_BODY_EMPTY_DESC],
    ]);

    const tree = makeTree([{ path: 'skills/my-cool-skill/SKILL.md' }]);

    vi.stubGlobal('fetch', makeFetchMock({ tree, rawBodies }));

    await expect(fetchSkillPreview(parsed)).rejects.toThrow(
      /description is empty/
    );
  });

  // --------------------------------------------------------------------------
  // Test 6: No SKILL.md anywhere → throws
  // --------------------------------------------------------------------------
  it('throws when no SKILL.md is found anywhere in the tree', async () => {
    const parsed = parseSkillUrl('https://skills.sh/acme-org/skills/my-cool-skill');

    const tree = makeTree([
      { path: 'skills/my-cool-skill/guide.md' },
      { path: 'README.md' },
    ]);

    vi.stubGlobal('fetch', makeFetchMock({ tree, rawBodies: new Map() }));

    await expect(fetchSkillPreview(parsed)).rejects.toThrow(
      /no SKILL\.md found/
    );
  });

  // --------------------------------------------------------------------------
  // Test 7: Rate-limited response → throws with reset time
  // --------------------------------------------------------------------------
  it('throws with reset time when GitHub rate-limits the request', async () => {
    const parsed = parseSkillUrl('https://skills.sh/acme-org/skills/my-cool-skill');

    const tree = makeTree([]);

    vi.stubGlobal(
      'fetch',
      makeFetchMock({ tree, rawBodies: new Map(), rateLimitUrl: '/commits' })
    );

    await expect(fetchSkillPreview(parsed)).rejects.toThrow(
      /rate limit exceeded/i
    );
    await expect(fetchSkillPreview(parsed)).rejects.toThrow(/1999999999/);
  });

  // --------------------------------------------------------------------------
  // Test 8: pinSha option — commits call is skipped
  // --------------------------------------------------------------------------
  it('skips commits API call when pinSha is provided', async () => {
    const parsed = parseSkillUrl('https://skills.sh/acme-org/skills/my-cool-skill');

    const rawBodies = new Map([
      ['skills/my-cool-skill/SKILL.md', SKILL_MD_BODY],
    ]);

    const tree = makeTree([{ path: 'skills/my-cool-skill/SKILL.md' }]);

    const fetchMockFn = makeFetchMock({ commitsSha: 'should-not-use', tree, rawBodies });
    vi.stubGlobal('fetch', fetchMockFn);

    const preview = await fetchSkillPreview(parsed, { pinSha: 'pinned-sha-abc' });

    // The commits endpoint should NOT have been called
    const commitsCalls = (fetchMockFn.mock.calls as [string, ...unknown[]][]).filter(
      ([url]) => url.includes('/commits')
    );
    expect(commitsCalls).toHaveLength(0);

    // The sha returned should be the pinned one
    expect(preview.sha).toBe('pinned-sha-abc');
  });
});
