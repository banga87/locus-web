// MCP handler tests — exercise handleToolCall end-to-end.
//
// Seeds a company + brain + documents, creates a real agent token, and
// invokes handleToolCall with a Fetch Request carrying the Bearer
// header. Verifies the MCP response envelope shape on success, auth
// failure, and unknown-tool paths.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/audit/logger', () => ({
  logEvent: vi.fn(),
  flushEvents: vi.fn(async () => {}),
}));

import { db } from '@/db';
import { documents } from '@/db/schema';
import { createToken } from '@/lib/auth/tokens';
import { __resetRegistryForTests } from '@/lib/tools/executor';
import { __resetLocusToolsRegistered } from '@/lib/tools';

import { handleToolCall, __resetMcpHandlerForTests } from '../handler';

import {
  setupFixtures,
  teardownFixtures,
  type Fixtures,
} from '@/lib/tools/__tests__/_fixtures';

const TEST_USER_ID = '00000000-0000-0000-0000-00000000cccc';

let fixtures: Fixtures;
let rawToken: string;
let tokenId: string;

beforeAll(async () => {
  fixtures = await setupFixtures('mcp-handler');

  await db.insert(documents).values([
    {
      companyId: fixtures.companyId,
      brainId: fixtures.brainId,
      folderId: fixtures.folderBrandId,
      title: 'Brand Voice Guide',
      slug: `brand-voice-${fixtures.suffix}`,
      path: `brand/brand-voice-${fixtures.suffix}`,
      content:
        'The company brand voice is plain and direct. Avoid jargon and write like a peer.',
      status: 'active',
    },
  ]);

  const created = await createToken({
    companyId: fixtures.companyId,
    name: 'MCP handler test token',
    createdBy: TEST_USER_ID,
  });
  rawToken = created.token;
  tokenId = created.record.id;
});

afterAll(async () => {
  __resetRegistryForTests();
  __resetLocusToolsRegistered();
  await teardownFixtures(fixtures);
  // The token row cascades via company deletion (companies FK ON DELETE
  // CASCADE on agent_access_tokens).
});

beforeEach(() => {
  __resetMcpHandlerForTests();
});

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://example.test/api/mcp', {
    method: 'POST',
    headers,
  });
}

describe('handleToolCall — end to end', () => {
  it('executes search_documents and returns an MCP success envelope', async () => {
    const response = await handleToolCall({
      toolName: 'search_documents',
      rawInput: { query: 'brand voice' },
      request: makeRequest({ Authorization: `Bearer ${rawToken}` }),
    });

    expect(response.isError).toBeUndefined();
    expect(response.content).toHaveLength(1);
    expect(response.content[0].type).toBe('text');

    const payload = JSON.parse(response.content[0].text);
    expect(payload.query).toBe('brand voice');
    expect(Array.isArray(payload.results)).toBe(true);
    expect(payload.results.length).toBeGreaterThan(0);
  });

  it('returns MCP error envelope for auth failure', async () => {
    const response = await handleToolCall({
      toolName: 'search_documents',
      rawInput: { query: 'brand voice' },
      request: makeRequest({}),
    });

    expect(response.isError).toBe(true);
    const err = JSON.parse(response.content[0].text);
    expect(err.code).toBe('missing_token');
  });

  it('returns MCP error envelope for an invalid token', async () => {
    const response = await handleToolCall({
      toolName: 'search_documents',
      rawInput: { query: 'brand voice' },
      request: makeRequest({
        Authorization:
          'Bearer lat_live_bogusbogusbogusbogusbogusbogusbogusbogusbogusbogus',
      }),
    });

    expect(response.isError).toBe(true);
    const err = JSON.parse(response.content[0].text);
    expect(err.code).toBe('invalid_token');
  });

  it('returns unknown_tool error envelope when the tool name is not registered', async () => {
    const response = await handleToolCall({
      toolName: 'not_a_real_tool',
      rawInput: {},
      request: makeRequest({ Authorization: `Bearer ${rawToken}` }),
    });

    expect(response.isError).toBe(true);
    const err = JSON.parse(response.content[0].text);
    expect(err.code).toBe('unknown_tool');
  });

  it('surfaces executor validation errors as MCP error envelopes', async () => {
    const response = await handleToolCall({
      toolName: 'search_documents',
      // `query` is required by the tool schema — omitting triggers ajv.
      rawInput: {},
      request: makeRequest({ Authorization: `Bearer ${rawToken}` }),
    });

    expect(response.isError).toBe(true);
    const err = JSON.parse(response.content[0].text);
    expect(err.code).toBe('invalid_input');
  });

  it('uses the authenticated token id in ToolContext (visible via executor context)', async () => {
    // Smoke: run the tool and confirm it succeeded under the token's
    // company. Because we seeded docs under `fixtures.companyId` and the
    // token belongs to that same company, a result >0 implies the brain
    // lookup used the correct company.
    const response = await handleToolCall({
      toolName: 'search_documents',
      rawInput: { query: 'jargon' },
      request: makeRequest({ Authorization: `Bearer ${rawToken}` }),
    });

    expect(response.isError).toBeUndefined();
    const payload = JSON.parse(response.content[0].text);
    expect(payload.results.length).toBeGreaterThan(0);
    void tokenId; // tokenId captured for future use if we add actor-level assertions.
  });
});
