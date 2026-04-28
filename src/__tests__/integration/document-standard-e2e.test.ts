import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { handleToolCall } from '@/lib/mcp/handler';
import { registerLocusTools } from '@/lib/tools';
import {
  cleanupCompany,
  createSeededCompany,
  createTestToken,
  type TestCompany,
} from './helpers';

let company: TestCompany;
let bearer: string;

beforeAll(async () => {
  company = await createSeededCompany('doc-std-e2e');
  const t = await createTestToken(company.companyId, company.userId);
  bearer = t.token;
  registerLocusTools();
}, 60_000);

afterAll(async () => {
  if (company) await cleanupCompany(company);
}, 60_000);

function mcpRequest(): Request {
  return new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  });
}

async function callTool(
  toolName: string,
  rawInput: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await handleToolCall({
    toolName,
    rawInput,
    request: mcpRequest(),
  });
  if (response.isError) {
    throw new Error(
      `Tool ${toolName} errored: ${JSON.stringify(response.content)}`,
    );
  }
  return JSON.parse(response.content[0].text);
}

describe('document standard + vocabulary e2e', () => {
  it('returns 7 folders, 7 types, 33 topics from get_taxonomy', async () => {
    const data = await callTool('get_taxonomy', {});
    expect((data.folders as unknown[]).length).toBe(7);
    expect((data.types as unknown[]).length).toBe(7);
    expect((data.topics as unknown[]).length).toBe(33);
    expect((data.synonyms as Record<string, string>)['users']).toBe(
      'customer',
    );
  });

  it('returns canonical schema with owner + last_reviewed_at', async () => {
    const data = await callTool('get_type_schema', { type: 'canonical' });
    expect(
      Object.keys(data.required_fields as Record<string, unknown>).sort(),
    ).toEqual(['last_reviewed_at', 'owner']);
  });

  it('search_documents accepts new filters without erroring', async () => {
    const data = await callTool('search_documents', {
      query: 'anything',
      folder: 'company',
      type: 'canonical',
      topics: ['brand'],
      confidence_min: 'medium',
      max_results: 5,
    });
    // Empty result is fine — what matters is no validation error.
    expect(Array.isArray(data.results)).toBe(true);
  });
});
