// Phase 1 MVP Task 5 — MCP IN read-only regression.
//
// Verifies the MVP contract for external agents:
//   - An external agent authenticates with a read-scoped access token
//   - `tools/list` returns EXACTLY 4 tools (search_documents, get_document,
//     get_document_diff, get_diff_history)
//   - Write tools (create_document, update_document, delete_document) are
//     NOT advertised — Phase 1 does not expose brain mutations via MCP
//   - Each of the 4 tools can be successfully invoked
//   - Audit events for MCP tool calls are attributed to actorType
//     `agent_token`
//   - Audit events for Platform Agent tool calls (same executor, same
//     tools) are attributed to `platform_agent` — the two paths land
//     cleanly in the audit trail
//
// The Phase 0 e2e test covers raw tool behaviour. This test adds the
// Phase 1 contract for the divergent actor types.
//
// Runs against live Supabase via the Drizzle superuser connection.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { auditEvents, documents } from '@/db/schema';
import { flushEvents } from '@/lib/audit/logger';
import { executeTool } from '@/lib/tools/executor';
import { handleToolCall } from '@/lib/mcp/handler';
import { registerLocusTools } from '@/lib/tools';
import type { ToolContext } from '@/lib/tools/types';

import {
  cleanupCompany,
  createSeededCompany,
  createTestToken,
  type TestCompany,
} from './helpers';

let company: TestCompany;
let token: string;

