// Audit logger tests.
//
// These tests exercise the buffer/drain mechanics against a writer mock
// AND exercise a small happy-path row-count delta against the live
// `audit_events` table. Cleanup is avoided by asserting on delta rather
// than absolute state (the immutability trigger blocks DELETE anyway).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  logEvent,
  flushEvents,
  __setWriter,
  __bufferSize,
  __resetForTests,
} from '../logger';
import { logDocumentAccess, logAuthEvent } from '../helpers';
import { db } from '@/db';
import { auditEvents } from '@/db/schema';
import type { AuditEvent } from '../types';

// Deterministic company id for all tests. Does NOT need to exist in the
// companies table — audit_events has no FK by design (see schema header).
const TEST_COMPANY_ID = '00000000-0000-0000-0000-0000000a0d17';

describe('audit/logger — buffer mechanics (mocked writer)', () => {
  beforeEach(() => {
    __resetForTests();
  });

  afterEach(() => {
    __resetForTests();
  });

  it('buffers the event synchronously — no DB write until the microtask fires', async () => {
    const writer = vi.fn(async () => {});
    __setWriter(writer);

    logEvent({
      companyId: TEST_COMPANY_ID,
      category: 'document_access',
      eventType: 'document.read',
      actorType: 'system',
      actorId: 'test-sync',
    });

    // Sync check: writer not called yet.
    expect(writer).not.toHaveBeenCalled();
    expect(__bufferSize()).toBe(1);

    // Drain and confirm the write lands.
    await flushEvents();
    expect(writer).toHaveBeenCalledTimes(1);
    expect(__bufferSize()).toBe(0);
  });

  it('batches multiple events from the same tick into one INSERT', async () => {
    const writer = vi.fn(async (_events: Array<{ actorId: string }>) => {});
    __setWriter(writer);

    for (let i = 0; i < 5; i++) {
      logEvent({
        companyId: TEST_COMPANY_ID,
        category: 'document_access',
        eventType: 'document.read',
        actorType: 'system',
        actorId: `test-batch-${i}`,
      });
    }

    expect(writer).not.toHaveBeenCalled();
    expect(__bufferSize()).toBe(5);

    await flushEvents();

    expect(writer).toHaveBeenCalledTimes(1);
    const rows = writer.mock.calls[0]![0];
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.actorId)).toEqual([
      'test-batch-0',
      'test-batch-1',
      'test-batch-2',
      'test-batch-3',
      'test-batch-4',
    ]);
  });

  it('never throws — a writer that rejects is swallowed and logged to console.error', async () => {
    const err = new Error('boom');
    __setWriter(async () => {
      throw err;
    });

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logEvent({
      companyId: TEST_COMPANY_ID,
      category: 'authentication',
      eventType: 'auth.failed',
      actorType: 'system',
      actorId: 'test-failure',
    });

    // Must not reject.
    await expect(flushEvents()).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
    // First call is '[audit] write failed' + the error object.
    expect(errSpy.mock.calls[0][0]).toMatch(/\[audit\] write failed/);

    errSpy.mockRestore();
  });

  it('captures _capturedAt at logEvent() call time, not at flush time', async () => {
    let captured: AuditEvent[] | null = null;
    __setWriter(async (rows) => {
      captured = rows as unknown as AuditEvent[];
    });

    const before = Date.now();
    logEvent({
      companyId: TEST_COMPANY_ID,
      category: 'document_access',
      eventType: 'document.read',
      actorType: 'system',
      actorId: 'test-timing',
    });
    const after = Date.now();

    // Wait 100ms before flushing. If the logger stamped at flush time,
    // the row's createdAt would be after `after + 100`.
    await new Promise((r) => setTimeout(r, 100));
    await flushEvents();

    expect(captured).not.toBeNull();
    const row = (captured as unknown as Array<{ createdAt: Date }>)[0];
    const ts = row.createdAt.getTime();

    // Stamped between `before` and `after`, well before the 100ms wait.
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 5); // tiny slack for timer resolution
  });

  it('helpers delegate to logEvent — logDocumentAccess produces a document_access row', async () => {
    let captured: Array<{
      category: string;
      eventType: string;
      targetType: string | null;
      details: Record<string, unknown>;
    }> | null = null;
    __setWriter(async (rows) => {
      captured = rows as typeof captured;
    });

    logDocumentAccess({
      companyId: TEST_COMPANY_ID,
      actorType: 'agent_token',
      actorId: 'test-helper-doc',
      documentId: 'doc-xyz',
      tool: 'read_document',
      section: null,
      tokensServed: 1234,
    });

    await flushEvents();

    expect(captured).toHaveLength(1);
    const row = captured![0];
    expect(row.category).toBe('document_access');
    expect(row.eventType).toBe('document.read');
    expect(row.targetType).toBe('document');
    expect(row.details).toMatchObject({
      tool: 'read_document',
      section: null,
      tokensServed: 1234,
    });
  });

  it('helpers delegate to logEvent — logAuthEvent produces an authentication row', async () => {
    let captured: Array<{
      category: string;
      eventType: string;
    }> | null = null;
    __setWriter(async (rows) => {
      captured = rows as typeof captured;
    });

    logAuthEvent({
      companyId: TEST_COMPANY_ID,
      actorType: 'human',
      actorId: 'test-helper-auth',
      eventType: 'auth.login',
      details: { method: 'password', provider: null },
    });

    await flushEvents();

    expect(captured).toHaveLength(1);
    expect(captured![0].category).toBe('authentication');
    expect(captured![0].eventType).toBe('auth.login');
  });
});

describe('audit/logger — live DB round-trip', () => {
  // This suite hits the real `audit_events` table via Drizzle. It asserts
  // on row-count delta (not absolute state) because the immutability
  // trigger prevents DELETE-based cleanup.

  beforeEach(() => {
    __resetForTests();
  });

  afterEach(() => {
    __resetForTests();
  });

  it('writes a real row via the default writer', async () => {
    // Use a unique actorId per run to avoid false positives from previous
    // runs' rows. We only count rows tagged with this id.
    const uniqueActor = `test-live-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;

    logEvent({
      companyId: TEST_COMPANY_ID,
      category: 'document_access',
      eventType: 'document.read',
      actorType: 'system',
      actorId: uniqueActor,
      details: { marker: 'live-round-trip' },
    });

    await flushEvents();

    const rows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.actorId, uniqueActor));

    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('document_access');
    expect(rows[0].eventType).toBe('document.read');
    expect(rows[0].companyId).toBe(TEST_COMPANY_ID);
  }, 15_000);
});
