// Tests for the MCP OUT connection helpers.
//
// We split the tests into two flavours:
//   1. Pure helpers (`getEncryptionKey`) — no DB needed, exercised
//      directly.
//   2. DB-dependent helpers (encrypt/decrypt round-trip, CRUD,
//      listConnections filtering) — run against the live DB via a
//      scratch company. These follow the same pattern as
//      `src/lib/mcp/__tests__/auth.test.ts` which also exercises real
//      `createToken` / `revokeToken` against the DB.
//
// The live-DB tests are skipped when DATABASE_URL is unset so the
// suite stays runnable in environments without Postgres (e.g. a fresh
// contributor machine).
//
// We avoid mocking the drizzle client directly because the encrypt /
// decrypt path uses raw `sql\`...\`` executions against pgcrypto, and
// the whole point of the test is verifying the SQL round-trip against
// a real database.

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { companies, mcpConnections } from '@/db/schema';

import {
  createConnection,
  decryptCredential,
  deleteConnection,
  encryptCredential,
  getConnection,
  getEncryptionKey,
  listConnections,
  markConnectionError,
  touchConnection,
  updateConnection,
} from '../connections';

// --- getEncryptionKey ---------------------------------------------------

describe('getEncryptionKey', () => {
  const ORIGINAL = process.env.MCP_CONNECTION_ENCRYPTION_KEY;

  afterAll(() => {
    process.env.MCP_CONNECTION_ENCRYPTION_KEY = ORIGINAL;
  });

  it('throws when the key is unset', () => {
    delete process.env.MCP_CONNECTION_ENCRYPTION_KEY;
    expect(() => getEncryptionKey()).toThrow(/not set/);
  });

  it('throws when the key is not 64 hex chars', () => {
    process.env.MCP_CONNECTION_ENCRYPTION_KEY = 'nope';
    expect(() => getEncryptionKey()).toThrow(/32-byte hex/);
  });

  it('accepts a valid hex key', () => {
    process.env.MCP_CONNECTION_ENCRYPTION_KEY = 'a'.repeat(64);
    expect(getEncryptionKey()).toBe('a'.repeat(64));
  });
});

// --- live-DB integration ------------------------------------------------

const HAS_DB = !!process.env.DATABASE_URL;
const describeDb = HAS_DB ? describe : describe.skip;

