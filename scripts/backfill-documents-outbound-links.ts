/**
 * Backfill documents.metadata.outbound_links for existing documents.
 *
 * For each document, parse its content and write the parsed outbound
 * links into metadata.outbound_links. Preserves all other metadata fields.
 *
 * Idempotent: re-running overwrites outbound_links with the current
 * parse result. Safe if slug parser semantics don't change.
 *
 * Usage:
 *   npx tsx scripts/backfill-documents-outbound-links.ts
 */

import 'dotenv/config';
import postgres from 'postgres';
import { parseOutboundLinks } from '../src/lib/brain-pulse/markdown-links';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');

  const sql = postgres(url, { max: 1 });

  try {
    const docs = await sql<
      { id: string; content: string | null; metadata: Record<string, unknown> | null }[]
    >`
      SELECT id, content, metadata FROM documents
      WHERE deleted_at IS NULL
    `;

    console.log(`Processing ${docs.length} documents...`);

    let updated = 0;
    for (const doc of docs) {
      const links = parseOutboundLinks(doc.content ?? '');
      const existing = (doc.metadata ?? {}) as Record<string, unknown>;
      const nextMetadata = { ...existing, outbound_links: links };

      // Cast via JSON.parse(JSON.stringify(...)) to satisfy postgres.js's
      // JSONValue constraint — OutboundLink objects are structurally JSON
      // but TS doesn't know that at the call site.
      const jsonMetadata = JSON.parse(JSON.stringify(nextMetadata));
      await sql`
        UPDATE documents
        SET metadata = ${sql.json(jsonMetadata)}
        WHERE id = ${doc.id}
      `;
      updated++;
    }

    console.log(`Backfilled outbound_links on ${updated} documents.`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
