// MCP OUT connection helpers — CRUD + credential encryption.
//
// Encryption strategy (per Phase 1 plan Task 3 §Steps 3-4):
//   - `MCP_CONNECTION_ENCRYPTION_KEY` is a 32-byte hex string (64 hex
//     chars, generated via `openssl rand -hex 32`). We validate the
//     format on every encrypt/decrypt call so a missing or truncated key
//     fails loudly instead of silently storing garbled ciphertext.
//   - `encryptCredential()` and `decryptCredential()` delegate to
//     pgcrypto's `pgp_sym_encrypt` / `pgp_sym_decrypt` — the DB is
//     where both the ciphertext and the key material live at execution
//     time, so credentials never leave the server-to-DB path in
//     plaintext.
//   - Key rotation is an explicit Phase 2 gap. Changing
//     MCP_CONNECTION_ENCRYPTION_KEY after rows exist renders existing
//     rows undecryptable; we document this in the env var comment and
//     do not attempt to fix it here.
//
// CRUD helpers mirror the shape of other Pre-MVP helpers
// (`src/lib/auth/tokens.ts`): typed inputs, narrow return types, no
// global auth assumptions — routes are responsible for `requireRole`
// and scoping by `companyId`.

import { eq, and } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

import { db } from '@/db';
import { mcpConnections } from '@/db/schema';
import { encodeCredentials } from '@/lib/connectors/credentials';

import type {
  McpConnection,
  McpConnectionAuthType,
  McpConnectionStatus,
} from './types';

// --- Key handling --------------------------------------------------------

/**
 * Resolve + validate the encryption key. Separated from the encrypt
 * helpers so tests can exercise the validation path directly.
 */
export function getEncryptionKey(): string {
  const key = process.env.MCP_CONNECTION_ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      'MCP_CONNECTION_ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32`.',
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      'MCP_CONNECTION_ENCRYPTION_KEY must be a 32-byte hex string (64 hex chars).',
    );
  }
  return key;
}

// --- Encryption ----------------------------------------------------------

/**
 * Encrypt a plaintext credential via pgcrypto. The hex-encoded key is
 * decoded to 32 bytes inside SQL via `decode(key, 'hex')`, then passed
 * to `pgp_sym_encrypt` which expects a text passphrase — so we
 * `encode(..., 'hex')` the bytes again to serialise. This is symmetric
 * with `decryptCredential` and matches the Phase 1 plan sample verbatim.
 */
export async function encryptCredential(plaintext: string): Promise<Buffer> {
  const key = getEncryptionKey();
  const result = await db.execute(
    sql`SELECT pgp_sym_encrypt(${plaintext}::text, encode(decode(${key}, 'hex'), 'hex')) AS encrypted`,
  );
  const rows = rowsArray<{ encrypted: Buffer | null }>(result);
  const encrypted = rows[0]?.encrypted;
  if (!encrypted) {
    throw new Error(
      'pgcrypto returned no ciphertext — check pgcrypto extension is enabled.',
    );
  }
  return encrypted;
}

/**
 * Inverse of `encryptCredential`. Throws if the ciphertext was encrypted
 * under a different key (pgcrypto raises a generic "Wrong key or corrupt
 * data" error — we surface it unchanged).
 */
export async function decryptCredential(encrypted: Buffer): Promise<string> {
  const key = getEncryptionKey();
  const result = await db.execute(
    sql`SELECT pgp_sym_decrypt(${encrypted}::bytea, encode(decode(${key}, 'hex'), 'hex')) AS decrypted`,
  );
  const rows = rowsArray<{ decrypted: string | null }>(result);
  const decrypted = rows[0]?.decrypted;
  if (decrypted == null) {
    throw new Error('pgcrypto returned no plaintext while decrypting credential.');
  }
  return decrypted;
}

