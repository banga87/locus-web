// Agent access settings page. Shows the user's connected MCP clients
// (OAuth, per-user) and — for Owners — the company's agent access
// tokens (PATs). The two live together because from the user's POV
// they're both "things that grant an agent access to Locus".
//
// Querying the DB directly here avoids an unnecessary HTTP round-trip
// to the /api/admin/oauth-connections route from the server.

import { notFound } from 'next/navigation';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db';
import {
  agentAccessTokens,
  oauthClients,
  oauthRefreshTokens,
} from '@/db/schema';
import { requireAuth } from '@/lib/api/auth';
import { CreateTokenDialog } from '@/components/tokens/create-token-dialog';
import { TokenList } from '@/components/tokens/token-list';

import { ConnectedApps } from './_components/connected-apps';

export default async function AgentAccessPage() {
  const ctx = await requireAuth();
  if (!ctx.companyId) return notFound();

  const connectionRows = await db
    .select({
      clientId: oauthClients.clientId,
      clientName: oauthClients.clientName,
      connectedAt: sql<Date>`MIN(${oauthRefreshTokens.createdAt})`,
      lastUsedAt: sql<Date | null>`MAX(${oauthRefreshTokens.lastUsedAt})`,
    })
    .from(oauthRefreshTokens)
    .innerJoin(
      oauthClients,
      eq(oauthClients.clientId, oauthRefreshTokens.clientId),
    )
    .where(
      and(
        eq(oauthRefreshTokens.userId, ctx.userId),
        isNull(oauthRefreshTokens.revokedAt),
      ),
    )
    .groupBy(oauthClients.clientId, oauthClients.clientName);

  // Serialise Dates to ISO strings for the client component.
  const connections = connectionRows.map((r) => ({
    clientId: r.clientId,
    clientName: r.clientName,
    connectedAt: new Date(r.connectedAt).toISOString(),
    lastUsedAt: r.lastUsedAt ? new Date(r.lastUsedAt).toISOString() : null,
  }));

  // PATs: Owner-only, company-scoped. Non-owners just don't see the
  // section at all.
  const isOwner = ctx.role === 'owner';
  const patRows = isOwner
    ? await db
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
        .orderBy(desc(agentAccessTokens.createdAt))
    : [];

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Agent access</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Apps and tokens that can act on your behalf in Locus.
        </p>
      </header>

      <section className="mb-10">
        <div className="mb-3">
          <h2 className="text-lg font-semibold tracking-tight">
            Connected apps
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            MCP clients (Claude Code, Cursor, …) that you&apos;ve signed in
            via OAuth. Disconnecting revokes their access immediately.
          </p>
        </div>
        <ConnectedApps connections={connections} />
      </section>

      {isOwner && (
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Access tokens
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Long-lived bearer tokens for external AI agents. Prefer
                connecting an app via OAuth where possible.
              </p>
            </div>
            <CreateTokenDialog />
          </div>
          <TokenList tokens={patRows} />
        </section>
      )}
    </div>
  );
}
