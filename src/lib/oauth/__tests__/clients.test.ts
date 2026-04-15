// Tests for src/lib/oauth/clients.ts — Drizzle-backed OAuth DCR repo.
// Hits the live database; cleans up every row it inserts.

import { afterAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db } from '@/db';
import { oauthClients } from '@/db/schema';
import { registerClient, getClientById } from '../clients';

const inserted: string[] = [];
afterAll(async () => {
  if (inserted.length) await db.delete(oauthClients).where(inArray(oauthClients.clientId, inserted));
});

describe('oauth clients repo', () => {
  it('registerClient rejects non-localhost redirect URIs', async () => {
    await expect(
      registerClient({ clientName: 'Evil', redirectUris: ['https://evil.com/cb'] }),
    ).rejects.toThrow(/invalid_redirect_uri/);
  });

  it('registerClient persists and returns the new client_id', async () => {
    const client = await registerClient({
      clientName: 'Test Client',
      redirectUris: ['http://localhost:3000/cb'],
    });
    inserted.push(client.clientId);
    expect(client.clientId).toMatch(/^[0-9a-f-]{36}$/);
    expect(client.clientName).toBe('Test Client');

    const fetched = await getClientById(client.clientId);
    expect(fetched?.clientName).toBe('Test Client');
  });

  it('getClientById returns null for unknown', async () => {
    expect(await getClientById('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});
