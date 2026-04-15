// OAuth Dynamic Client Registration repo (RFC 7591, public clients only).
// Stores nothing secret — client_id is a UUID, no client_secret. Callers
// validate redirect_uris against the localhost rule before persisting.

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { oauthClients } from '@/db/schema';
import { isLocalhostRedirectUri } from './redirect-uri';

export type RegisteredClient = typeof oauthClients.$inferSelect;

export async function registerClient(params: {
  clientName: string;
  redirectUris: string[];
  grantTypes?: string[];
}): Promise<RegisteredClient> {
  if (!params.redirectUris.length) {
    throw new Error('invalid_redirect_uri: no URIs provided');
  }
  for (const uri of params.redirectUris) {
    if (!isLocalhostRedirectUri(uri)) {
      throw new Error(`invalid_redirect_uri: ${uri}`);
    }
  }
  const [row] = await db
    .insert(oauthClients)
    .values({
      clientName: params.clientName,
      redirectUris: params.redirectUris,
      grantTypes: params.grantTypes ?? ['authorization_code', 'refresh_token'],
    })
    .returning();
  return row;
}

export async function getClientById(clientId: string): Promise<RegisteredClient | null> {
  const [row] = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1);
  return row ?? null;
}

export async function touchClient(clientId: string): Promise<void> {
  await db
    .update(oauthClients)
    .set({ lastSeenAt: new Date() })
    .where(eq(oauthClients.clientId, clientId));
}
