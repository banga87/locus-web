// Session manager unit tests.
//
// We mock `@/db` and `@/lib/audit/logger` at the module level so the
// manager exercises its real logic against in-memory fakes — no live
// Postgres required. The DB fake supports the narrow surface the
// manager actually uses.
//
// What we cover (per Phase 1 plan §Step 4):
//   1. createSession() inserts a session with status 'active' and
//      logs a `session.started` audit event.
//   2. persistTurn() inserts a session_turns row AND atomically bumps
//      the parent session's turnCount + token counters + lastActiveAt.
//   3. resume() throws if the session is `completed`; succeeds if
//      `active` (and bumps lastActiveAt).
//   4. persistTurn() retries once after a transient failure, gives
//      up after the second.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Module mocks (must be hoisted above imports that consume them) -----

vi.mock('@/lib/audit/logger', () => ({
  logEvent: vi.fn(),
  flushEvents: vi.fn(async () => {}),
}));

vi.mock('@/db', () => {
  let current: unknown = {
    insert: () => {
      throw new Error('test db not initialised');
    },
  };
  return {
    get db() {
      return current;
    },
    __setDbFake: (fake: unknown) => {
      current = fake;
    },
  };
});

import { sessionManager } from '../manager';
import { logEvent } from '@/lib/audit/logger';
import * as dbModule from '@/db';
const setDbFake = (dbModule as unknown as { __setDbFake: (fake: unknown) => void })
  .__setDbFake;

// --- DB fake ------------------------------------------------------------
//
// The fake recognises tables by reference (the actual Drizzle table
// objects, imported from the schema). Predicates from `eq()` are
// returned as opaque markers tagged with the column the manager touched.
//
// Drizzle's `sql\`...\`` template returns a marker object that the fake
// matches against the small set of patterns the manager emits:
//   - `${col} + N` increments
//   - `${col} + ${value}` increments where the value is a number param
//   - `now()` for timestamps
//   - `count(*)` (only used inside select() — handled there)

import { sessions, sessionTurns } from '@/db/schema';

interface SessionRow {
  id: string;
  companyId: string;
  brainId: string;
  userId: string;
  status: 'active' | 'completed';
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  firstMessage: string | null;
  createdAt: Date;
  lastActiveAt: Date;
}
interface TurnRow {
  id: string;
  sessionId: string;
  turnNumber: number;
  userMessage: unknown;
  assistantMessages: unknown;
  toolCalls: unknown;
  inputTokens: number;
  outputTokens: number;
  createdAt: Date;
}
interface FakeState {
  sessions: Map<string, SessionRow>;
  turns: TurnRow[];
}

interface SqlFragment {
  __sql: true;
  text: string;
  values: unknown[];
}
interface EqMarker {
  __eq: true;
  table: 'sessions' | 'session_turns';
  column: 'id' | 'session_id';
  value: string;
}

function isSqlFragment(v: unknown): v is SqlFragment {
  return !!v && typeof v === 'object' && (v as SqlFragment).__sql === true;
}
function isEqMarker(v: unknown): v is EqMarker {
  return !!v && typeof v === 'object' && (v as EqMarker).__eq === true;
}

function tableNameOf(table: unknown): 'sessions' | 'session_turns' | 'unknown' {
  if (table === sessions) return 'sessions';
  if (table === sessionTurns) return 'session_turns';
  return 'unknown';
}

function applySqlIncrementOrSet(
  current: number,
  fragment: SqlFragment,
): number {
  // Two recognised patterns:
  //   "? + ?"    where values = [columnRef, increment]
  //   "? + N"    where values = [columnRef] and N is in text
  // The columnRef is a Drizzle column object — we ignore it; the column
  // is implied by which row+key we're updating.
  const valueParts = fragment.values;
  if (valueParts.length >= 2) {
    const inc = valueParts[1];
    if (typeof inc === 'number') return current + inc;
  }
  // Fallback: try to extract a literal number from text (rare path).
  const m = fragment.text.match(/\+\s*(\d+)/);
  if (m) return current + Number(m[1]);
  return current;
}

