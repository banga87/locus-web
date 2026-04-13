// Agent Tokens settings page. Owner-only. Lists existing tokens and opens
// the create-token dialog. Queries the DB directly (the /api/admin/tokens
// GET endpoint is server-only already — going through the DB here skips a
// round-trip).

import { notFound } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { agentAccessTokens } from '@/db/schema';
import { requireAuth } from '@/lib/api/auth';
import { TokenList } from '@/components/tokens/token-list';
import { CreateTokenDialog } from '@/components/tokens/create-token-dialog';

export default async function AgentTokensPage() {
  const ctx = await requireAuth();
  if (!ctx.companyId) return notFound();

  // Mirrors the API route's auth: only Owners manage tokens.
  if (ctx.role !== 'owner') return notFound();

  const rows = await db
    .select({
      id: agentAccessTokens.id,
      name: agentAccessTokens.name,
      prefix: agentAccessTokens.tokenPrefix,
      status: agentAccessTokens.status,
      createdAt: agentAccessTokens.createdAt,
      revokedAt: agentAccessTokens.revokedAt,
      lastUsedAt: agentAccessTokens.lastUsedAt,
    })
    .from(agentAccessTokens)
    .where(eq(agentAccessTokens.companyId, ctx.companyId))
    .orderBy(desc(agentAccessTokens.createdAt));

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agent tokens</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bearer tokens for external AI agents connecting via MCP.
          </p>
        </div>
        <CreateTokenDialog />
      </header>
      <TokenList tokens={rows} />
    </div>
  );
}
