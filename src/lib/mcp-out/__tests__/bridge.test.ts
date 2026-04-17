// Tests for `loadMcpOutTools` — the critical bridge between stored
// MCP connections and the AI SDK's tool set.
//
// Coverage (updated after review pass):
//   1. Empty connection list → empty tool map.
//   2. Discovered tools are namespaced as
//      `ext_<connPrefix>_<safeName>` and capped at 64 chars.
//   3. One failing connection does NOT sink the others (Promise.all
//      with per-branch try/catch).
//   4. A failing connection is flipped to `status: 'error'` with the
//      captured message.
//   5. Tool name sanitisation — non-conforming chars become `_`, and
//      over-long names are truncated to fit the 64-char ceiling.
//   6. Discovery timeout (connect + listTools) is capped; a hanging
//      connection does NOT block the other connections' tools.
//   7. Per-tool-call timeout — a hung `callTool` returns a structured
//      timeout error, not a throw.
//   8. Explicit `close()` releases every opened transport.
//
// We mock both `./connections` and `./client` so the bridge's logic
// can be exercised in isolation. `@vercel/functions.waitUntil` is also
// mocked so `touchConnection`/`markConnectionError` are observable
// synchronously (we just call the passed promise).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Hoisted mocks (vi.mock factories are hoisted above top-level imports) --

const mocks = vi.hoisted(() => ({
  listConnections: vi.fn(),
  markConnectionError: vi.fn(),
  touchConnection: vi.fn(),
  connectToMcpServer: vi.fn(),
  discoverTools: vi.fn(),
  // Real raceWithTimeout — same implementation as in ../client so tests
  // exercise the actual timing behaviour. The tests shorten the bridge
  // constants below via vi.stubGlobal / module-level override.
  raceWithTimeout: vi.fn(),
  waitUntil: vi.fn(),
}));

vi.mock('../connections', () => ({
  listConnections: mocks.listConnections,
  markConnectionError: mocks.markConnectionError,
  touchConnection: mocks.touchConnection,
}));

// Inlined real raceWithTimeout implementation (copy of the one in
// ../client). We can't import the real one via vi.importActual because
// client.ts is already being mocked above, and mocking it means our
// test-time `raceWithTimeout` swallows the real behaviour.
function realRaceWithTimeout<T>(
  inner: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([inner, timeout]).finally(() => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  });
}

vi.mock('../client', () => ({
  connectToMcpServer: mocks.connectToMcpServer,
  discoverTools: mocks.discoverTools,
  raceWithTimeout: (inner: Promise<unknown>, timeoutMs: number, msg: string) =>
    mocks.raceWithTimeout(inner, timeoutMs, msg),
}));

vi.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => {
    mocks.waitUntil(p);
    // Swallow rejections so unhandled-rejection warnings don't pollute
    // test output (the promise's failure is the test surface).
    void Promise.resolve(p).catch(() => {});
  },
}));

const {
  listConnections,
  markConnectionError,
  touchConnection,
  connectToMcpServer,
  discoverTools,
  raceWithTimeout,
} = mocks;

import {
  buildToolKey,
  loadMcpOutTools,
  DISCOVER_TIMEOUT_MS,
  TOOL_CALL_TIMEOUT_MS,
} from '../bridge';
import type { McpConnection } from '../types';

// UUID-shaped test ids so the tool-key prefix is a stable 12 hex chars.
const UUID_A = 'aaaaaaaa-1111-2222-3333-aaaaaaaaaaaa';
const UUID_B = 'bbbbbbbb-1111-2222-3333-bbbbbbbbbbbb';
const UUID_C = 'cccccccc-1111-2222-3333-cccccccccccc';