describeDb('connections (live DB)', () => {
  // Ensure the pgcrypto path has a usable key. A fixed 32-byte hex is
  // fine for the test suite — the DB is ephemeral and the key never
  // leaves local env.
  const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  let TEST_COMPANY_ID: string;
  const createdConnectionIds: string[] = [];

  beforeAll(async () => {
    process.env.MCP_CONNECTION_ENCRYPTION_KEY = TEST_KEY;

    const [company] = await db
      .insert(companies)
      .values({
        name: 'MCP OUT Test Co',
        slug: `mcp-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      })
      .returning();
    TEST_COMPANY_ID = company.id;
  });

  afterAll(async () => {
    // Clean up every row we inserted (in case delete tests fail
    // partway through) so re-runs start clean.
    if (createdConnectionIds.length > 0) {
      for (const id of createdConnectionIds) {
        await db.delete(mcpConnections).where(eq(mcpConnections.id, id));
      }
    }
    if (TEST_COMPANY_ID) {
      await db.delete(companies).where(eq(companies.id, TEST_COMPANY_ID));
    }
  });

  describe('encryptCredential / decryptCredential', () => {
    it('round-trips a string', async () => {
      const plaintext = `secret-${randomUUID()}`;
      const encrypted = await encryptCredential(plaintext);
      expect(Buffer.isBuffer(encrypted)).toBe(true);
      expect(encrypted.length).toBeGreaterThan(0);

      const decrypted = await decryptCredential(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('produces distinct ciphertexts for the same plaintext (randomised IV)', async () => {
      const a = await encryptCredential('hello');
      const b = await encryptCredential('hello');
      expect(a.equals(b)).toBe(false);
    });

    it('rejects a decrypt attempt with a wrong key', async () => {
      const plaintext = 'secret';
      const encrypted = await encryptCredential(plaintext);

      const OLD = process.env.MCP_CONNECTION_ENCRYPTION_KEY;
      process.env.MCP_CONNECTION_ENCRYPTION_KEY =
        'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
      try {
        await expect(decryptCredential(encrypted)).rejects.toThrow();
      } finally {
        process.env.MCP_CONNECTION_ENCRYPTION_KEY = OLD;
      }
    });
  });

  describe('createConnection + getConnection', () => {
    it('creates a none-auth connection without a credential', async () => {
      const row = await createConnection({
        companyId: TEST_COMPANY_ID,
        name: 'none-auth',
        serverUrl: 'https://example.test/mcp',
        authType: 'none',
      });
      createdConnectionIds.push(row.id);

      expect(row.status).toBe('active');
      expect(row.credentialsEncrypted).toBeNull();

      const fetched = await getConnection(row.id, TEST_COMPANY_ID);
      expect(fetched?.id).toBe(row.id);
    });

    it('encrypts a bearer token before insert', async () => {
      const secret = `token-${randomUUID()}`;
      const row = await createConnection({
        companyId: TEST_COMPANY_ID,
        name: 'bearer-auth',
        serverUrl: 'https://example.test/mcp',
        authType: 'bearer',
        bearerToken: secret,
      });
      createdConnectionIds.push(row.id);

      expect(row.credentialsEncrypted).not.toBeNull();
      expect(Buffer.isBuffer(row.credentialsEncrypted)).toBe(true);

      const plaintext = await decryptCredential(row.credentialsEncrypted!);
      expect(plaintext).toBe(secret);
    });

    it('returns null for a cross-tenant lookup', async () => {
      const row = await createConnection({
        companyId: TEST_COMPANY_ID,
        name: 'isolation-check',
        serverUrl: 'https://example.test/mcp',
        authType: 'none',
      });
      createdConnectionIds.push(row.id);

      const wrong = await getConnection(row.id, randomUUID());
      expect(wrong).toBeNull();
    });
  });

  describe('listConnections', () => {
    it('filters by activeOnly', async () => {
      const active = await createConnection({
        companyId: TEST_COMPANY_ID,
        name: 'list-active',
        serverUrl: 'https://example.test/mcp',
        authType: 'none',
      });
      createdConnectionIds.push(active.id);

      const disabled = await createConnection({
        companyId: TEST_COMPANY_ID,
        name: 'list-disabled',
        serverUrl: 'https://example.test/mcp',
        authType: 'none',
      });
      createdConnectionIds.push(disabled.id);
      await updateConnection(disabled.id, TEST_COMPANY_ID, {
        status: 'disabled',
      });

      const all = await listConnections(TEST_COMPANY_ID);
      expect(all.some((c) => c.id === active.id)).toBe(true);
      expect(all.some((c) => c.id === disabled.id)).toBe(true);

      const onlyActive = await listConnections(TEST_COMPANY_ID, true);
      expect(onlyActive.some((c) => c.id === active.id)).toBe(true);
      expect(onlyActive.some((c) => c.id === disabled.id)).toBe(false);
    });
  });

  describe('updateConnection', () => {
    it('updates simple fields and leaves credential alone when bearerToken omitted', async () => {
      const row = await createConnection({
        companyId: TEST_COMPANY_ID,
        name: 'patch-a',
        serverUrl: 'https://example.test/mcp',
        authType: 'bearer',
        bearerToken: 'original',
      });
      createdConnectionIds.push(row.id);
      const originalCt = row.credentialsEncrypted;

      const patched = await updateConnection(row.id, TEST_COMPANY_ID, {
        name: 'patch-b',
      });
      expect(patched?.name).toBe('patch-b');
      // Credential should be unchanged.
      expect(patched?.credentialsEncrypted?.equals(originalCt!)).toBe(true);
    });

    it('replaces credential when bearerToken is set', async () => {
      const row = await createConnection({
        companyId: TEST_COMPANY_ID,
        name: 'patch-token',
        serverUrl: 'https://example.test/mcp',
        authType: 'bearer',
        bearerToken: 'first',
      });
      createdConnectionIds.push(row.id);

      const patched = await updateConnection(row.id, TEST_COMPANY_ID, {
        bearerToken: 'second',
      });
      expect(patched).not.toBeNull();
      const plaintext = await decryptCredential(patched!.credentialsEncrypted!);
      expect(plaintext).toBe('second');
    });

    it('clears credential when bearerToken is null', async () => {
      const row = await createConnection({
        companyId: TEST_COMPANY_ID,
        name: 'patch-clear',
        serverUrl: 'https://example.test/mcp',
        authType: 'bearer',
        bearerToken: 'original',
      });
      createdConnectionIds.push(row.id);

      const patched = await updateConnection(row.id, TEST_COMPANY_ID, {
        bearerToken: null,
      });
      expect(patched?.credentialsEncrypted).toBeNull();
    });

    it('returns null for a cross-tenant update', async () => {
      const row = await createConnection({
        companyId: TEST_COMPANY_ID,
        name: 'patch-cross',
        serverUrl: 'https://example.test/mcp',
        authType: 'none',
      });
      createdConnectionIds.push(row.id);

      const result = await updateConnection(row.id, randomUUID(), {
        name: 'hax',
      });
      expect(result).toBeNull();
    });
  });

  describe('markConnectionError', () => {
    it('flips status to error and truncates the message', async () => {
      const row = await createConnection({
        companyId: TEST_COMPANY_ID,
        name: 'error-target',
        serverUrl: 'https://example.test/mcp',
        authType: 'none',
      });
      createdConnectionIds.push(row.id);

      const longMessage = 'x'.repeat(1000);
      await markConnectionError(row.id, longMessage);

      const fetched = await getConnection(row.id, TEST_COMPANY_ID);
      expect(fetched?.status).toBe('error');
      expect(fetched?.lastErrorMessage?.length).toBeLessThanOrEqual(500);
    });
  });

  describe('touchConnection', () => {
    it('bumps lastUsedAt', async () => {
      const row = await createConnection({
        companyId: TEST_COMPANY_ID,
        name: 'touch',
        serverUrl: 'https://example.test/mcp',
        authType: 'none',
      });
      createdConnectionIds.push(row.id);
      expect(row.lastUsedAt).toBeNull();

      await touchConnection(row.id);

      const fetched = await getConnection(row.id, TEST_COMPANY_ID);
      expect(fetched?.lastUsedAt).not.toBeNull();
    });
  });

  describe('deleteConnection', () => {
    it('deletes and returns true', async () => {
      const row = await createConnection({
        companyId: TEST_COMPANY_ID,
        name: 'delete-me',
        serverUrl: 'https://example.test/mcp',
        authType: 'none',
      });
      // Do NOT push to createdConnectionIds because we expect it to be gone.

      const ok = await deleteConnection(row.id, TEST_COMPANY_ID);
      expect(ok).toBe(true);

      const missing = await getConnection(row.id, TEST_COMPANY_ID);
      expect(missing).toBeNull();
    });

    it('returns false for a nonexistent connection', async () => {
      const ok = await deleteConnection(randomUUID(), TEST_COMPANY_ID);
      expect(ok).toBe(false);
    });
  });
});