function makeDbFake(state: FakeState, opts?: { failTransactionTimes?: number }) {
  let failsRemaining = opts?.failTransactionTimes ?? 0;

  function selectChain(columns?: unknown) {
    return {
      from(table: unknown) {
        const tableName = tableNameOf(table);
        return {
          where(predicate: unknown) {
            const isCount =
              !!columns &&
              typeof columns === 'object' &&
              'count' in (columns as Record<string, unknown>);

            const filtered = filterRows(tableName, predicate);

            if (isCount) {
              const result = [{ count: filtered.length }];
              return makeAwaitable(result, () => result);
            }

            // Allow chaining .orderBy()
            return {
              orderBy: async (..._cols: unknown[]) => {
                if (tableName === 'session_turns') {
                  return [...(filtered as TurnRow[])].sort(
                    (a, b) => a.turnNumber - b.turnNumber,
                  );
                }
                return filtered;
              },
              then: (resolve: (rows: unknown[]) => void) => resolve(filtered),
              catch: () => Promise.resolve(filtered),
            };
          },
        };
      },
    };
  }

  function filterRows(
    tableName: 'sessions' | 'session_turns' | 'unknown',
    predicate: unknown,
  ): unknown[] {
    if (!isEqMarker(predicate)) {
      if (tableName === 'sessions') return Array.from(state.sessions.values());
      if (tableName === 'session_turns') return state.turns;
      return [];
    }
    if (tableName === 'sessions') {
      // Only `eq(sessions.id, X)` is used.
      const row = state.sessions.get(predicate.value);
      return row ? [row] : [];
    }
    if (tableName === 'session_turns') {
      // Only `eq(sessionTurns.sessionId, X)` is used.
      return state.turns.filter((t) => t.sessionId === predicate.value);
    }
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fake: any = {
    insert(table: unknown) {
      const tableName = tableNameOf(table);
      return {
        values(values: Record<string, unknown>) {
          if (tableName === 'sessions') {
            const id = (values.id as string | undefined) ?? cryptoRandomId();
            const now = new Date();
            const row: SessionRow = {
              id,
              companyId: values.companyId as string,
              brainId: values.brainId as string,
              userId: values.userId as string,
              status:
                (values.status as 'active' | 'completed' | undefined) ??
                'active',
              turnCount: 0,
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              firstMessage:
                (values.firstMessage as string | null | undefined) ?? null,
              createdAt: now,
              lastActiveAt: now,
            };
            state.sessions.set(id, row);
            return {
              returning: async () => [row],
              then: (resolve: (rows: unknown[]) => void) => resolve([row]),
            };
          }
          if (tableName === 'session_turns') {
            const id = cryptoRandomId();
            const row: TurnRow = {
              id,
              sessionId: values.sessionId as string,
              turnNumber: values.turnNumber as number,
              userMessage: values.userMessage,
              assistantMessages: values.assistantMessages,
              toolCalls: values.toolCalls,
              inputTokens: (values.inputTokens as number) ?? 0,
              outputTokens: (values.outputTokens as number) ?? 0,
              createdAt: new Date(),
            };
            state.turns.push(row);
            return {
              returning: async () => [row],
              then: (resolve: (rows: unknown[]) => void) => resolve([row]),
            };
          }
          throw new Error(`fake.insert: unknown table ${tableName}`);
        },
      };
    },

    transaction: async <T>(cb: (tx: typeof fake) => Promise<T>): Promise<T> => {
      if (failsRemaining > 0) {
        failsRemaining -= 1;
        throw new Error('simulated transient db error');
      }
      return cb(fake);
    },

    select: selectChain,

    update(table: unknown) {
      const tableName = tableNameOf(table);
      return {
        set(values: Record<string, unknown>) {
          return {
            where: async (predicate: unknown) => {
              if (tableName !== 'sessions') {
                throw new Error(
                  `fake.update: only sessions supported, got ${tableName}`,
                );
              }
              if (!isEqMarker(predicate)) {
                throw new Error('fake.update: missing eq predicate');
              }
              const row = state.sessions.get(predicate.value);
              if (!row) return;
              const rowAny = row as unknown as Record<string, unknown>;
              for (const [k, v] of Object.entries(values)) {
                if (typeof v === 'number') {
                  rowAny[k] = v;
                } else if (v instanceof Date) {
                  rowAny[k] = v;
                } else if (typeof v === 'string') {
                  rowAny[k] = v;
                } else if (isSqlFragment(v)) {
                  if (/now\(\)/i.test(v.text)) {
                    rowAny[k] = new Date();
                  } else {
                    const before = rowAny[k] as number;
                    rowAny[k] = applySqlIncrementOrSet(before ?? 0, v);
                  }
                }
              }
            },
          };
        },
      };
    },
  };

  return fake;
}

function makeAwaitable<T>(value: T, lazy: () => T) {
  return {
    then: (resolve: (v: T) => void) => resolve(lazy ? lazy() : value),
    catch: () => Promise.resolve(value),
  };
}

function cryptoRandomId(): string {
  return `00000000-0000-0000-0000-${(idCounter++).toString().padStart(12, '0')}`;
}
let idCounter = 1;

// --- drizzle-orm mocks ---------------------------------------------------

vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual<typeof import('drizzle-orm')>(
    'drizzle-orm',
  );
  return {
    ...actual,
    eq: (column: unknown, value: unknown): EqMarker => {
      // Identify the column by reference equality with the schema's
      // exported column objects. Tests only `eq` on session id or
      // sessionTurns.sessionId, so a small lookup suffices.
      // We delay the lookup until we know what columns exist.
      const ref = column as { name?: string };
      let table: 'sessions' | 'session_turns' = 'sessions';
      let col: 'id' | 'session_id' = 'id';

      // Walk both schemas.
      if (column === sessions.id) {
        table = 'sessions';
        col = 'id';
      } else if (column === sessionTurns.sessionId) {
        table = 'session_turns';
        col = 'session_id';
      } else if (ref?.name === 'session_id') {
        table = 'session_turns';
        col = 'session_id';
      } else {
        table = 'sessions';
        col = 'id';
      }

      return { __eq: true, table, column: col, value: value as string };
    },
    sql: (strings: TemplateStringsArray, ...values: unknown[]): SqlFragment => {
      const text = strings.reduce(
        (acc, s, i) => acc + s + (i < values.length ? '?' : ''),
        '',
      );
      return { __sql: true, text, values };
    },
  };
});