function prefix(uuid: string): string {
  return uuid.replace(/-/g, '').slice(0, 12);
}

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
    catalogId: null,
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
  mocks.waitUntil.mockReset();
  // Default raceWithTimeout to the real implementation — tests that
  // care about the timeout path override per-call.
  raceWithTimeout.mockImplementation(
    (inner: Promise<unknown>, timeoutMs: number, msg: string) =>
      realRaceWithTimeout(inner, timeoutMs, msg),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

// ---- 1. Empty list -----------------------------------------------------

describe('loadMcpOutTools', () => {
  it('returns an empty tool set + close() when no connections exist', async () => {
    listConnections.mockResolvedValueOnce([]);

    const { tools, close } = await loadMcpOutTools('co-1');

    expect(Object.keys(tools)).toHaveLength(0);
    expect(listConnections).toHaveBeenCalledWith('co-1', true);
    await expect(close()).resolves.toBeUndefined();
  });

  // ---- 2. Tool namespacing ---------------------------------------------

  it('namespaces discovered tools as ext_<connPrefix>_<toolName>', async () => {
    const a = conn(UUID_A);
    listConnections.mockResolvedValueOnce([a]);

    const client = makeFakeClient();
    connectToMcpServer.mockResolvedValueOnce(client);
    discoverTools.mockResolvedValueOnce([
      { name: 'search_email', description: 'Search', inputSchema: { type: 'object', properties: {} } },
      { name: 'list_labels', description: 'List', inputSchema: { type: 'object', properties: {} } },
    ]);

    const { tools } = await loadMcpOutTools('co-1');

    const p = prefix(UUID_A);
    expect(Object.keys(tools).sort()).toEqual([
      `ext_${p}_list_labels`,
      `ext_${p}_search_email`,
    ]);
    // touchConnection is scheduled via waitUntil — assert it was called
    // (the mocked waitUntil invokes its promise synchronously).
    expect(touchConnection).toHaveBeenCalledWith(UUID_A);
  });

  // ---- 3. Error isolation across connections ---------------------------

  it('isolates a failing connection — healthy ones still surface tools', async () => {
    const good = conn(UUID_A);
    const bad = conn(UUID_B);
    listConnections.mockResolvedValueOnce([good, bad]);

    connectToMcpServer.mockImplementation(async (c: McpConnection) => {
      if (c.id === UUID_A) return makeFakeClient();
      throw new Error('ECONNREFUSED');
    });
    discoverTools.mockImplementation(async () => [
      { name: 'ping', inputSchema: { type: 'object', properties: {} } },
    ]);

    const { tools } = await loadMcpOutTools('co-1');

    const pGood = prefix(UUID_A);
    const pBad = prefix(UUID_B);
    expect(Object.keys(tools)).toContain(`ext_${pGood}_ping`);
    expect(Object.keys(tools)).not.toContain(`ext_${pBad}_ping`);

    expect(markConnectionError).toHaveBeenCalledWith(UUID_B, 'ECONNREFUSED');
    expect(markConnectionError).toHaveBeenCalledTimes(1);
  });

  // ---- 4. listTools failure flagged as error ---------------------------

  it('flags a listTools failure (not just a connect failure) as error', async () => {
    const c = conn(UUID_A);
    listConnections.mockResolvedValueOnce([c]);

    const client = makeFakeClient();
    connectToMcpServer.mockResolvedValueOnce(client);
    discoverTools.mockRejectedValueOnce(new Error('listTools blew up'));

    const { tools } = await loadMcpOutTools('co-1');

    expect(Object.keys(tools)).toHaveLength(0);
    expect(markConnectionError).toHaveBeenCalledWith(UUID_A, 'listTools blew up');
  });

  // ---- 5a. Wrapped-tool execute -----------------------------------------

  it('produces a wrapped tool whose execute calls client.callTool with the right name', async () => {
    const c = conn(UUID_A);
    listConnections.mockResolvedValueOnce([c]);

    const client = makeFakeClient();
    client.callTool.mockResolvedValueOnce({ content: [{ type: 'text', text: 'ok' }] });
    connectToMcpServer.mockResolvedValueOnce(client);
    discoverTools.mockResolvedValueOnce([
      { name: 'do_thing', inputSchema: { type: 'object', properties: { x: { type: 'string' } } } },
    ]);

    const { tools } = await loadMcpOutTools('co-1');
    const wrapperKey = `ext_${prefix(UUID_A)}_do_thing`;
    const wrapper = tools[wrapperKey] as unknown as {
      execute: (args: unknown, opts?: unknown) => Promise<unknown>;
    };

    const result = await wrapper.execute({ x: 'hi' }, {
      toolCallId: 'call-1',
      messages: [],
    } as unknown);

    expect(client.callTool).toHaveBeenCalledWith(
      { name: 'do_thing', arguments: { x: 'hi' } },
      undefined,
      { timeout: TOOL_CALL_TIMEOUT_MS },
    );
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
  });

  // ---- 5b. Wrapped-tool execute error path ------------------------------

  it('surfaces a callTool failure as a structured error result, not a throw', async () => {
    const c = conn(UUID_A);
    listConnections.mockResolvedValueOnce([c]);

    const client = makeFakeClient();
    client.callTool.mockRejectedValueOnce(new Error('remote said no'));
    connectToMcpServer.mockResolvedValueOnce(client);
    discoverTools.mockResolvedValueOnce([
      { name: 'flaky', inputSchema: { type: 'object', properties: {} } },
    ]);

    const { tools } = await loadMcpOutTools('co-1');
    const wrapperKey = `ext_${prefix(UUID_A)}_flaky`;
    const wrapper = tools[wrapperKey] as unknown as {
      execute: (args: unknown, opts?: unknown) => Promise<unknown>;
    };

    const result = await wrapper.execute({}, {
      toolCallId: 'call-1',
      messages: [],
    } as unknown);

    expect(result).toEqual({
      error: true,
      code: 'execution_error',
      message: 'remote said no',
    });
  });

  // ---- 6. Discovery timeout (CRITICAL C1) ------------------------------

  it('caps discovery at DISCOVER_TIMEOUT_MS — a hanging connection does not block healthy ones', async () => {
    const hanger = conn(UUID_A);
    const fast = conn(UUID_B);
    listConnections.mockResolvedValueOnce([hanger, fast]);

    // Override raceWithTimeout to a short budget ONLY for this test so
    // CI doesn't actually wait 10s. We use the real race logic
    // internally — forwarding to realRaceWithTimeout with a short ms —
    // to prove the timing works end-to-end.
    raceWithTimeout.mockImplementation(
      (inner: Promise<unknown>, _ms: number, msg: string) =>
        realRaceWithTimeout(inner, 50, msg),
    );

    // Hanger's connect never resolves.
    connectToMcpServer.mockImplementation(async (c: McpConnection) => {
      if (c.id === UUID_A) {
        return new Promise(() => {}); // hang forever
      }
      return makeFakeClient();
    });
    discoverTools.mockImplementation(async () => [
      { name: 'ping', inputSchema: { type: 'object', properties: {} } },
    ]);

    const start = Date.now();
    const { tools } = await loadMcpOutTools('co-1');
    const elapsed = Date.now() - start;

    // Healthy connection's tool surfaces.
    expect(Object.keys(tools)).toContain(`ext_${prefix(UUID_B)}_ping`);
    // Hanger flagged with a timeout message.
    expect(markConnectionError).toHaveBeenCalledWith(
      UUID_A,
      expect.stringMatching(/timeout/i),
    );
    // And the whole thing wrapped up well under the real 10-second budget.
    expect(elapsed).toBeLessThan(2000);
  });

  // ---- 7. Per-tool-call timeout (CRITICAL C1) --------------------------

  it('caps each callTool at TOOL_CALL_TIMEOUT_MS — a hung remote call returns a structured timeout error', async () => {
    const c = conn(UUID_A);
    listConnections.mockResolvedValueOnce([c]);

    const client = makeFakeClient();
    // callTool never resolves.
    client.callTool.mockImplementation(() => new Promise(() => {}));
    connectToMcpServer.mockResolvedValueOnce(client);
    discoverTools.mockResolvedValueOnce([
      { name: 'slow', inputSchema: { type: 'object', properties: {} } },
    ]);

    // Short-circuit TOOL_CALL_TIMEOUT_MS by overriding raceWithTimeout
    // only for the callTool composition. The first call is for
    // discovery (long), the second is inside execute (we want short).
    let raceCall = 0;
    raceWithTimeout.mockImplementation(
      (inner: Promise<unknown>, _ms: number, msg: string) => {
        raceCall += 1;
        // Discovery race runs first during loadMcpOutTools; allow it to
        // complete normally. The execute-time race (subsequent calls)
        // gets a 50ms budget.
        if (raceCall === 1) return realRaceWithTimeout(inner, 5000, msg);
        return realRaceWithTimeout(inner, 50, msg);
      },
    );

    const { tools } = await loadMcpOutTools('co-1');
    const wrapperKey = `ext_${prefix(UUID_A)}_slow`;
    const wrapper = tools[wrapperKey] as unknown as {
      execute: (args: unknown, opts?: unknown) => Promise<unknown>;
    };

    const start = Date.now();
    const result = (await wrapper.execute({}, {
      toolCallId: 'call-1',
      messages: [],
    } as unknown)) as {
      error: boolean;
      code: string;
      message: string;
    };
    const elapsed = Date.now() - start;

    expect(result.error).toBe(true);
    expect(result.code).toBe('timeout');
    expect(result.message).toMatch(/timed out/i);
    // Wrapped up well under the real 30-second budget.
    expect(elapsed).toBeLessThan(2000);
  });

  // ---- 8. Explicit close() releases every opened transport (I2) --------

  it('close() invokes .close() on every healthy client opened during discovery', async () => {
    const a = conn(UUID_A);
    const b = conn(UUID_B);
    const bad = conn(UUID_C);
    listConnections.mockResolvedValueOnce([a, b, bad]);

    const clientA = makeFakeClient();
    const clientB = makeFakeClient();
    connectToMcpServer.mockImplementation(async (c: McpConnection) => {
      if (c.id === UUID_A) return clientA;
      if (c.id === UUID_B) return clientB;
      throw new Error('bad connection');
    });
    discoverTools.mockImplementation(async () => [
      { name: 'ping', inputSchema: { type: 'object', properties: {} } },
    ]);

    const { close } = await loadMcpOutTools('co-1');
    // Before close(), we should NOT have tried to close healthy clients.
    expect(clientA.close).not.toHaveBeenCalled();
    expect(clientB.close).not.toHaveBeenCalled();

    await close();

    expect(clientA.close).toHaveBeenCalledTimes(1);
    expect(clientB.close).toHaveBeenCalledTimes(1);

    // Second call is a no-op (idempotent).
    await close();
    expect(clientA.close).toHaveBeenCalledTimes(1);
    expect(clientB.close).toHaveBeenCalledTimes(1);
  });

  it('close() swallows individual transport close errors', async () => {
    const a = conn(UUID_A);
    const b = conn(UUID_B);
    listConnections.mockResolvedValueOnce([a, b]);

    const clientA = makeFakeClient();
    clientA.close.mockRejectedValueOnce(new Error('close blew up'));
    const clientB = makeFakeClient();
    connectToMcpServer.mockImplementation(async (c: McpConnection) => {
      return c.id === UUID_A ? clientA : clientB;
    });
    discoverTools.mockResolvedValue([
      { name: 'ping', inputSchema: { type: 'object', properties: {} } },
    ]);

    const { close } = await loadMcpOutTools('co-1');
    await expect(close()).resolves.toBeUndefined();
    // The healthy transport still got closed despite A throwing.
    expect(clientB.close).toHaveBeenCalledTimes(1);
  });

  // ---- 9. Tool name sanitisation (I5) ----------------------------------

  it('sanitises tool names that contain non-conforming characters', async () => {
    const c = conn(UUID_A);
    listConnections.mockResolvedValueOnce([c]);

    const client = makeFakeClient();
    connectToMcpServer.mockResolvedValueOnce(client);
    discoverTools.mockResolvedValueOnce([
      {
        name: 'search.email!',
        description: 'dotted + bang name',
        inputSchema: { type: 'object', properties: {} },
      },
    ]);

    const { tools } = await loadMcpOutTools('co-1');

    const key = Object.keys(tools)[0];
    // Match `ext_<12-hex>_search_email_` — dot and bang became underscores.
    expect(key).toMatch(/^ext_[a-f0-9]{12}_search_email_$/);
    expect(key.length).toBeLessThanOrEqual(64);
  });

  it('truncates the composed tool key to ≤ 64 chars', async () => {
    const c = conn(UUID_A);
    listConnections.mockResolvedValueOnce([c]);

    const client = makeFakeClient();
    connectToMcpServer.mockResolvedValueOnce(client);
    const longName = 'x'.repeat(200);
    discoverTools.mockResolvedValueOnce([
      {
        name: longName,
        inputSchema: { type: 'object', properties: {} },
      },
    ]);

    const { tools } = await loadMcpOutTools('co-1');

    const key = Object.keys(tools)[0];
    expect(key.length).toBeLessThanOrEqual(64);
    expect(key.startsWith(`ext_${prefix(UUID_A)}_`)).toBe(true);
  });
});

// ---- buildToolKey direct unit tests (I5) ------------------------------

describe('buildToolKey', () => {
  it('keeps conformant names intact', () => {
    const key = buildToolKey(UUID_A, 'search_email');
    expect(key).toBe(`ext_${prefix(UUID_A)}_search_email`);
  });

  it('replaces non-conformant chars with underscores', () => {
    const key = buildToolKey(UUID_A, 'search.email!');
    expect(key).toBe(`ext_${prefix(UUID_A)}_search_email_`);
  });

  it('caps the full key at 64 chars', () => {
    const key = buildToolKey(UUID_A, 'x'.repeat(200));
    expect(key.length).toBeLessThanOrEqual(64);
  });
});

// ---- timeout constants are sensibly sized ------------------------------

describe('timeout constants', () => {
  it('DISCOVER_TIMEOUT_MS is a positive number', () => {
    expect(DISCOVER_TIMEOUT_MS).toBeGreaterThan(0);
  });
  it('TOOL_CALL_TIMEOUT_MS is a positive number', () => {
    expect(TOOL_CALL_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
