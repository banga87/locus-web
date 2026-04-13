// Phase 0 end-to-end integration test.
//
// Exercises the full Pre-MVP story: a brand-new company can be created +
// seeded, documents read via MCP with YAML frontmatter, edited via
// direct DB writes (dashboard parity), manifest regenerated, change
// history surfaced via MCP, token revocation respected, and audit rows
// logged for both authentication and document access.
//
// Runs against live Supabase via the Drizzle superuser connection.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import {
  auditEvents,
  documents,
  documentVersions,
  navigationManifests,
} from '@/db/schema';
import { flushEvents } from '@/lib/audit/logger';
import { regenerateManifest } from '@/lib/brain/manifest';
import { handleToolCall } from '@/lib/mcp/handler';
import { revokeToken } from '@/lib/auth/tokens';

import {
  cleanupCompany,
  createSeededCompany,
  createTestToken,
  type TestCompany,
} from './helpers';

let company: TestCompany;
let token: string;
let tokenId: string;

beforeAll(async () => {
  company = await createSeededCompany('phase0');
  const t = await createTestToken(company.companyId, company.userId);
  token = t.token;
  tokenId = t.tokenId;
}, 60_000);

afterAll(async () => {
  await cleanupCompany(company);
}, 60_000);

function mcpRequest(): Request {
  return new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  });
}

describe('Phase 0 end-to-end', () => {
  it('seeds 4 categories + 10 core documents + 1 current manifest', async () => {
    const manifests = await db
      .select()
      .from(navigationManifests)
      .where(
        and(
          eq(navigationManifests.brainId, company.brainId),
          eq(navigationManifests.isCurrent, true),
        ),
      );
    expect(manifests).toHaveLength(1);

    const docs = await db
      .select()
      .from(documents)
      .where(eq(documents.brainId, company.brainId));
    expect(docs).toHaveLength(10);
    expect(docs.every((d) => d.isCore)).toBe(true);
    expect(docs.every((d) => d.status === 'draft')).toBe(true);
  });

  it('MCP search_documents returns matching documents', async () => {
    const res = await handleToolCall({
      toolName: 'search_documents',
      rawInput: { query: 'voice' },
      request: mcpRequest(),
    });
    expect(res.isError).toBeFalsy();
    expect(res.content[0]?.type).toBe('text');
    const body = JSON.parse(res.content[0].text) as {
      query: string;
      results: Array<{ path: string; title: string }>;
    };
    expect(body.query).toBe('voice');
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
    // Brand Voice & Tone should be among the hits.
    expect(body.results.some((r) => r.path.includes('brand-voice-tone'))).toBe(
      true,
    );
  });

  it('MCP get_document prefixes YAML frontmatter', async () => {
    const [brandVoice] = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.brainId, company.brainId),
          eq(documents.slug, 'brand-voice-tone'),
        ),
      )
      .limit(1);
    expect(brandVoice).toBeDefined();

    const res = await handleToolCall({
      toolName: 'get_document',
      rawInput: { path: brandVoice.path },
      request: mcpRequest(),
    });
    expect(res.isError).toBeFalsy();
    expect(res.content[0]?.type).toBe('text');

    const body = JSON.parse(res.content[0].text) as {
      document: { content: string; path: string };
    };
    const content = body.document.content;
    expect(content).toMatch(/^---\s*\n/);
    expect(content).toContain('status: draft');
    expect(content).toContain('is_core: true');
    expect(content).toContain('confidence_level: medium');
    expect(body.document.path).toBe(brandVoice.path);
  });

  it('dashboard-style PATCH creates version + keeps one current manifest', async () => {
    const [doc] = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.brainId, company.brainId),
          eq(documents.isCore, true),
        ),
      )
      .limit(1);
    expect(doc).toBeDefined();

    const before = await db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.documentId, doc.id));

    const nextVersion = doc.version + 1;
    const nextContent = doc.content + '\n\nUpdated by e2e.';

    await db
      .update(documents)
      .set({
        content: nextContent,
        version: nextVersion,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, doc.id));

    await db.insert(documentVersions).values({
      companyId: company.companyId,
      documentId: doc.id,
      versionNumber: nextVersion,
      content: nextContent,
      changeSummary: 'e2e edit',
      changedBy: company.userId,
      changedByType: 'human',
    });

    await regenerateManifest(company.brainId);

    const after = await db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.documentId, doc.id));
    expect(after.length).toBe(before.length + 1);

    const currentManifests = await db
      .select()
      .from(navigationManifests)
      .where(
        and(
          eq(navigationManifests.brainId, company.brainId),
          eq(navigationManifests.isCurrent, true),
        ),
      );
    expect(currentManifests).toHaveLength(1);
  });

  it('MCP get_diff_history surfaces recent edits', async () => {
    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    const res = await handleToolCall({
      toolName: 'get_diff_history',
      rawInput: { since },
      request: mcpRequest(),
    });
    expect(res.isError).toBeFalsy();
    expect(res.content[0]?.type).toBe('text');
    // Shape of get_diff_history is not asserted strictly here — the
    // tool's own unit tests cover that. We just need the MCP envelope
    // to come back successful for a valid `since` filter.
    const body = JSON.parse(res.content[0].text) as unknown;
    expect(body).toBeDefined();
  });

  it('audit_events rows were logged for auth + document access', async () => {
    await flushEvents();
    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.companyId, company.companyId));
    expect(events.length).toBeGreaterThan(0);
    const categories = new Set(events.map((e) => e.category));
    // Token.used events fire inside authenticateAgentToken on every
    // successful call — those land as category = 'authentication'.
    expect(categories.has('authentication')).toBe(true);
    // Tool executor fires a document_access event on every call.
    expect(categories.has('document_access')).toBe(true);
  });

  it('revoked token is rejected by MCP', async () => {
    await revokeToken(tokenId);

    const res = await handleToolCall({
      toolName: 'search_documents',
      rawInput: { query: 'anything' },
      request: mcpRequest(),
    });
    expect(res.isError).toBe(true);
    const body = JSON.parse(res.content[0].text) as {
      code: string;
      message: string;
    };
    expect(body.code).toBe('invalid_token');
  });
});
