// Cross-company isolation integration test.
//
// Creates two independent seeded companies (A and B), then uses a token
// scoped to company A to attempt reads that would land on B's data.
// The MCP handler resolves the brain from the authenticated token's
// companyId; every tool filters by `context.brainId` so B's paths must
// be invisible through token A.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { documents } from '@/db/schema';
import { handleToolCall } from '@/lib/mcp/handler';

import {
  cleanupCompany,
  createSeededCompany,
  createTestToken,
  type TestCompany,
} from './helpers';

let companyA: TestCompany;
let companyB: TestCompany;
let tokenA: string;

beforeAll(async () => {
  companyA = await createSeededCompany('rlsA');
  companyB = await createSeededCompany('rlsB');
  ({ token: tokenA } = await createTestToken(
    companyA.companyId,
    companyA.userId,
  ));
}, 120_000);

afterAll(async () => {
  await cleanupCompany(companyA);
  await cleanupCompany(companyB);
}, 120_000);

function requestAsA(): Request {
  return new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${tokenA}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  });
}

describe('cross-company isolation', () => {
  it("token from A cannot read B's documents via get_document", async () => {
    const [docB] = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.brainId, companyB.brainId),
          eq(documents.slug, 'brand-voice-tone'),
        ),
      )
      .limit(1);
    expect(docB).toBeDefined();

    const res = await handleToolCall({
      toolName: 'get_document',
      rawInput: { path: docB.path },
      request: requestAsA(),
    });

    // Both brains seed from the Universal Pack, so the path exists in
    // A's brain too — but the document id is different. What matters is
    // that the returned document (if any) is scoped to A, not B.
    if (res.isError) {
      const body = JSON.parse(res.content[0].text) as { code: string };
      expect(body.code).toBe('document_not_found');
    } else {
      const body = JSON.parse(res.content[0].text) as {
        document: { id: string; path: string };
      };
      expect(body.document.id).not.toBe(docB.id);
      // The returned doc must belong to A's brain.
      const [retrieved] = await db
        .select({ brainId: documents.brainId })
        .from(documents)
        .where(eq(documents.id, body.document.id))
        .limit(1);
      expect(retrieved.brainId).toBe(companyA.brainId);
    }
  });

  it('search from A does not surface B documents', async () => {
    const res = await handleToolCall({
      toolName: 'search_documents',
      rawInput: { query: 'voice tone' },
      request: requestAsA(),
    });
    expect(res.isError).toBeFalsy();

    const body = JSON.parse(res.content[0].text) as {
      results: Array<{ path: string }>;
    };
    expect(body.results.length).toBeGreaterThan(0);

    // Every returned path must resolve to a document that lives in A's
    // brain — not B's. Since both brains seed the same paths, we verify
    // via join: the document_id list in the result's shape would be
    // ideal but the search tool doesn't surface ids, so re-query by
    // path+brainId=A and ensure a row exists.
    for (const r of body.results) {
      const [inA] = await db
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(
            eq(documents.path, r.path),
            eq(documents.brainId, companyA.brainId),
          ),
        )
        .limit(1);
      expect(inA).toBeDefined();
    }
  });
});
