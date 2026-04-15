/**
 * Backfill audit_events.brain_id by resolving target_id → documents.brain_id
 * and target_id → folders.brain_id.
 *
 * Best-effort: rows that can't be resolved (non-document/non-folder targets,
 * non-uuid target_ids, soft-deleted documents) are left with brain_id = NULL
 * and are excluded from Neurons' default view.
 *
 * Idempotent: only updates rows where brain_id IS NULL. Safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/backfill-audit-events-brain-id.ts
 */

import 'dotenv/config';
import postgres from 'postgres';

const UUID_RE = `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`;

const BACKFILL_DOCUMENTS_SQL = `
  UPDATE audit_events ae
  SET brain_id = d.brain_id
  FROM documents d
  WHERE ae.brain_id IS NULL
    AND ae.target_type = 'document'
    AND ae.target_id IS NOT NULL
    AND ae.target_id ~* '${UUID_RE}'
    AND d.id = ae.target_id::uuid
    AND d.deleted_at IS NULL
`;

const BACKFILL_FOLDERS_SQL = `
  UPDATE audit_events ae
  SET brain_id = f.brain_id
  FROM folders f
  WHERE ae.brain_id IS NULL
    AND ae.target_type = 'folder'
    AND ae.target_id IS NOT NULL
    AND ae.target_id ~* '${UUID_RE}'
    AND f.id = ae.target_id::uuid
`;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');

  const sql = postgres(url, { max: 1 });

  try {
    const [docsCount, foldersCount] = await sql.begin(async (tx) => {
      const docs = await tx.unsafe(BACKFILL_DOCUMENTS_SQL);
      const folders = await tx.unsafe(BACKFILL_FOLDERS_SQL);
      return [docs.count ?? 0, folders.count ?? 0];
    });

    console.log(`Updated ${docsCount} audit_events rows from document targets.`);
    console.log(`Updated ${foldersCount} audit_events rows from folder targets.`);
    console.log(`Total: ${docsCount + foldersCount} audit_events rows resolved to a brain.`);

    const [remaining] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM audit_events WHERE brain_id IS NULL
    `;
    console.log(
      `${remaining.n} rows still have brain_id = NULL (expected for ` +
      `authentication / administration / non-document-targeted events).`
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
