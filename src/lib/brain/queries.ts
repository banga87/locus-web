// Brain lookup helpers.
//
// Pre-MVP: one brain per company. The MCP server resolves the caller's
// brain by their token's `companyId`. When multi-brain support lands the
// signature will take an additional brain slug / id.

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db';
import { brains } from '@/db/schema';

export async function getBrainForCompany(
  companyId: string,
): Promise<typeof brains.$inferSelect> {
  const [brain] = await db
    .select()
    .from(brains)
    .where(and(eq(brains.companyId, companyId), isNull(brains.deletedAt)))
    .limit(1);

  if (!brain) {
    throw new Error(`No brain found for company ${companyId}`);
  }

  return brain;
}
