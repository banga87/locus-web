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
  encryptCredential: vi.fn(async (plaintext: string) =>
    Buffer.from(plaintext, 'utf8'),
  ),
  updateConnectionCredentials: vi.fn(async () => null),
  markConnectionError: vi.fn(async () => {}),
  refreshIfNeeded: vi.fn(),
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
  encryptCredential: mocks.encryptCredential,
  updateConnectionCredentials: mocks.updateConnectionCredentials,
  markConnectionError: mocks.markConnectionError,
}));

vi.mock('@/lib/connectors/mcp-oauth', () => ({
  refreshIfNeeded: mocks.refreshIfNeeded,
}));

const {
  clientConnect,
  clientListTools,
  clientClose,
  clientCtorSpy,
  transportCtorSpy,
  decryptCredential,
  encryptCredential,
  updateConnectionCredentials,
  markConnectionError,
  refreshIfNeeded,
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
  decryptCredential.mockReset();
  decryptCredential.mockImplementation(async (buf: Buffer) =>
    buf.toString('utf8'),
  );
  encryptCredential.mockReset();
  encryptCredential.mockImplementation(async (plaintext: string) =>
    Buffer.from(plaintext, 'utf8'),
  );
  updateConnectionCredentials.mockReset();
  updateConnectionCredentials.mockResolvedValue(null);
  markConnectionError.mockReset();
  markConnectionError.mockResolvedValue(undefined);
  refreshIfNeeded.mockReset();
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
    catalogId: null,
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

  it('injects a Bearer header when authType=bearer and credentials are present (legacy raw-string ciphertext)', async () => {
    const conn = makeConn({
      authType: 'bearer',
      credentialsEncrypted: Buffer.from('tok_abc123', 'utf8'),
    });
    await connectToMcpServer(conn);

    expect(transportCtorSpy).toHaveBeenCalledOnce();
    const [, opts] = transportCtorSpy.mock.calls[0];
    expect(opts?.requestInit?.headers?.Authorization).toBe('Bearer tok_abc123');
  });

  it('injects a Bearer header when authType=bearer and credentials are a JSON envelope', async () => {
    const envelope = JSON.stringify({ kind: 'bearer', token: 'tok_envelope' });
    const conn = makeConn({
      authType: 'bearer',
      credentialsEncrypted: Buffer.from(envelope, 'utf8'),
    });
    await connectToMcpServer(conn);

    const [, opts] = transportCtorSpy.mock.calls[0];
    expect(opts?.requestInit?.headers?.Authorization).toBe('Bearer tok_envelope');
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

  describe('oauth refresh-on-use', () => {
    function makeOauthEnvelope(overrides: Partial<Record<string, unknown>> = {}) {
      return JSON.stringify({
        kind: 'oauth',
        accessToken: 'old-at',
        refreshToken: 'rt-1',
        expiresAt: new Date(Date.now() + 30_000).toISOString(), // 30s away
        tokenType: 'Bearer',
        scope: null,
        dcrClientId: 'dcr-client',
        dcrClientSecret: 'dcr-secret',
        authServerMetadata: {
          authorizationEndpoint: 'https://auth.example.test/authorize',
          tokenEndpoint: 'https://auth.example.test/token',
          registrationEndpoint: 'https://auth.example.test/register',
          revocationEndpoint: null,
          scopesSupported: null,
        },
        ...overrides,
      });
    }

    it('refreshes the token, persists the new blob, and uses the new access token', async () => {
      const envelopeStr = makeOauthEnvelope();
      decryptCredential.mockResolvedValueOnce(envelopeStr);

      const refreshedCreds = {
        kind: 'oauth' as const,
        accessToken: 'new-at',
        refreshToken: 'rt-2',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        tokenType: 'Bearer',
        scope: null,
        dcrClientId: 'dcr-client',
        dcrClientSecret: 'dcr-secret',
        authServerMetadata: {
          authorizationEndpoint: 'https://auth.example.test/authorize',
          tokenEndpoint: 'https://auth.example.test/token',
          registrationEndpoint: 'https://auth.example.test/register',
          revocationEndpoint: null,
          scopesSupported: null,
        },
      };
      refreshIfNeeded.mockResolvedValueOnce({
        kind: 'refreshed',
        credentials: refreshedCreds,
      });

      const conn = makeConn({
        id: 'oauth-conn-1',
        companyId: 'co-xyz',
        authType: 'oauth',
        credentialsEncrypted: Buffer.from('ciphertext'),
      });

      await connectToMcpServer(conn);

      // refreshIfNeeded fired with the decoded envelope.
      expect(refreshIfNeeded).toHaveBeenCalledOnce();
      const [passedCreds, passedNow] = refreshIfNeeded.mock.calls[0] as [
        { kind: string; accessToken: string; refreshToken: string },
        Date,
      ];
      expect(passedCreds).toMatchObject({
        kind: 'oauth',
        accessToken: 'old-at',
        refreshToken: 'rt-1',
      });
      expect(passedNow).toBeInstanceOf(Date);

      // The refreshed blob was re-encrypted and persisted.
      expect(encryptCredential).toHaveBeenCalledOnce();
      const [encryptArg] = encryptCredential.mock.calls[0] as [string];
      expect(JSON.parse(encryptArg)).toMatchObject({
        kind: 'oauth',
        accessToken: 'new-at',
        refreshToken: 'rt-2',
      });

      expect(updateConnectionCredentials).toHaveBeenCalledOnce();
      const [connId, companyId, blob] = updateConnectionCredentials.mock
        .calls[0] as unknown as [string, string, Buffer];
      expect(connId).toBe('oauth-conn-1');
      expect(companyId).toBe('co-xyz');
      expect(Buffer.isBuffer(blob)).toBe(true);

      // The transport got the NEW access token.
      const [, opts] = transportCtorSpy.mock.calls[0];
      expect(opts?.requestInit?.headers?.Authorization).toBe('Bearer new-at');
    });

    it('uses the existing access token when refreshIfNeeded returns unchanged', async () => {
      decryptCredential.mockResolvedValueOnce(makeOauthEnvelope());
      refreshIfNeeded.mockResolvedValueOnce({ kind: 'unchanged' });

      const conn = makeConn({
        authType: 'oauth',
        credentialsEncrypted: Buffer.from('ciphertext'),
      });

      await connectToMcpServer(conn);

      expect(updateConnectionCredentials).not.toHaveBeenCalled();
      expect(encryptCredential).not.toHaveBeenCalled();
      const [, opts] = transportCtorSpy.mock.calls[0];
      expect(opts?.requestInit?.headers?.Authorization).toBe('Bearer old-at');
    });

    it('marks the connection errored and throws on invalid_grant', async () => {
      decryptCredential.mockResolvedValueOnce(makeOauthEnvelope());
      refreshIfNeeded.mockResolvedValueOnce({
        kind: 'invalid_grant',
        error: 'refresh HTTP 400',
      });

      const conn = makeConn({
        id: 'oauth-conn-dead',
        authType: 'oauth',
        credentialsEncrypted: Buffer.from('ciphertext'),
      });

      await expect(connectToMcpServer(conn)).rejects.toThrow(
        /reconnect needed/i,
      );

      expect(markConnectionError).toHaveBeenCalledOnce();
      const [id, message] = markConnectionError.mock.calls[0] as unknown as [
        string,
        string,
      ];
      expect(id).toBe('oauth-conn-dead');
      expect(message).toMatch(/reconnect needed/i);

      // No handshake should have happened.
      expect(transportCtorSpy).not.toHaveBeenCalled();
      expect(clientConnect).not.toHaveBeenCalled();
    });
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
