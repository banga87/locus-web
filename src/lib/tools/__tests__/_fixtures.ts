// Shared DB-fixture helpers for tool tests.
//
// Each tool test creates its own company/brain/category/users to keep
// suites independent — per-test data with a random suffix avoids unique
// index collisions when the suites run in parallel.

import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { brains } from '@/db/schema/brains';
import { folders } from '@/db/schema/folders';
import { companies } from '@/db/schema/companies';
import { users } from '@/db/schema/users';

import type { ToolContext } from '../types';

export interface Fixtures {
  companyId: string;
  brainId: string;
  folderBrandId: string;
  folderPricingId: string;
  ownerUserId: string;
  ownerEmail: string;
  suffix: string;
  context: ToolContext;
  tokenId: string;
}

/**
 * Build company + brain + a couple of folders + one owner user. Caller
 * is responsible for inserting documents + calling `teardownFixtures`.
 */
export async function setupFixtures(label: string): Promise<Fixtures> {
  const suffix = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const [company] = await db
    .insert(companies)
    .values({ name: `Tool Test Co ${suffix}`, slug: `tool-${suffix}` })
    .returning({ id: companies.id });

  const [brain] = await db
    .insert(brains)
    .values({ companyId: company.id, name: 'Main Brain', slug: 'main' })
    .returning({ id: brains.id });

  const [brandCat] = await db
    .insert(folders)
    .values({
      companyId: company.id,
      brainId: brain.id,
      slug: 'brand',
      name: 'Brand & Voice',
    })
    .returning({ id: folders.id });

  const [pricingCat] = await db
    .insert(folders)
    .values({
      companyId: company.id,
      brainId: brain.id,
      slug: 'pricing',
      name: 'Pricing',
    })
    .returning({ id: folders.id });

  // Owner user. Uses a generated UUID for the id — Supabase Auth would
  // normally own this, but we bypass RLS in tests via the direct
  // connection so nothing enforces auth.users presence here.
  const ownerId = randomUUID();
  const ownerEmail = `owner-${suffix}@example.test`;
  await db.insert(users).values({
    id: ownerId,
    companyId: company.id,
    fullName: 'Test Owner',
    email: ownerEmail,
    status: 'active',
  });

  const tokenId = randomUUID();
  const context: ToolContext = {
    actor: {
      type: 'agent_token',
      id: tokenId,
      scopes: ['read'],
    },
    companyId: company.id,
    brainId: brain.id,
    tokenId,
    grantedCapabilities: ['web'],
    webCallsThisTurn: 0,
  };

  return {
    companyId: company.id,
    brainId: brain.id,
    folderBrandId: brandCat.id,
    folderPricingId: pricingCat.id,
    ownerUserId: ownerId,
    ownerEmail,
    suffix,
    context,
    tokenId,
  };
}

/**
 * Cascade-delete everything the fixture set owns. `brains` cascades to
 * documents + document_versions + folders; users delete manually;
 * companies delete after the above since companyId is restricted.
 *
 * `document_versions` is normally append-only (immutability trigger from
 * migration 0003). For tests we briefly disable that trigger so the
 * brain-cascade can reach through versions without violating the rule.
 * DATABASE_URL uses the superuser role; this would not work from a
 * client with the `authenticated` role.
 */
export async function teardownFixtures(f: Fixtures): Promise<void> {
  await db.delete(users).where(eq(users.id, f.ownerUserId));

  // Use a transaction so DISABLE TRIGGER stays on the same connection as the
  // cascading DELETE. With the Supabase pooler, separate db.execute calls may
  // land on different sessions and the DISABLE won't apply to the DELETE.
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`ALTER TABLE document_versions DISABLE TRIGGER document_versions_immutable`,
    );
    await tx.delete(brains).where(eq(brains.id, f.brainId));
    await tx.execute(
      sql`ALTER TABLE document_versions ENABLE TRIGGER document_versions_immutable`,
    );
  });

  await db.delete(companies).where(eq(companies.id, f.companyId));
}
