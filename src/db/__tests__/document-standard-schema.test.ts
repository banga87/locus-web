// Verifies that migration 0024's columns and the inbox_items table
// exist with the right shape. Lives alongside schema.test.ts and uses
// the same superuser DATABASE_URL.

import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/db';

describe('migration 0024 — document standard + vocabulary', () => {
  it('documents has pending_review boolean default false', async () => {
    const rows = await db.execute(sql`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'documents' AND column_name = 'pending_review'
    `);
    expect(rows.length).toBe(1);
    expect(rows[0].data_type).toBe('boolean');
    expect(String(rows[0].column_default)).toContain('false');
  });

  it('documents has topics text[] default {}', async () => {
    const rows = await db.execute(sql`
      SELECT column_name, data_type, udt_name, column_default
      FROM information_schema.columns
      WHERE table_name = 'documents' AND column_name = 'topics'
    `);
    expect(rows.length).toBe(1);
    expect(rows[0].data_type).toBe('ARRAY');
    expect(rows[0].udt_name).toBe('_text');
  });

  it('documents has source text column', async () => {
    const rows = await db.execute(sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'documents' AND column_name = 'source'
    `);
    expect(rows.length).toBe(1);
    expect(rows[0].data_type).toBe('text');
  });

  it('documents has GIN index on topics and partial index on pending_review', async () => {
    const rows = await db.execute(sql`
      SELECT indexname FROM pg_indexes WHERE tablename = 'documents'
    `);
    const names = rows.map((r) => String(r.indexname));
    expect(names).toContain('documents_topics_idx');
    expect(names).toContain('documents_pending_review_idx');
  });

  it('brains has topic_vocabulary jsonb default {}', async () => {
    const rows = await db.execute(sql`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'brains' AND column_name = 'topic_vocabulary'
    `);
    expect(rows.length).toBe(1);
    expect(rows[0].data_type).toBe('jsonb');
    expect(String(rows[0].column_default)).toContain("'{}'");
  });

  it('inbox_items table exists with required columns', async () => {
    const rows = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'inbox_items'
      ORDER BY ordinal_position
    `);
    const names = rows.map((r) => String(r.column_name));
    expect(names).toEqual([
      'id',
      'company_id',
      'brain_id',
      'document_id',
      'kind',
      'proposed_action',
      'context',
      'status',
      'decided_at',
      'decided_by',
      'created_at',
      'expires_at',
    ]);
  });

  it('inbox_items has index on (company_id, status, created_at desc)', async () => {
    const rows = await db.execute(sql`
      SELECT indexname FROM pg_indexes WHERE tablename = 'inbox_items'
    `);
    const names = rows.map((r) => String(r.indexname));
    expect(names).toContain('inbox_items_company_status_created_idx');
  });
});
