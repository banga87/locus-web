// Drizzle client for server-side database access.
//
// Uses the `postgres` driver in direct-connection mode via DATABASE_URL.
// DATABASE_URL points at Supabase's direct Postgres connection (postgres
// superuser role), which bypasses RLS by default. This client is for
// server-side operations that already scope by company_id in their
// application logic — never expose it to the browser.
//
// For RLS-enforced queries as an authenticated Supabase user, use the
// Supabase SSR client from `@/lib/supabase/server` instead.

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

// `max: 1` keeps the pool small — Next.js serverless runtimes spin up many
// isolated instances; per-process pooling provides no real benefit and
// can exhaust Supabase connection limits quickly.
const client = postgres(connectionString, { max: 1 });

export const db = drizzle(client, { schema });
export { client as pgClient };
export type Database = typeof db;