// postgres-js returns an array-like result; normalising here keeps the
// helpers above readable. Drizzle's `db.execute()` return shape shifts
// slightly across driver versions so we code defensively.
function rowsArray<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in (result as object)) {
    const rows = (result as { rows: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return [];
}

// --- Read helpers --------------------------------------------------------

/**
 * List connections for a company. When `activeOnly`, filters to
 * `status = 'active'` — this is what `loadMcpOutTools()` uses on every
 * chat turn. Results are unordered; callers sort as needed.
 */
export async function listConnections(
  companyId: string,
  activeOnly = false,
): Promise<McpConnection[]> {
  const conditions = [eq(mcpConnections.companyId, companyId)];
  if (activeOnly) {
    conditions.push(eq(mcpConnections.status, 'active'));
  }
  const rows = await db
    .select()
    .from(mcpConnections)
    .where(and(...conditions));
  return rows.map(toConnection);
}

export async function getConnection(
  id: string,
  companyId: string,
): Promise<McpConnection | null> {
  const [row] = await db
    .select()
    .from(mcpConnections)
    .where(
      and(
        eq(mcpConnections.id, id),
        eq(mcpConnections.companyId, companyId),
      ),
    )
    .limit(1);
  return row ? toConnection(row) : null;
}

// --- Mutations -----------------------------------------------------------

export interface CreateConnectionInput {
  companyId: string;
  name: string;
  serverUrl: string;
  authType: McpConnectionAuthType;
  /** Required iff `authType === 'bearer'`. */
  bearerToken?: string;
}

/**
 * Insert a new connection. Callers are responsible for server-URL
 * validation (the route parses + rejects bad URLs before we hit here —
 * storing a malformed URL would just fail on first connect-test anyway).
 *
 * Bearer tokens are encrypted before insert via pgcrypto. Passing an
 * empty / whitespace-only `bearerToken` with `authType = 'bearer'`
 * leaves `credentialsEncrypted = null`, which will fail the connect
 * test and flip the row to `status = 'error'` — that's the same UX as
 * a wrong token and keeps the code path simple.
 */
export async function createConnection(
  input: CreateConnectionInput,
): Promise<McpConnection> {
  const credentialsEncrypted =
    input.authType === 'bearer' && input.bearerToken && input.bearerToken.length > 0
      ? await encryptCredential(
          encodeCredentials({ kind: 'bearer', token: input.bearerToken }),
        )
      : null;

  const [row] = await db
    .insert(mcpConnections)
    .values({
      companyId: input.companyId,
      name: input.name,
      serverUrl: input.serverUrl,
      authType: input.authType,
      credentialsEncrypted,
    })
    .returning();
  return toConnection(row);
}

export interface UpdateConnectionInput {
  name?: string;
  serverUrl?: string;
  authType?: McpConnectionAuthType;
  /** If set, replaces the stored credential. Null clears it. */
  bearerToken?: string | null;
  status?: McpConnectionStatus;
  /** Set to null to clear a previous error. */
  lastErrorMessage?: string | null;
}

/**
 * Patch a connection. Scoped by `companyId` to prevent cross-tenant
 * writes even if a caller guesses an id. Returns `null` when no row
 * matches (the caller should 404 in that case).
 *
 * Note: Drizzle's `update ... returning()` returns `[]` when no row
 * matches the `where`, so we don't need a separate "exists" check.
 */
export async function updateConnection(
  id: string,
  companyId: string,
  patch: UpdateConnectionInput,
): Promise<McpConnection | null> {
  const values: Record<string, unknown> = {};
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.serverUrl !== undefined) values.serverUrl = patch.serverUrl;
  if (patch.authType !== undefined) values.authType = patch.authType;
  if (patch.status !== undefined) values.status = patch.status;
  if (patch.lastErrorMessage !== undefined) {
    values.lastErrorMessage = patch.lastErrorMessage;
  }
  if (patch.bearerToken !== undefined) {
    values.credentialsEncrypted =
      patch.bearerToken === null || patch.bearerToken.length === 0
        ? null
        : await encryptCredential(
            encodeCredentials({ kind: 'bearer', token: patch.bearerToken }),
          );
  }

  if (Object.keys(values).length === 0) {
    // No-op patch — fetch + return.
    return getConnection(id, companyId);
  }

  const [row] = await db
    .update(mcpConnections)
    .set(values)
    .where(
      and(
        eq(mcpConnections.id, id),
        eq(mcpConnections.companyId, companyId),
      ),
    )
    .returning();
  return row ? toConnection(row) : null;
}

/**
 * Flag a connection as errored. Called from `loadMcpOutTools` when a
 * runtime connect/listTools fails. Separate from `updateConnection` so
 * the bridge doesn't have to import the whole patch shape.
 */
export async function markConnectionError(
  id: string,
  message: string,
): Promise<void> {
  // Truncate the message so arbitrarily long error strings don't blow
  // up the UI. 500 chars is plenty for "Connection refused" + context.
  await db
    .update(mcpConnections)
    .set({ status: 'error', lastErrorMessage: message.slice(0, 500) })
    .where(eq(mcpConnections.id, id));
}

/**
 * Bump `lastUsedAt` on successful tool discovery. Fire-and-forget from
 * the bridge's perspective — callers should not await this inside the
 * hot path but currently do because Drizzle's single-statement UPDATE
 * is cheap (a few ms) and we want the hot-path DB work bounded.
 */
export async function touchConnection(id: string): Promise<void> {
  await db
    .update(mcpConnections)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(mcpConnections.id, id));
}

