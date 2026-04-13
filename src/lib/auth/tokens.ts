// Agent Access Token primitives — generation, hashing, validation,
// creation, and revocation. See design doc 11-auth-and-access.md §4.1–4.4.
//
// Format: `lat_live_` (9 chars) + 53 chars of base62 entropy = 62 chars.
// Hashing: SHA-256. Tokens are compared by hash, never by plaintext.
// Storage: raw tokens are returned exactly once at creation time.

import { createHash, randomBytes } from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { agentAccessTokens } from '@/db/schema';

const TOKEN_PREFIX = 'lat_live_';
const TOKEN_BODY_LENGTH = 53; // 9 + 53 = 62
const PREFIX_FOR_STORAGE_LENGTH = 12;

const BASE62_ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Generate a raw agent access token.
 *
 * 39 random bytes = 312 bits of entropy, well above the 256-bit floor called
 * out in the design doc. Base62 encoding of 39 bytes reliably produces ≥53
 * characters (log₆₂(256³⁹) ≈ 52.4), which we slice to exactly 53 for a
 * stable 62-char output length.
 *
 * Note: if the high-order byte is zero the natural base62 encoding is
 * shorter than 53 chars. We guard that case by padding with the first
 * alphabet character ('0') — the total entropy contributed by the random
 * bytes is unchanged.
 */
export function generateToken(): string {
  const bytes = randomBytes(39);
  const encoded = encodeBase62(bytes);
  const body =
    encoded.length >= TOKEN_BODY_LENGTH
      ? encoded.slice(0, TOKEN_BODY_LENGTH)
      : encoded.padStart(TOKEN_BODY_LENGTH, BASE62_ALPHABET[0]);
  return `${TOKEN_PREFIX}${body}`;
}

/** SHA-256 hex digest of the raw token. Deterministic, 64 chars, lowercase. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Look up a token by hash and return the row if it is active and unrevoked.
 * Returns `null` for unknown, revoked, or status != 'active' tokens.
 *
 * NOTE: Does NOT check `expiresAt` yet — the expiration sweep job is
 * deferred to Phase 2 per design doc §4.4 (expiration automation).
 */
export async function validateToken(
  token: string
): Promise<typeof agentAccessTokens.$inferSelect | null> {
  const hash = hashToken(token);
  const rows = await db
    .select()
    .from(agentAccessTokens)
    .where(
      and(
        eq(agentAccessTokens.tokenHash, hash),
        isNull(agentAccessTokens.revokedAt),
        eq(agentAccessTokens.status, 'active')
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Create a new agent access token. Inserts a hash + metadata row and
 * returns the raw token exactly once — it is never recoverable after this.
 *
 * Pre-MVP: scopes are hardcoded to `['read']`. The scope-picker UI and
 * write-scope support land in MVP / Phase 1.
 */
export async function createToken(params: {
  companyId: string;
  name: string;
  createdBy: string;
}): Promise<{
  token: string;
  record: typeof agentAccessTokens.$inferSelect;
}> {
  const token = generateToken();
  const hash = hashToken(token);
  const prefix = token.slice(0, PREFIX_FOR_STORAGE_LENGTH);

  const [record] = await db
    .insert(agentAccessTokens)
    .values({
      companyId: params.companyId,
      name: params.name,
      createdBy: params.createdBy,
      tokenHash: hash,
      tokenPrefix: prefix,
      scopes: ['read'], // Pre-MVP: hardcoded. Phase 2 introduces scope picker.
      status: 'active',
    })
    .returning();

  return { token, record };
}

/**
 * Revoke a token by id. Sets `revokedAt = now()` and `status = 'revoked'`.
 * Idempotent — calling twice is a no-op beyond updating the timestamp.
 */
export async function revokeToken(tokenId: string): Promise<void> {
  await db
    .update(agentAccessTokens)
    .set({ revokedAt: new Date(), status: 'revoked' })
    .where(eq(agentAccessTokens.id, tokenId));
}

// --- internals -----------------------------------------------------------

/**
 * Base62 encode a byte array via BigInt arithmetic. Output uses the
 * [0-9A-Za-z] alphabet, most-significant digit first. Returns '0' for
 * all-zero input.
 *
 * Uses BigInt() constructor calls instead of `0n` literals because the
 * project's tsconfig targets ES2017 (literals require ES2020+).
 */
function encodeBase62(bytes: Uint8Array): string {
  const ZERO = BigInt(0);
  const EIGHT = BigInt(8);
  const SIXTY_TWO = BigInt(62);

  let n = ZERO;
  for (const b of bytes) {
    n = (n << EIGHT) | BigInt(b);
  }
  if (n === ZERO) return '0';
  let out = '';
  while (n > ZERO) {
    out = BASE62_ALPHABET[Number(n % SIXTY_TWO)] + out;
    n = n / SIXTY_TWO;
  }
  return out;
}
