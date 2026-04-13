// Tests for the MCP OUT client wrapper.
//
// The MCP SDK is mocked at the module boundary so we can assert that
// - `connectToMcpServer` builds the correct transport (URL + auth header)
// - `discoverTools` normalises the SDK's tool shape
// - bearer-auth connections decrypt the stored credential and inject it
//   as `Authorization: Bearer ...`
//
// We do NOT exercise the real SDK's transport — integration against a
// real server is Step 9 and the plan marks it as manual / optional.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- MCP SDK mocks (hoisted above module-under-test import) ------------
//
// `vi.mock()` is hoisted above top-level imports, which means any
// identifiers referenced inside the factory must be hoisted too. Using
// `vi.hoisted()` gives us live references that both the mock factories
// and the test bodies read from.

const mocks = vi.hoisted(() => ({
  clientConnect: vi.fn(),
  clientListTools: vi.fn(),
  clientClose: vi.fn(),
  clientCtorSpy: vi.fn(),
  transportCtorSpy: vi.fn(),
  decryptCredential: vi.fn(async (buf: Buffer) => buf.toString('utf8')),
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  class FakeClient {
    constructor(info: unknown, options: unknown) {
      mocks.clientCtorSpy(info, options);
    }
    connect = (t: unknown, opts?: unknown) => mocks.clientConnect(t, opts);
    listTools = (params?: unknown, opts?: unknown) =>
      mocks.clientListTools(params, opts);
    close = () => mocks.clientClose();
  }
  return { Client: FakeClient };
});

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => {
  class FakeTransport {
    constructor(
      url: URL,
      opts?: { requestInit?: { headers?: Record<string, string> } },
    ) {
      mocks.transportCtorSpy(url, opts);
    }
  }
  return { StreamableHTTPClientTransport: FakeTransport };
});

// --- Connection helpers mocked — we do NOT want the live DB in this file.

vi.mock('../connections', () => ({
  decryptCredential: mocks.decryptCredential,
}));

const {
  clientConnect,
  clientListTools,
  clientClose,
  clientCtorSpy,
  transportCtorSpy,
} = mocks;

// --- Subject -----------------------------------------------------------

import { connectToMcpServer, discoverTools } from '../client';
import type { McpConnection } from '../types';

beforeEach(() => {
  clientConnect.mockReset();
  clientListTools.mockReset();
  clientClose.mockReset();
  clientCtorSpy.mockReset();
  transportCtorSpy.mockReset();
  clientConnect.mockResolvedValue(undefined);
});

function makeConn(overrides: Partial<McpConnection> = {}): McpConnection {
  return {
    id: 'conn-1',
    companyId: 'co-1',
    name: 'Test server',
    serverUrl: 'https://mcp.example.test/v1',
    authType: 'none',
    credentialsEncrypted: null,
    status: 'active',
    lastErrorMessage: null,
    createdAt: new Date(),
    lastUsedAt: null,
    ...overrides,
  };
}

describe('connectToMcpServer', () => {
  it('constructs a transport against the connection URL without auth headers for authType=none', async () => {
    const conn = makeConn({ authType: 'none' });
    await connectToMcpServer(conn);

    expect(transportCtorSpy).toHaveBeenCalledOnce();
    const [url, opts] = transportCtorSpy.mock.calls[0];
    expect(url.toString()).toBe('https://mcp.example.test/v1');
    // Either no requestInit or headers object should be empty.
    const headers = opts?.requestInit?.headers ?? {};
    expect(headers).not.toHaveProperty('Authorization');
  });

  it('injects a Bearer header when authType=bearer and credentials are present', async () => {
    const conn = makeConn({
      authType: 'bearer',
      credentialsEncrypted: Buffer.from('tok_abc123', 'utf8'),
    });
    await connectToMcpServer(conn);

    expect(transportCtorSpy).toHaveBeenCalledOnce();
    const [, opts] = transportCtorSpy.mock.calls[0];
    expect(opts?.requestInit?.headers?.Authorization).toBe('Bearer tok_abc123');
  });

  it('constructs a Client with the Locus identity', async () => {
    await connectToMcpServer(makeConn());
    expect(clientCtorSpy).toHaveBeenCalledOnce();
    const [info] = clientCtorSpy.mock.calls[0];
    expect(info).toEqual({ name: 'locus-platform-agent', version: '0.1.0' });
  });

  it('calls client.connect with the transport', async () => {
    await connectToMcpServer(makeConn());
    expect(clientConnect).toHaveBeenCalledOnce();
  });

  it('passes an AbortSignal and timeout into client.connect', async () => {
    await connectToMcpServer(makeConn(), 2000);
    expect(clientConnect).toHaveBeenCalledOnce();
    const [, opts] = clientConnect.mock.calls[0] as [unknown, { signal?: AbortSignal; timeout?: number } | undefined];
    expect(opts?.signal).toBeInstanceOf(AbortSignal);
    expect(opts?.timeout).toBe(2000);
  });

  it('passes an AbortSignal into the transport requestInit', async () => {
    await connectToMcpServer(makeConn());
    const [, transportOpts] = transportCtorSpy.mock.calls[0] as [
      URL,
      { requestInit?: { signal?: AbortSignal } } | undefined,
    ];
    expect(transportOpts?.requestInit?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('discoverTools', () => {
  it('normalises the SDK tool shape', async () => {
    clientListTools.mockResolvedValueOnce({
      tools: [
        {
          name: 'search_email',
          description: 'Search Gmail',
          inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
        },
        {
          // Missing description — should still be accepted.
          name: 'list_labels',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    });

    const client = await connectToMcpServer(makeConn());
    const tools = await discoverTools(client);

    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({
      name: 'search_email',
      description: 'Search Gmail',
    });
    expect(tools[1].description).toBeUndefined();
    expect(tools[1].inputSchema).toEqual({ type: 'object', properties: {} });
  });

  it('defaults inputSchema when the remote tool omits it', async () => {
    clientListTools.mockResolvedValueOnce({
      tools: [{ name: 'ping' }],
    });

    const client = await connectToMcpServer(makeConn());
    const tools = await discoverTools(client);

    expect(tools[0].inputSchema).toEqual({ type: 'object', properties: {} });
  });

  it('passes the timeout option into client.listTools', async () => {
    clientListTools.mockResolvedValueOnce({ tools: [] });

    const client = await connectToMcpServer(makeConn());
    await discoverTools(client, 3000);

    expect(clientListTools).toHaveBeenCalledWith(undefined, { timeout: 3000 });
  });
});