// --- Tests --------------------------------------------------------------

const COMPANY = '11111111-1111-1111-1111-111111111111';
const BRAIN = '22222222-2222-2222-2222-222222222222';
const USER = '33333333-3333-3333-3333-333333333333';

beforeEach(() => {
  vi.useRealTimers();
  idCounter = 1;
  vi.mocked(logEvent).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sessionManager.create', () => {
  it('inserts a session with status active and returns it', async () => {
    const state: FakeState = { sessions: new Map(), turns: [] };
    setDbFake(makeDbFake(state));

    const session = await sessionManager.create({
      companyId: COMPANY,
      brainId: BRAIN,
      userId: USER,
    });

    expect(session).toBeDefined();
    expect(session.companyId).toBe(COMPANY);
    expect(session.brainId).toBe(BRAIN);
    expect(session.userId).toBe(USER);
    expect(session.status).toBe('active');
    expect(state.sessions.size).toBe(1);
  });

  it('logs a session.started audit event with the new session id as targetId', async () => {
    const state: FakeState = { sessions: new Map(), turns: [] };
    setDbFake(makeDbFake(state));

    const session = await sessionManager.create({
      companyId: COMPANY,
      brainId: BRAIN,
      userId: USER,
    });

    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'authentication',
        eventType: 'session.started',
        actorType: 'human',
        actorId: USER,
        companyId: COMPANY,
        targetType: 'session',
        targetId: session.id,
      }),
    );
  });

  it('persists firstMessage when supplied', async () => {
    const state: FakeState = { sessions: new Map(), turns: [] };
    setDbFake(makeDbFake(state));

    const session = await sessionManager.create({
      companyId: COMPANY,
      brainId: BRAIN,
      userId: USER,
      firstMessage: 'Tell me about the brain.',
    });

    const stored = state.sessions.get(session.id);
    expect(stored?.firstMessage).toBe('Tell me about the brain.');
  });
});