export interface InstallFromCatalogInput {
  companyId: string;
  catalogId: string;
  name: string;
  serverUrl: string;
  authType: McpConnectionAuthType; // 'oauth' or 'bearer'
  /** Encrypted credentials blob (JSON string, then pgcrypto-encrypted). */
  credentialsEncrypted: Buffer | null;
  initialStatus: McpConnectionStatus; // 'pending' for oauth, 'active' for bearer
}

export async function installFromCatalog(
  input: InstallFromCatalogInput,
): Promise<McpConnection> {
  const [row] = await db
    .insert(mcpConnections)
    .values({
      companyId: input.companyId,
      name: input.name,
      serverUrl: input.serverUrl,
      authType: input.authType,
      credentialsEncrypted: input.credentialsEncrypted,
      status: input.initialStatus,
      catalogId: input.catalogId,
    })
    .returning();
  return toConnection(row);
}

export async function updateConnectionCredentials(
  id: string,
  companyId: string,
  credentialsEncrypted: Buffer,
  status: McpConnectionStatus = 'active',
): Promise<McpConnection | null> {
  const [row] = await db
    .update(mcpConnections)
    .set({ credentialsEncrypted, status, lastErrorMessage: null })
    .where(and(eq(mcpConnections.id, id), eq(mcpConnections.companyId, companyId)))
    .returning();
  return row ? toConnection(row) : null;
}

export async function deleteConnection(
  id: string,
  companyId: string,
): Promise<boolean> {
  const rows = await db
    .delete(mcpConnections)
    .where(
      and(
        eq(mcpConnections.id, id),
        eq(mcpConnections.companyId, companyId),
      ),
    )
    .returning({ id: mcpConnections.id });
  return rows.length > 0;
}

// --- Internals -----------------------------------------------------------

// Drizzle's inferred row type is wider than our public `McpConnection`
// (it may include extra fields added later); normalise here so the
// in-memory shape is stable.
type RawRow = typeof mcpConnections.$inferSelect;

function toConnection(row: RawRow): McpConnection {
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    serverUrl: row.serverUrl,
    authType: row.authType,
    credentialsEncrypted: row.credentialsEncrypted ?? null,
    status: row.status,
    lastErrorMessage: row.lastErrorMessage ?? null,
    catalogId: row.catalogId ?? null,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt ?? null,
  };
}
