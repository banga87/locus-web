// Tests for src/lib/auth/tokens.ts
//
// These tests hit the live database via Drizzle. They create a scratch
// company row, insert token records through `createToken()`, and clean
// up everything they inserted in `afterAll`.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { agentAccessTokens, companies } from '@/db/schema';
import {
  createToken,
  generateToken,
  hashToken,
  revokeToken,
  validateToken,
} from '../tokens';

// Track every token id we insert so the afterAll cleanup can nuke them.
const insertedTokenIds: string[] = [];
let TEST_COMPANY_ID: string;
const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';

beforeAll(async () => {
  const [company] = await db
    .insert(companies)
    .values({
      name: 'Token Test Co',
      slug: `token-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    })
    .returning();
  TEST_COMPANY_ID = company.id;
});

afterAll(async () => {
  if (insertedTokenIds.length > 0) {
    await db
      .delete(agentAccessTokens)
      .where(inArray(agentAccessTokens.id, insertedTokenIds));
  }
  if (TEST_COMPANY_ID) {
    await db.delete(companies).where(eq(companies.id, TEST_COMPANY_ID));
  }
});

describe('generateToken()', () => {
  it('returns a string that starts with lat_live_', () => {
    const token = generateToken();
    expect(token.startsWith('lat_live_')).toBe(true);
  });

  it('returns a 62-character token', () => {
    const token = generateToken();
    expect(token.length).toBe(62);
  });

  it('produces different tokens on consecutive calls', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
  });

  it('uses only base62 characters after the prefix', () => {
    const token = generateToken();
    const body = token.slice('lat_live_'.length);
    expect(body).toMatch(/^[0-9A-Za-z]+$/);
  });
});

describe('hashToken()', () => {
  it('returns a 64-char lowercase hex string (SHA-256)', () => {
    const hash = hashToken('lat_live_whatever');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — same input produces same output', () => {
    const a = hashToken('lat_live_abc123');
    const b = hashToken('lat_live_abc123');
    expect(a).toBe(b);
  });

  it('produces different hashes for different inputs', () => {
    const a = hashToken('lat_live_abc123');
    const b = hashToken('lat_live_abc124');
    expect(a).not.toBe(b);
  });
});

describe('createToken()', () => {
  it('inserts a row with scopes=[read], status=active, 12-char prefix', async () => {
    const { token, record } = await createToken({
      companyId: TEST_COMPANY_ID,
      name: 'Test token — create',
      createdBy: TEST_USER_ID,
    });
    insertedTokenIds.push(record.id);

    expect(token.startsWith('lat_live_')).toBe(true);
    expect(record.scopes).toEqual(['read']);
    expect(record.status).toBe('active');
    expect(record.tokenPrefix).toBe(token.slice(0, 12));
    expect(record.tokenPrefix.length).toBe(12);
    expect(record.companyId).toBe(TEST_COMPANY_ID);
    expect(record.name).toBe('Test token — create');
    expect(record.createdBy).toBe(TEST_USER_ID);
    // Raw token must NOT equal stored hash.
    expect(record.tokenHash).not.toBe(token);
    expect(record.tokenHash).toBe(hashToken(token));
  });
});

describe('validateToken()', () => {
  it('returns the record when the token is valid and unrevoked', async () => {
    const { token, record } = await createToken({
      companyId: TEST_COMPANY_ID,
      name: 'Test token — validate',
      createdBy: TEST_USER_ID,
    });
    insertedTokenIds.push(record.id);

    const validated = await validateToken(token);
    expect(validated).not.toBeNull();
    expect(validated?.id).toBe(record.id);
  });

  it('returns null for an unknown token', async () => {
    const validated = await validateToken('lat_live_bogusbogusbogusbogusbogusbogusbogusbogusbogusbogus');
    expect(validated).toBeNull();
  });

  it('returns null once the token has been revoked', async () => {
    const { token, record } = await createToken({
      companyId: TEST_COMPANY_ID,
      name: 'Test token — revoke',
      createdBy: TEST_USER_ID,
    });
    insertedTokenIds.push(record.id);

    // Valid before revocation.
    const before = await validateToken(token);
    expect(before).not.toBeNull();

    await revokeToken(record.id);

    // Null after.
    const after = await validateToken(token);
    expect(after).toBeNull();
  });
});

describe('revokeToken()', () => {
  it('sets status=revoked and revokedAt', async () => {
    const { record } = await createToken({
      companyId: TEST_COMPANY_ID,
      name: 'Test token — revoke status',
      createdBy: TEST_USER_ID,
    });
    insertedTokenIds.push(record.id);

    await revokeToken(record.id);

    const [row] = await db
      .select()
      .from(agentAccessTokens)
      .where(eq(agentAccessTokens.id, record.id))
      .limit(1);

    expect(row.status).toBe('revoked');
    expect(row.revokedAt).not.toBeNull();
  });
});
