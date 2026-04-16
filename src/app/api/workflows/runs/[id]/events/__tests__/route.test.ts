/**
 * @vitest-environment node
 */
// Integration test for GET /api/workflows/runs/[id]/events.
//
// Focused scope: Fix 2 from review — ?after param validation. A
// non-numeric ?after previously coerced to NaN via Number() and was
// silently accepted. `gt(sequence, NaN)` returns zero rows, so the UI
// saw `{events: []}` without any error signal. The fix rejects
// non-integer input with a 400.
//
// Also spot-checks the happy path so the regex guard doesn't regress
// the valid case.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { db } from '@/db';
import { companies } from '@/db/schema/companies';
import { brains } from '@/db/schema/brains';
import { folders } from '@/db/schema/folders';
import { users } from '@/db/schema/users';
import { documents } from '@/db/schema/documents';
import { workflowRuns } from '@/db/schema/workflow-runs';
import { workflowRunEvents } from '@/db/schema/workflow-run-events';

// --- Module mocks -------------------------------------------------------

const mockAuth: {
  userId: string;
  companyId: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  email: string;
  fullName: string | null;
} = {
  userId: '',
  companyId: '',
  role: 'owner',
  email: 'events-test@local',
  fullName: 'Events Test User',
};

const mockRequireAuth = vi.fn(async () => ({ ...mockAuth }));

vi.mock('@/lib/api/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/auth')>(
    '@/lib/api/auth',
  );
  return {
    ...actual,
    requireAuth: () => mockRequireAuth(),
  };
});

import { GET } from '@/app/api/workflows/runs/[id]/events/route';

// --- Fixtures -----------------------------------------------------------

const suffix = `events-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
let companyId: string;
let brainId: string;
let userId: string;
let workflowDocId: string;
let runId: string;

beforeAll(async () => {
  const [company] = await db
    .insert(companies)
    .values({ name: `Events Co ${suffix}`, slug: `ev-${suffix}` })
    .returning({ id: companies.id });
  companyId = company!.id;

  const mintedUserId = randomUUID();
  await db.insert(users).values({
    id: mintedUserId,
    email: `${suffix}@events.local`,
    fullName: `Events Tester ${suffix}`,
    role: 'owner',
    status: 'active',
    companyId,
  });
  userId = mintedUserId;

  const [brain] = await db
    .insert(brains)
    .values({ companyId, name: 'Events Brain', slug: `ev-brain-${suffix}` })
    .returning({ id: brains.id });
  brainId = brain!.id;

  const [folder] = await db
    .insert(folders)
    .values({
      companyId,
      brainId,
      slug: `ev-folder-${suffix}`,
      name: 'Events',
    })
    .returning({ id: folders.id });

  const [wfDoc] = await db
    .insert(documents)
    .values({
      companyId,
      brainId,
      folderId: folder!.id,
      title: 'Events WF',
      slug: `events-wf-${suffix}`,
      path: `ev-folder-${suffix}/events-wf-${suffix}`,
      content: '---\ntype: workflow\noutput: document\nrequires_mcps: []\n---\nTest.',
      type: 'workflow',
      metadata: {
        type: 'workflow',
        output: 'document',
        requires_mcps: [],
        output_category: null,
        schedule: null,
      },
      version: 1,
    })
    .returning({ id: documents.id });
  workflowDocId = wfDoc!.id;

  const [run] = await db
    .insert(workflowRuns)
    .values({
      workflowDocumentId: workflowDocId,
      triggeredBy: userId,
      status: 'running',
    })
    .returning({ id: workflowRuns.id });
  runId = run!.id;

  // Seed a couple of events so the happy-path test has data.
  await db.insert(workflowRunEvents).values([
    { runId, sequence: 0, eventType: 'turn_start', payload: {} },
    { runId, sequence: 1, eventType: 'llm_delta', payload: { delta: 'hello' } },
    { runId, sequence: 2, eventType: 'turn_complete', payload: {} },
  ]);

  mockAuth.userId = userId;
  mockAuth.companyId = companyId;
}, 60_000);

afterAll(async () => {
  // workflow_run_events ON DELETE CASCADE from workflow_runs.
  await db
    .delete(workflowRuns)
    .where(eq(workflowRuns.workflowDocumentId, workflowDocId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(brains).where(eq(brains.id, brainId));
  await db.delete(companies).where(eq(companies.id, companyId));
}, 60_000);

// --- Helpers ------------------------------------------------------------

function buildRequest(after?: string): Request {
  const url = new URL('http://localhost/api/workflows/runs/x/events');
  if (after !== undefined) url.searchParams.set('after', after);
  return new Request(url, { method: 'GET' });
}

// --- Tests --------------------------------------------------------------

describe('GET /api/workflows/runs/[id]/events', () => {
  it('returns 400 with invalid_param when ?after is non-numeric', async () => {
    const res = await GET(buildRequest('abc'), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_param');
  });

  it('returns 400 when ?after is a negative number', async () => {
    // `Number('-1')` returns -1 cleanly; the regex /^\d+$/ rejects the
    // leading minus. Proves the regex guard catches cases parseInt + isNaN
    // would miss.
    const res = await GET(buildRequest('-1'), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(400);
  });

  it('returns all events when no ?after is given (happy path)', async () => {
    const res = await GET(buildRequest(), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: unknown[] };
    expect(body.events).toHaveLength(3);
  });

  it('returns only events with sequence > after when ?after=1', async () => {
    const res = await GET(buildRequest('1'), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<{ sequence: number }> };
    expect(body.events).toHaveLength(1);
    expect(body.events[0]!.sequence).toBe(2);
  });
});