beforeAll(async () => {
  company = await createSeededCompany('mvp-mcp-in');
  const t = await createTestToken(company.companyId, company.userId);
  token = t.token;
  // Brain tools must be registered before executeTool() or handleToolCall
  // can dispatch. registerLocusTools is idempotent.
  registerLocusTools();
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

describe('MVP MCP IN — tool surface', () => {
  // The MCP SDK's server.tool() registration is exercised in Phase 0
  // via the real HTTP route. Here we re-assert the read-only contract
  // by inspecting the authoritative source: the Locus tool registry,
  // which is what both paths (MCP IN handler + Platform Agent bridge)
  // dispatch through.
  it('Locus tool registry includes the MVP MCP IN read tools, and every MCP-exposed tool is read-only', async () => {
    // Import dynamically so the registerLocusTools() call in beforeAll
    // has definitely landed.
    const { getAllTools } = await import('@/lib/tools/executor');
    const allTools = getAllTools();
    const names = allTools.map((t) => t.name).sort();

    // The four read tools surfaced over MCP IN must be registered.
    // Phase 1 WebFetch adds `web_search` + `web_fetch` to the registry
    // as Platform-Agent-only tools — they're read-only (no brain
    // mutation) and gated by the `web` capability in the tool bridge,
    // so the MCP registrar's explicit 4-tool allowlist still prevents
    // external agents from seeing them. Phase 1.5 Task 2 adds
    // `create_document` + `update_document` to the registry for
    // Platform-Agent-side workflow execution — the MCP handler's
    // explicit allowlist (see `src/lib/mcp/handler.ts`) keeps them off
    // the MCP surface.
    expect(names).toEqual(
      expect.arrayContaining([
        'get_diff_history',
        'get_document',
        'get_document_diff',
        'search_documents',
      ]),
    );

    // Defence in depth — every tool that CAN be called through MCP IN
    // must be read-only. Mirror the allowlist here; the `./tools.ts`
    // registrar and `./handler.ts` gate both enforce it at runtime, this
    // assertion catches the case where someone flips one of those four
    // tools to write without updating the MCP surface.
    const mcpExposed = new Set([
      'search_documents',
      'get_document',
      'get_document_diff',
      'get_diff_history',
      'get_taxonomy',
      'get_type_schema',
    ]);
    for (const t of allTools) {
      if (!mcpExposed.has(t.name)) continue;
      expect(t.isReadOnly()).toBe(true);
    }
  });

  it('MCP registrar does NOT advertise write tools', async () => {
    // Read the registrar source directly — the authoritative answer to
    // "which tools does an external agent see?" is which tools get
    // `server.tool(...)` calls. This is a source-level assertion so
    // it's fast and independent of DB state.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(
        __dirname,
        '..',
        '..',
        'lib',
        'mcp',
        'tools.ts',
      ),
      'utf8',
    );

    // Strip comments so documentation mentioning write tools doesn't
    // trip the assertion.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    // Every `server.tool(` call advertises a name in a string literal
    // on the next arg. Extract them.
    const calls = stripped.match(/server\.tool\(\s*['"][^'"]+['"]/g) ?? [];
    const toolNames = calls.map((m) => {
      const nameMatch = m.match(/['"]([^'"]+)['"]/);
      return nameMatch?.[1] ?? '';
    });

    expect(toolNames.sort()).toEqual([
      'get_diff_history',
      'get_document',
      'get_document_diff',
      'get_taxonomy',
      'get_type_schema',
      'search_documents',
    ]);

    // No write-tool names appear ANYWHERE in the registrar — not in
    // code, not in doc strings (we stripped comments, so this catches
    // anything in the runtime surface).
    expect(stripped).not.toMatch(/\bcreate_document\b/);
    expect(stripped).not.toMatch(/\bupdate_document\b/);
    expect(stripped).not.toMatch(/\bdelete_document\b/);
  });
});

describe('MVP MCP IN — tool invocation', () => {
  it('calls each of the 4 read tools successfully', { timeout: 60_000 }, async () => {
    // 1. search_documents
    const search = await handleToolCall({
      toolName: 'search_documents',
      rawInput: { query: 'voice' },
      request: mcpRequest(),
    });
    expect(search.isError).toBeFalsy();
    const searchBody = JSON.parse(search.content[0].text) as {
      results: Array<{ path: string; title: string }>;
    };
    expect(searchBody.results.length).toBeGreaterThan(0);

    // 2. get_document — take the first hit and round-trip it.
    const [firstDoc] = await db
      .select({ path: documents.path, id: documents.id })
      .from(documents)
      .where(eq(documents.brainId, company.brainId))
      .limit(1);
    expect(firstDoc).toBeDefined();

    const getDoc = await handleToolCall({
      toolName: 'get_document',
      rawInput: { path: firstDoc.path },
      request: mcpRequest(),
    });
    expect(getDoc.isError).toBeFalsy();
    const getDocBody = JSON.parse(getDoc.content[0].text) as {
      document: { id: string; path: string };
    };
    expect(getDocBody.document.id).toBe(firstDoc.id);

    // 3. get_document_diff — by id
    const diff = await handleToolCall({
      toolName: 'get_document_diff',
      rawInput: { document_id: firstDoc.id, limit: 10 },
      request: mcpRequest(),
    });
    expect(diff.isError).toBeFalsy();

    // 4. get_diff_history — brain-wide
    const since = new Date(Date.now() - 60 * 60_000).toISOString();
    const history = await handleToolCall({
      toolName: 'get_diff_history',
      rawInput: { since },
      request: mcpRequest(),
    });
    expect(history.isError).toBeFalsy();
  });

  it('exposes get_taxonomy as a read tool over MCP IN', { timeout: 30_000 }, async () => {
    const response = await handleToolCall({
      toolName: 'get_taxonomy',
      rawInput: {},
      request: mcpRequest(),
    });
    expect(response.isError).toBeFalsy();
    const data = JSON.parse(response.content[0].text) as {
      folders: unknown[];
      types: unknown[];
      topics: unknown[];
    };
    expect(data.folders.length).toBe(7);
    expect(data.types.length).toBe(7);
    expect(data.topics.length).toBe(33);
  });

  it('exposes get_type_schema as a read tool over MCP IN', { timeout: 30_000 }, async () => {
    const response = await handleToolCall({
      toolName: 'get_type_schema',
      rawInput: { type: 'canonical' },
      request: mcpRequest(),
    });
    expect(response.isError).toBeFalsy();
    const data = JSON.parse(response.content[0].text) as {
      required_fields: Record<string, unknown>;
    };
    expect(Object.keys(data.required_fields)).toEqual(
      expect.arrayContaining(['owner', 'last_reviewed_at']),
    );
  });

  it('surfaces an unknown_tool MCP error envelope for a write-tool attempt', { timeout: 30_000 }, async () => {
    // Even if an external agent guesses at a write-tool name, the
    // executor has no registration for it — the tool executor
    // surfaces unknown_tool and the MCP layer wraps as an error
    // envelope.
    const res = await handleToolCall({
      toolName: 'create_document',
      rawInput: { path: 'voice/whatever.md', content: 'attack' },
      request: mcpRequest(),
    });
    expect(res.isError).toBe(true);
    const body = JSON.parse(res.content[0].text) as { code: string };
    expect(body.code).toBe('unknown_tool');
  });
});

describe('MVP MCP IN — audit trail actor differentiation', () => {
  it('MCP invocation records actorType=agent_token; Platform Agent invocation records actorType=platform_agent', { timeout: 30_000 }, async () => {
    // Capture the baseline event count for this company so the
    // assertion is insensitive to prior seeding.
    await flushEvents();
    const before = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.companyId, company.companyId),
          eq(auditEvents.eventType, 'tool.search_documents'),
        ),
      );

    // --- Path 1: external agent via MCP handler --------------------
    await handleToolCall({
      toolName: 'search_documents',
      rawInput: { query: 'voice' },
      request: mcpRequest(),
    });

    // --- Path 2: Platform Agent via executeTool directly ----------
    // This is the same call surface the chat route's tool bridge uses
    // (buildToolSet → bridgeLocusTool → executeTool). We drive it
    // directly so the test doesn't need the LLM streaming machinery.
    // The chat route constructs an actor.type of 'platform_agent'
    // (see src/app/api/agent/chat/route.ts) — we mirror that here.
    const platformCtx: ToolContext = {
      actor: {
        type: 'platform_agent',
        id: company.userId,
        scopes: ['read'],
      },
      companyId: company.companyId,
      brainId: company.brainId,
      grantedCapabilities: ['web'],
      webCallsThisTurn: 0,
    };

    await executeTool('search_documents', { query: 'voice' }, platformCtx);

    await flushEvents();

    const after = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.companyId, company.companyId),
          eq(auditEvents.eventType, 'tool.search_documents'),
        ),
      );

    // We added 2 events — one per path.
    expect(after.length).toBeGreaterThanOrEqual(before.length + 2);

    // New events since `before`.
    const beforeIds = new Set(before.map((e) => e.id));
    const newEvents = after.filter((e) => !beforeIds.has(e.id));

    const actorTypes = new Set(newEvents.map((e) => e.actorType));
    expect(actorTypes.has('agent_token')).toBe(true);
    expect(actorTypes.has('platform_agent')).toBe(true);
  });
});
