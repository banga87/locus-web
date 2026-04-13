// Tests for `loadMcpOutTools` — the critical bridge between stored
// MCP connections and the AI SDK's tool set.
//
// We mock both `./connections` and `./client` so the bridge's logic
// can be exercised in isolation. The two scenarios that matter most:
//
//   1. One failing connection does NOT sink the others (Promise.all
//      with per-branch try/catch).
//   2. A failing connection is flipped to `status: 'error'` with the
//      captured message.
//
// We also assert that the returned map is keyed by
// `ext_${connId}_${remoteToolName}` per the namespace convention.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// `vi.mock()` is hoisted above top-level imports, which means any
// identifiers referenced inside the factory must be hoisted too. Using
// `vi.hoisted()` gives us live references that the mock factories and
// the test bodies can both read.
const mocks = vi.hoisted(() => ({
  listConnections: vi.fn(),
  markConnectionError: vi.fn(),
  touchConnection: vi.fn(),
  connectToMcpServer: vi.fn(),
  discoverTools: vi.fn(),
}));

vi.mock('../connections', () => ({
  listConnections: mocks.listConnections,
  markConnectionError: mocks.markConnectionError,
  touchConnection: mocks.touchConnection,
}));

vi.mock('../client', () => ({
  connectToMcpServer: mocks.connectToMcpServer,
  discoverTools: mocks.discoverTools,
}));

const {
  listConnections,
  markConnectionError,
  touchConnection,
  connectToMcpServer,
  discoverTools,
} = mocks;

import { loadMcpOutTools } from '../bridge';
import type { McpConnection } from '../types';

function conn(
  id: string,
  overrides: Partial<McpConnection> = {},
): McpConnection {
  return {
    id,
    companyId: 'co-1',
    name: `Conn ${id}`,
    serverUrl: `https://mcp.example.test/${id}`,
    authType: 'none',
    credentialsEncrypted: null,
    status: 'active',
    lastErrorMessage: null,
    createdAt: new Date(),
    lastUsedAt: null,
    ...overrides,
  };
}

function makeFakeClient() {
  return {
    callTool: vi.fn(),
    close: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  listConnections.mockReset();
  markConnectionError.mockReset().mockResolvedValue(undefined);
  touchConnection.mockReset().mockResolvedValue(undefined);
  connectToMcpServer.mockReset();
  discoverTools.mockReset();
});

describe('loadMcpOutTools', () => {
  it('returns an empty tool set when no connections exist', async () => {
    listConnections.mockResolvedValueOnce([]);

    const tools = await loadMcpOutTools('co-1');

    expect(Object.keys(tools)).toHaveLength(0);
    expect(listConnections).toHaveBeenCalledWith('co-1', true);
  });

  it('namespaces discovered tools as ext_<connId>_<toolName>', async () => {
    const a = conn('a');
    listConnections.mockResolvedValueOnce([a]);

    const client = makeFakeClient();
    connectToMcpServer.mockResolvedValueOnce(client);
    discoverTools.mockResolvedValueOnce([
      { name: 'search_email', description: 'Search', inputSchema: { type: 'object', properties: {} } },
      { name: 'list_labels', description: 'List', inputSchema: { type: 'object', properties: {} } },
    ]);

    const tools = await loadMcpOutTools('co-1');

    expect(Object.keys(tools).sort()).toEqual([
      'ext_a_list_labels',
      'ext_a_search_email',
    ]);
    expect(touchConnection).toHaveBeenCalledWith('a');
  });

  it('isolates a failing connection — healthy ones still surface tools', async () => {
    const good = conn('good');
    const bad = conn('bad');
    listConnections.mockResolvedValueOnce([good, bad]);

    // Order within Promise.all is not deterministic — wire the mocks
    // by URL rather than by call order.
    connectToMcpServer.mockImplementation(async (c: McpConnection) => {
      if (c.id === 'good') return makeFakeClient();
      throw new Error('ECONNREFUSED');
    });
    discoverTools.mockImplementation(async () => [
      { name: 'ping', inputSchema: { type: 'object', properties: {} } },
    ]);

    const tools = await loadMcpOutTools('co-1');

    // Good connection's tool landed; bad one's did not.
    expect(Object.keys(tools)).toContain('ext_good_ping');
    expect(Object.keys(tools)).not.toContain('ext_bad_ping');

    // Bad connection was flagged with its error message.
    expect(markConnectionError).toHaveBeenCalledWith('bad', 'ECONNREFUSED');
    expect(markConnectionError).toHaveBeenCalledTimes(1);
  });

  it('flags a listTools failure (not just a connect failure) as error', async () => {
    const c = conn('listy');
    listConnections.mockResolvedValueOnce([c]);

    const client = makeFakeClient();
    connectToMcpServer.mockResolvedValueOnce(client);
    discoverTools.mockRejectedValueOnce(new Error('listTools blew up'));

    const tools = await loadMcpOutTools('co-1');

    expect(Object.keys(tools)).toHaveLength(0);
    expect(markConnectionError).toHaveBeenCalledWith('listy', 'listTools blew up');
  });

  it('produces a wrapped tool whose execute calls client.callTool with the right name', async () => {
    const c = conn('calla');
    listConnections.mockResolvedValueOnce([c]);

    const client = makeFakeClient();
    client.callTool.mockResolvedValueOnce({ content: [{ type: 'text', text: 'ok' }] });
    connectToMcpServer.mockResolvedValueOnce(client);
    discoverTools.mockResolvedValueOnce([
      { name: 'do_thing', inputSchema: { type: 'object', properties: { x: { type: 'string' } } } },
    ]);

    const tools = await loadMcpOutTools('co-1');
    const wrapper = tools['ext_calla_do_thing'] as {
      execute: (args: unknown, opts?: unknown) => Promise<unknown>;
    };

    // The AI SDK passes (args, options) into execute at runtime.
    const result = await wrapper.execute({ x: 'hi' }, {
      toolCallId: 'call-1',
      messages: [],
    } as unknown);

    expect(client.callTool).toHaveBeenCalledWith({
      name: 'do_thing',
      arguments: { x: 'hi' },
    });
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
  });

  it('surfaces a callTool failure as a structured error result, not a throw', async () => {
    const c = conn('errtool');
    listConnections.mockResolvedValueOnce([c]);

    const client = makeFakeClient();
    client.callTool.mockRejectedValueOnce(new Error('remote said no'));
    connectToMcpServer.mockResolvedValueOnce(client);
    discoverTools.mockResolvedValueOnce([
      { name: 'flaky', inputSchema: { type: 'object', properties: {} } },
    ]);

    const tools = await loadMcpOutTools('co-1');
    const wrapper = tools['ext_errtool_flaky'] as {
      execute: (args: unknown, opts?: unknown) => Promise<unknown>;
    };

    const result = await wrapper.execute({}, {
      toolCallId: 'call-1',
      messages: [],
    } as unknown);

    expect(result).toEqual({ error: true, message: 'remote said no' });
  });
});
