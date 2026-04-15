// End-to-end integration test for mcp_invocation emission.
//
// Unlike tool-bridge.test.ts (which mocks @/lib/audit/logger at module
// level to keep unit tests lightweight), this test exercises the full
// logger pipeline: bridgeMcpTool → logEvent → buffered writer → flushEvents.
// We swap the internal writer via the __setWriter test hook so we capture
// the exact AuditEventInsert rows the DB would receive — proving brainId
// lands in the writer payload, invocation_id pairs correctly, and
// duration_ms is populated end-to-end.

import { describe, it, expect, beforeEach } from 'vitest';
import { dynamicTool, jsonSchema } from 'ai';
import { buildToolSet } from '../tool-bridge';
import {
  flushEvents,
  __setWriter,
  __resetForTests,
} from '@/lib/audit/logger';
import type { ToolContext } from '@/lib/tools/types';

describe('mcp_invocation — end to end', () => {
  beforeEach(() => {
    __resetForTests();
  });

  it('produces paired invoke + complete events flushed to the writer', async () => {
    const captured: Record<string, unknown>[] = [];
    __setWriter(async (rows) => { captured.push(...rows); });

    const externalTools = {
      'mcp__stripe__search_prices': dynamicTool({
        description: 'Search Stripe prices',
        inputSchema: jsonSchema({ type: 'object', properties: {} }),
        execute: async () => ({ prices: [{ id: 'price_1' }] }),
      }),
    };

    const externalToolMeta = {
      'mcp__stripe__search_prices': { mcpConnectionId: 'm-stripe', mcpName: 'Stripe' },
    };

    const ctx: ToolContext = {
      actor: {
        type: 'agent_token',
        id: 'tok-marketing',
        name: 'Marketing',
        scopes: ['read'],
      },
      companyId: '11111111-1111-1111-1111-111111111111',
      brainId: '22222222-2222-2222-2222-222222222222',
      sessionId: '33333333-3333-3333-3333-333333333333',
      grantedCapabilities: [],
      webCallsThisTurn: 0,
    };

    const tools = buildToolSet(ctx, externalTools, externalToolMeta);
    await tools['mcp__stripe__search_prices'].execute!({}, {} as never);

    await flushEvents();

    const mcpEvents = captured.filter(
      (r) => (r as { category?: string }).category === 'mcp_invocation',
    );
    expect(mcpEvents).toHaveLength(2);

    const invoke = mcpEvents.find(
      (e) => (e as { eventType?: string }).eventType === 'invoke',
    ) as { details?: { invocation_id?: string }; brainId?: string } | undefined;
    const complete = mcpEvents.find(
      (e) => (e as { eventType?: string }).eventType === 'complete',
    ) as { details?: { invocation_id?: string; duration_ms?: number } } | undefined;

    expect(invoke).toBeDefined();
    expect(complete).toBeDefined();
    expect(invoke!.details?.invocation_id).toBe(complete!.details?.invocation_id);
    expect(invoke!.brainId).toBe('22222222-2222-2222-2222-222222222222');
    expect(complete!.details?.duration_ms).toBeGreaterThanOrEqual(0);
  });
});