describe('sessionManager.persistTurn', () => {
  it('inserts a session_turns row and increments parent counters atomically', async () => {
    const state: FakeState = { sessions: new Map(), turns: [] };
    setDbFake(makeDbFake(state));

    const session = await sessionManager.create({
      companyId: COMPANY,
      brainId: BRAIN,
      userId: USER,
    });

    await sessionManager.persistTurn({
      sessionId: session.id,
      userMessage: { role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      assistantMessage: [
        { role: 'assistant', content: [{ type: 'text', text: 'hi back' }] },
      ],
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });

    expect(state.turns).toHaveLength(1);
    expect(state.turns[0].sessionId).toBe(session.id);
    expect(state.turns[0].turnNumber).toBe(1);
    expect(state.turns[0].inputTokens).toBe(10);
    expect(state.turns[0].outputTokens).toBe(5);

    const updated = state.sessions.get(session.id)!;
    expect(updated.turnCount).toBe(1);
    expect(updated.inputTokens).toBe(10);
    expect(updated.outputTokens).toBe(5);
    expect(updated.totalTokens).toBe(15);
  });

  it('numbers turns sequentially within a session', async () => {
    const state: FakeState = { sessions: new Map(), turns: [] };
    setDbFake(makeDbFake(state));

    const s = await sessionManager.create({
      companyId: COMPANY,
      brainId: BRAIN,
      userId: USER,
    });

    for (let i = 0; i < 3; i++) {
      await sessionManager.persistTurn({
        sessionId: s.id,
        userMessage: { idx: i },
        assistantMessage: [{ idx: i }],
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      });
    }

    expect(state.turns.map((t) => t.turnNumber)).toEqual([1, 2, 3]);
    expect(state.sessions.get(s.id)!.turnCount).toBe(3);
  });

  it('retries once after a transient transaction failure', async () => {
    const state: FakeState = { sessions: new Map(), turns: [] };
    setDbFake(makeDbFake(state, { failTransactionTimes: 1 }));

    const session = await sessionManager.create({
      companyId: COMPANY,
      brainId: BRAIN,
      userId: USER,
    });

    await sessionManager.persistTurn({
      sessionId: session.id,
      userMessage: { role: 'user' },
      assistantMessage: [{ role: 'assistant' }],
      toolCalls: [],
      usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
    });

    expect(state.turns).toHaveLength(1);
    expect(state.sessions.get(session.id)!.turnCount).toBe(1);
  });

  it('logs and gives up after the second failure — does not throw to caller', async () => {
    const state: FakeState = { sessions: new Map(), turns: [] };
    setDbFake(makeDbFake(state, { failTransactionTimes: 2 }));

    const session = await sessionManager.create({
      companyId: COMPANY,
      brainId: BRAIN,
      userId: USER,
    });

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      sessionManager.persistTurn({
        sessionId: session.id,
        userMessage: {},
        assistantMessage: [{}],
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      }),
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
    expect(errSpy.mock.calls[0][0]).toMatch(/\[sessions\]/);
    expect(state.turns).toHaveLength(0);
    expect(state.sessions.get(session.id)!.turnCount).toBe(0);

    errSpy.mockRestore();
  });
});

describe('sessionManager.resume', () => {
  it('bumps lastActiveAt for an active session', async () => {
    const state: FakeState = { sessions: new Map(), turns: [] };
    setDbFake(makeDbFake(state));

    const session = await sessionManager.create({
      companyId: COMPANY,
      brainId: BRAIN,
      userId: USER,
    });

    const original = state.sessions.get(session.id)!.lastActiveAt;
    await new Promise((r) => setTimeout(r, 10));

    const resumed = await sessionManager.resume(session.id);
    expect(resumed.id).toBe(session.id);
    const after = state.sessions.get(session.id)!.lastActiveAt;
    expect(after.getTime()).toBeGreaterThan(original.getTime());
  });

  it('throws session_not_resumable if status is completed', async () => {
    const state: FakeState = { sessions: new Map(), turns: [] };
    setDbFake(makeDbFake(state));

    const session = await sessionManager.create({
      companyId: COMPANY,
      brainId: BRAIN,
      userId: USER,
    });
    state.sessions.get(session.id)!.status = 'completed';

    await expect(sessionManager.resume(session.id)).rejects.toThrow(
      /session_not_resumable/,
    );
  });

  it('throws session_not_found for an unknown id', async () => {
    const state: FakeState = { sessions: new Map(), turns: [] };
    setDbFake(makeDbFake(state));

    await expect(
      sessionManager.resume('99999999-9999-9999-9999-999999999999'),
    ).rejects.toThrow(/session_not_found/);
  });
});

describe('sessionManager.getContext', () => {
  it('returns an empty array for a session with no turns', async () => {
    const state: FakeState = { sessions: new Map(), turns: [] };
    setDbFake(makeDbFake(state));

    const session = await sessionManager.create({
      companyId: COMPANY,
      brainId: BRAIN,
      userId: USER,
    });

    const ctx = await sessionManager.getContext(session.id);
    expect(ctx).toEqual([]);
  });

  it('reconstructs prior turns into a ModelMessage array (user + assistant in order)', async () => {
    const state: FakeState = { sessions: new Map(), turns: [] };
    setDbFake(makeDbFake(state));

    const session = await sessionManager.create({
      companyId: COMPANY,
      brainId: BRAIN,
      userId: USER,
    });

    // Two turns. The userMessage shape is what `useChat()` sends — a
    // UIMessage with parts. The assistantMessages shape is v6
    // ResponseMessage (assistant + optional tool messages).
    await sessionManager.persistTurn({
      sessionId: session.id,
      userMessage: {
        id: 'm1',
        role: 'user',
        parts: [{ type: 'text', text: 'first user turn' }],
      },
      assistantMessage: [
        { role: 'assistant', content: [{ type: 'text', text: 'first reply' }] },
      ],
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
    await sessionManager.persistTurn({
      sessionId: session.id,
      userMessage: {
        id: 'm2',
        role: 'user',
        parts: [{ type: 'text', text: 'second user turn' }],
      },
      assistantMessage: [
        { role: 'assistant', content: [{ type: 'text', text: 'second reply' }] },
      ],
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });

    const ctx = await sessionManager.getContext(session.id);

    // Two user messages + two assistant messages, in order.
    expect(ctx).toHaveLength(4);
    expect((ctx[0] as { role: string }).role).toBe('user');
    expect((ctx[1] as { role: string }).role).toBe('assistant');
    expect((ctx[2] as { role: string }).role).toBe('user');
    expect((ctx[3] as { role: string }).role).toBe('assistant');
  });
});
