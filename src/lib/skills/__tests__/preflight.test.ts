// preflight.ts tests — checks MCP connection requirements before a run.
//
// Integration tests against the real DB. Seeds mcp_connections rows for
// a test company, then verifies preflight returns ok/missing correctly.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { db } from '@/db';
import { companies } from '@/db/schema/companies';
import { users } from '@/db/schema/users';
import { mcpConnections } from '@/db/schema/mcp-connections';
import type { SkillTrigger } from '@/lib/brain/frontmatter';

import { preflight } from '../preflight';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface PreflightFixtures {
  companyId: string;
  userId: string;
  gmailConnectionId: string;
  hubspotConnectionId: string;
}

async function setupPreflightFixtures(): Promise<PreflightFixtures> {
  const suffix = `pf-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const [company] = await db
    .insert(companies)
    .values({ name: `PF Co ${suffix}`, slug: `pf-${suffix}` })
    .returning({ id: companies.id });

  const userId = randomUUID();
  await db.insert(users).values({
    id: userId,
    companyId: company!.id,
    fullName: 'PF User',
    email: `pf-${suffix}@example.test`,
    status: 'active',
  });

  // Insert two active MCP connections whose catalog_id matches the
  // slug passed in `requires_mcps`. `name` is deliberately a display
  // label (not the slug) to mirror the production shape.
  const [gmail] = await db
    .insert(mcpConnections)
    .values({
      companyId: company!.id,
      name: 'Gmail',
      catalogId: 'gmail',
      serverUrl: 'https://mcp.example.com/gmail',
      authType: 'none',
      status: 'active',
    })
    .returning({ id: mcpConnections.id });

  const [hubspot] = await db
    .insert(mcpConnections)
    .values({
      companyId: company!.id,
      name: 'HubSpot',
      catalogId: 'hubspot',
      serverUrl: 'https://mcp.example.com/hubspot',
      authType: 'none',
      status: 'active',
    })
    .returning({ id: mcpConnections.id });

  return {
    companyId: company!.id,
    userId,
    gmailConnectionId: gmail!.id,
    hubspotConnectionId: hubspot!.id,
  };
}

async function teardownPreflightFixtures(f: PreflightFixtures): Promise<void> {
  await db.delete(mcpConnections).where(eq(mcpConnections.companyId, f.companyId));
  await db.delete(users).where(eq(users.id, f.userId));
  await db.delete(companies).where(eq(companies.id, f.companyId));
}

/** Helper: build a minimal SkillTrigger for preflight tests. */
function trigger(requires_mcps: string[]): SkillTrigger {
  return {
    output: 'document',
    output_category: null,
    requires_mcps,
    schedule: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let fix: PreflightFixtures;

beforeAll(async () => {
  fix = await setupPreflightFixtures();
});

afterAll(async () => {
  await teardownPreflightFixtures(fix);
});

describe('preflight', () => {
  it('returns ok=true when requires_mcps is empty', async () => {
    const result = await preflight(trigger([]), fix.companyId);
    expect(result).toEqual({ ok: true });
  });

  it('returns ok=true when all required MCPs are connected and active', async () => {
    const result = await preflight(
      trigger(['gmail', 'hubspot']),
      fix.companyId,
    );
    expect(result).toEqual({ ok: true });
  });

  it('returns ok=true when a subset of required MCPs matches', async () => {
    const result = await preflight(trigger(['gmail']), fix.companyId);
    expect(result).toEqual({ ok: true });
  });

  it('returns ok=false with missing list when a required MCP is not connected', async () => {
    const result = await preflight(
      trigger(['gmail', 'xero']),
      fix.companyId,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toEqual(['xero']);
    }
  });

  it('returns ok=false listing all missing MCPs when none are connected', async () => {
    const result = await preflight(
      trigger(['slack', 'notion']),
      fix.companyId,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toEqual(expect.arrayContaining(['slack', 'notion']));
      expect(result.missing).toHaveLength(2);
    }
  });

  it('ignores disabled MCP connections — treats them as missing', async () => {
    // Insert a disabled connection for 'xero'
    const [disabled] = await db
      .insert(mcpConnections)
      .values({
        companyId: fix.companyId,
        name: 'Xero',
        catalogId: 'xero',
        serverUrl: 'https://mcp.example.com/xero',
        authType: 'none',
        status: 'disabled',
      })
      .returning({ id: mcpConnections.id });

    const result = await preflight(trigger(['xero']), fix.companyId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toEqual(['xero']);
    }

    // Cleanup
    await db.delete(mcpConnections).where(eq(mcpConnections.id, disabled!.id));
  });
});
