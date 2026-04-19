/**
 * @vitest-environment node
 */
// Integration tests for POST /api/skills/import/preview
//
// No DB writes: this route is read-only — it calls parseSkillUrl +
// fetchSkillPreview and maps errors to HTTP status codes.
//
// Auth: stubbed via the `@/lib/supabase/server` mock (same pattern as
// src/app/api/attachments/__tests__/route.integration.test.ts). Drizzle
// is also stubbed so we avoid a live DB call for the user profile lookup.
//
// github-import: mocked so no live GitHub calls are made.

import { beforeAll, describe, expect, it, vi } from 'vitest';

// ---- Auth mock ---------------------------------------------------------------
// Controls whether getUser() returns a real user or null.
let mockedUserId: string | null = 'test-user-id';

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: mockedUserId
            ? { id: mockedUserId, email: 'test@example.com' }
            : null,
        },
      }),
    },
  }),
}));

// Stub Drizzle DB so requireAuth's profile lookup doesn't need a real DB.
vi.mock('@/db', () => {
  const mockProfile = {
    id: 'test-user-id',
    email: 'test@example.com',
    fullName: 'Test User',
    role: 'owner',
    status: 'active',
    companyId: 'test-company-id',
  };
  const chainable = {
    select: () => chainable,
    from: () => chainable,
    where: () => chainable,
    limit: async () => [mockProfile],
    insert: () => chainable,
    values: () => chainable,
    returning: async () => [mockProfile],
  };
  return { db: chainable };
});

// ---- github-import mock -------------------------------------------------------
vi.mock('@/lib/skills/github-import', () => ({
  parseSkillUrl: vi.fn(),
  fetchSkillPreview: vi.fn(),
}));

// ---- Dynamic import (after mocks) --------------------------------------------
import type { ParsedSkillUrl, SkillPreview } from '@/lib/skills/github-import';
import { parseSkillUrl, fetchSkillPreview } from '@/lib/skills/github-import';

const mockParseSkillUrl = parseSkillUrl as ReturnType<typeof vi.fn>;
const mockFetchSkillPreview = fetchSkillPreview as ReturnType<typeof vi.fn>;

let POST: (req: Request) => Promise<Response>;

beforeAll(async () => {
  ({ POST } = await import('@/app/api/skills/import/preview/route'));
});

// ---- Helpers -----------------------------------------------------------------

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/skills/import/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const fakeParsed: ParsedSkillUrl = {
  owner: 'acme',
  repo: 'skills',
  skillName: 'daily-digest',
};

const fakePreview: SkillPreview = {
  name: 'daily-digest',
  description: 'Sends a daily digest of activity.',
  sha: 'abc123',
  skillMdBody: '## Daily Digest\n\nSends emails.',
  resources: [{ relative_path: 'guide.md', content: '# Guide', bytes: 7 }],
  totalBytes: 500,
  warnings: [],
};

// ---- Tests -------------------------------------------------------------------

describe('POST /api/skills/import/preview', () => {
  it('1. happy path — valid skills.sh URL returns 200 with SkillPreview', async () => {
    mockParseSkillUrl.mockReturnValueOnce(fakeParsed);
    mockFetchSkillPreview.mockResolvedValueOnce(fakePreview);

    const req = makeRequest({ url: 'https://skills.sh/acme/skills/daily-digest' });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: SkillPreview };
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      name: 'daily-digest',
      description: 'Sends a daily digest of activity.',
      sha: 'abc123',
    });
    expect(mockFetchSkillPreview).toHaveBeenCalledWith(fakeParsed, {});
  });

  it('2. unknown hostname — parseSkillUrl throws → 400 invalid_url', async () => {
    mockParseSkillUrl.mockImplementationOnce(() => {
      throw new Error('unrecognised URL: https://example.com/foo');
    });

    const req = makeRequest({ url: 'https://example.com/foo' });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_url');
  });

  it('3. GitHub 404 — fetchSkillPreview throws → 404 not_found', async () => {
    mockParseSkillUrl.mockReturnValueOnce(fakeParsed);
    mockFetchSkillPreview.mockRejectedValueOnce(
      new Error('GitHub returned 404: https://api.github.com/repos/acme/skills'),
    );

    const req = makeRequest({ url: 'https://github.com/acme/skills' });
    const res = await POST(req);

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('not_found');
    expect(body.error.message).toContain('GitHub');
  });

  it('4. empty description — fetchSkillPreview throws → 422 empty_description', async () => {
    mockParseSkillUrl.mockReturnValueOnce(fakeParsed);
    mockFetchSkillPreview.mockRejectedValueOnce(
      new Error("the skill's description is empty. Agents won't know when to use it."),
    );

    const req = makeRequest({ url: 'https://skills.sh/acme/skills/daily-digest' });
    const res = await POST(req);

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('empty_description');
  });

  it('5. unauthenticated — supabase returns null user → 401', async () => {
    mockedUserId = null;
    const req = makeRequest({ url: 'https://skills.sh/acme/skills/daily-digest' });
    const res = await POST(req);
    mockedUserId = 'test-user-id'; // restore

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unauthenticated');
  });

  it('6. missing url field — Zod validation fails → 400 invalid_input', async () => {
    const req = makeRequest({ skillName: 'something' }); // url missing
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_input');
  });

  it('7. rate limited — fetchSkillPreview throws → 429 rate_limited with reset timestamp', async () => {
    mockParseSkillUrl.mockReturnValueOnce(fakeParsed);
    mockFetchSkillPreview.mockRejectedValueOnce(
      new Error('GitHub API rate limit exceeded, resets at 1999999999'),
    );

    const req = makeRequest({ url: 'https://skills.sh/acme/skills/daily-digest' });
    const res = await POST(req);

    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.message).toContain('1999999999');
  });

  it('8. not a skill — fetchSkillPreview throws no SKILL.md → 400 not_a_skill', async () => {
    mockParseSkillUrl.mockReturnValueOnce(fakeParsed);
    mockFetchSkillPreview.mockRejectedValueOnce(
      new Error('not a valid skill — no SKILL.md found'),
    );

    const req = makeRequest({ url: 'https://github.com/acme/not-a-skill' });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_a_skill');
  });

  it('9. upstream GitHub error — fetchSkillPreview throws GitHub 500 → 502 upstream_error', async () => {
    mockParseSkillUrl.mockReturnValueOnce(fakeParsed);
    mockFetchSkillPreview.mockRejectedValueOnce(
      new Error('GitHub returned 500: https://api.github.com/repos/acme/skills'),
    );

    const req = makeRequest({ url: 'https://github.com/acme/skills' });
    const res = await POST(req);

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('upstream_error');
  });

  it('10. skillName forwarded — parsed through to fetchSkillPreview options', async () => {
    mockParseSkillUrl.mockReturnValueOnce(fakeParsed);
    mockFetchSkillPreview.mockResolvedValueOnce(fakePreview);

    const req = makeRequest({
      url: 'https://github.com/acme/my-repo',
      skillName: 'custom-skill',
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    // parseSkillUrl should receive the skillName as the second argument
    expect(mockParseSkillUrl).toHaveBeenCalledWith(
      'https://github.com/acme/my-repo',
      'custom-skill',
    );
  });
});
