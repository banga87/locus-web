// Audit logger — buffered, non-blocking writes to the `audit_events` table.
//
// Write strategy (see 07-audit-logging.md "Performance and Write Strategy"):
//   1. `logEvent()` stamps the event with `_capturedAt = now` and pushes
//      into a module-level buffer. It returns `void` — callers do not wait.
//   2. On the first push of a tick, a microtask is scheduled that drains
//      the buffer in a single batch `INSERT`. Subsequent `logEvent()` calls
//      in the same tick piggy-back onto the same drain, giving us one DB
//      round-trip per function invocation under normal load.
//   3. `flushEvents()` exists for `waitUntil(flushEvents())` — it returns
//      a promise that resolves after the buffer has been drained, so
//      streaming responses can keep the function alive until audit events
//      land.
//
// Failure mode: audit writes must never crash the caller. DB errors are
// caught and logged to stderr; the batch is dropped. Dropped events are a
// compliance gap but an acceptable one at this phase — Phase 1 will add
// an OpenTelemetry counter + alert.

import { db as defaultDb } from '@/db';
import { auditEvents } from '@/db/schema';
import type { AuditEvent } from './types';

// Internal writer signature. Split out so tests can swap it via
// `__setWriter()` without needing to mock the Drizzle client.
type Writer = (rows: AuditEventInsert[]) => Promise<void>;

type AuditEventInsert = {
  companyId: string;
  brainId: string | null;
  category: AuditEvent['category'];
  eventType: string;
  actorType: AuditEvent['actorType'];
  actorId: string;
  actorName: string | null;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown>;
  ipAddress: string | null;
  sessionId: string | null;
  tokenId: string | null;
  createdAt: Date;
};

const defaultWriter: Writer = async (rows) => {
  await defaultDb.insert(auditEvents).values(rows);
};

let buffer: AuditEvent[] = [];
let drainScheduled = false;
let inFlight: Promise<void> | null = null;
let writer: Writer = defaultWriter;

/**
 * Records an audit event. Non-blocking: the write happens on the next
 * microtask. Never throws — DB failures are logged to stderr and the
 * batch is dropped.
 */
export function logEvent(event: AuditEvent): void {
  buffer.push({
    ...event,
    _capturedAt: event._capturedAt ?? new Date(),
  });

  if (!drainScheduled) {
    drainScheduled = true;
    queueMicrotask(() => {
      inFlight = drainBuffer();
    });
  }
}

/**
 * Drains any buffered events. Intended for `waitUntil(flushEvents())`
 * at the tail of a streaming response handler, or for deterministic
 * flushing in tests.
 */
export async function flushEvents(): Promise<void> {
  // If a drain is already scheduled/in-flight, wait for it first — then
  // drain anything that accumulated after it started.
  if (inFlight) {
    await inFlight;
  }
  await drainBuffer();
}

async function drainBuffer(): Promise<void> {
  drainScheduled = false;

  if (buffer.length === 0) {
    return;
  }

  const batch = buffer;
  buffer = [];

  const rows: AuditEventInsert[] = batch.map((e) => ({
    companyId: e.companyId,
    brainId: e.brainId ?? null,
    category: e.category,
    eventType: e.eventType,
    actorType: e.actorType,
    actorId: e.actorId,
    actorName: e.actorName ?? null,
    targetType: e.targetType ?? null,
    targetId: e.targetId ?? null,
    details: e.details ?? {},
    ipAddress: e.ipAddress ?? null,
    sessionId: e.sessionId ?? null,
    tokenId: e.tokenId ?? null,
    // `_capturedAt` is guaranteed to be set by `logEvent()`.
    createdAt: e._capturedAt as Date,
  }));

  try {
    await writer(rows);
  } catch (error) {
    console.error('[audit] write failed', error);
    console.error('[audit] dropped events', JSON.stringify(rows));
  }
}

// --- Test hooks -----------------------------------------------------------
// Not part of the public API. Exported for use from `__tests__/` only.

/** Replace the internal writer. Pass `null` to restore the default. */
export function __setWriter(fn: Writer | null): void {
  writer = fn ?? defaultWriter;
}

/** Read the current buffer length. */
export function __bufferSize(): number {
  return buffer.length;
}

/** Reset module state between tests. */
export function __resetForTests(): void {
  buffer = [];
  drainScheduled = false;
  inFlight = null;
  writer = defaultWriter;
}
