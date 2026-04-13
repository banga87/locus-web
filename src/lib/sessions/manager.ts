// Session manager — creates sessions, persists per-turn writes from the
// chat route's `onFinish` callback, and reconstructs prior conversation
// context as `ModelMessage[]` for resuming a session.
//
// Phase 1 scope (Task 2):
//   - `create(params)` — insert a row, audit-log session.started, return.
//   - `getContext(sessionId)` — load all turns ordered by turn_number,
//     hydrate them into `ModelMessage[]` ready to splice in front of the
//     incoming request's messages.
//   - `persistTurn(params)` — append a `session_turns` row AND bump the
//     parent session's counters in one transaction. Retries once after
//     ~100ms on transient failure, then logs and gives up.
//   - `resume(sessionId)` — bump `last_active_at`. Throws if completed.
//
// Out of scope (per Phase 1 simplification §3.6):
//   - Context compaction
//   - Brain-diff-on-resume
//   - Pause/resume state machine
//   - Concurrent-message conflict detection
//   - Session search/export
//
// Failure semantics: writes here happen inside `waitUntil` from the chat
// route — the user has already seen the response by the time persistTurn
// runs. The retry-then-log policy preserves that UX even when the DB is
// briefly unavailable; durability beyond one retry is a Phase 2 concern
// (likely a replay queue).

import { eq, sql } from 'drizzle-orm';
import { convertToModelMessages, type ModelMessage, type UIMessage } from 'ai';

import { db } from '@/db';
import { sessions, sessionTurns } from '@/db/schema';
import { logEvent } from '@/lib/audit/logger';

import type { PersistTurnParams, Session } from './types';

interface CreateSessionParams {
  companyId: string;
  brainId: string;
  userId: string;
  /** Optional preview text for the sidebar list. */
  firstMessage?: string;
}

export const sessionManager = {
  /**
   * Create a fresh session in `active` state and emit a session.started
   * audit event. Returns the inserted row.
   */
  async create(params: CreateSessionParams): Promise<Session> {
    const [row] = await db
      .insert(sessions)
      .values({
        companyId: params.companyId,
        brainId: params.brainId,
        userId: params.userId,
        firstMessage: params.firstMessage ?? null,
      })
      .returning();

    // Non-blocking — `logEvent` buffers and drains on the next tick.
    logEvent({
      companyId: params.companyId,
      category: 'authentication',
      eventType: 'session.started',
      actorType: 'human',
      actorId: params.userId,
      targetType: 'session',
      targetId: row.id,
    });

    return row as Session;
  },

  /**
   * Load all turns for a session and reconstruct the LLM message array.
   *
   * Each turn contributes:
   *   - the persisted `userMessage` (a `UIMessage` from `useChat()`),
   *     converted to `ModelMessage` via `convertToModelMessages`;
   *   - the persisted `assistantMessages` (already `ModelMessage`-shaped
   *     — `ResponseMessage = AssistantModelMessage | ToolModelMessage`),
   *     spread in order.
   *
   * Returned array is suitable to prepend to the new request's messages
   * before passing to `streamText`.
   */
  async getContext(sessionId: string): Promise<ModelMessage[]> {
    const turns = await db
      .select()
      .from(sessionTurns)
      .where(eq(sessionTurns.sessionId, sessionId))
      .orderBy(sessionTurns.turnNumber);

    const messages: ModelMessage[] = [];
    for (const t of turns) {
      // The route stored the raw UIMessage from useChat; convert it back
      // to the LLM-facing shape. `convertToModelMessages` accepts an
      // array, so we wrap and unwrap.
      try {
        const converted = await convertToModelMessages([
          t.userMessage as UIMessage,
        ]);
        messages.push(...converted);
      } catch (err) {
        // Defensive: a malformed historical row shouldn't poison the
        // whole session. Log and skip the user message; we still
        // include the assistant side so the conversation isn't
        // entirely silent on resume.
        console.error(
          `[sessions] failed to convert userMessage for turn ${t.turnNumber}`,
          err,
        );
      }
      const assistant = t.assistantMessages as ModelMessage[];
      if (Array.isArray(assistant)) {
        messages.push(...assistant);
      }
    }
    return messages;
  },

  /**
   * Append a turn row + bump session counters atomically. Retries once
   * on transient transaction failure; gives up after the second attempt
   * with a logged error. NEVER throws — the chat route's `waitUntil` is
   * fire-and-forget.
   */
  async persistTurn(params: PersistTurnParams): Promise<void> {
    const inputTokens = params.usage.inputTokens ?? 0;
    const outputTokens = params.usage.outputTokens ?? 0;
    const totalTokens =
      params.usage.totalTokens ?? inputTokens + outputTokens;

    const tryOnce = async () => {
      await db.transaction(async (tx) => {
        // Derive the next turn_number inside the transaction so two
        // concurrent persistTurn calls (rare — usually serialised by
        // useChat's request lifecycle, but possible across tabs) can't
        // collide on the same number.
        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)` })
          .from(sessionTurns)
          .where(eq(sessionTurns.sessionId, params.sessionId));
        const turnNumber = Number(count) + 1;

        await tx.insert(sessionTurns).values({
          sessionId: params.sessionId,
          turnNumber,
          userMessage: params.userMessage as object,
          assistantMessages: params.assistantMessage as object,
          toolCalls: (params.toolCalls ?? []) as object,
          inputTokens,
          outputTokens,
        });

        await tx
          .update(sessions)
          .set({
            turnCount: sql`${sessions.turnCount} + 1`,
            inputTokens: sql`${sessions.inputTokens} + ${inputTokens}`,
            outputTokens: sql`${sessions.outputTokens} + ${outputTokens}`,
            totalTokens: sql`${sessions.totalTokens} + ${totalTokens}`,
            lastActiveAt: sql`now()`,
          })
          .where(eq(sessions.id, params.sessionId));
      });
    };

    try {
      await tryOnce();
    } catch (err) {
      // 100ms backoff before the single retry. Phase 1 trades durability
      // for simplicity here — see file header.
      await new Promise((r) => setTimeout(r, 100));
      try {
        await tryOnce();
      } catch (err2) {
        console.error('[sessions] persistTurn failed after retry', {
          sessionId: params.sessionId,
          firstError: err,
          secondError: err2,
        });
      }
    }
  },

  /**
   * Bump `last_active_at` for an active session. Throws if the session
   * is `completed` (cleanup cron has marked it idle) or doesn't exist.
   */
  async resume(sessionId: string): Promise<Session> {
    const [row] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId));

    if (!row) {
      throw new Error('session_not_found');
    }
    if (row.status === 'completed') {
      throw new Error('session_not_resumable');
    }

    await db
      .update(sessions)
      .set({ lastActiveAt: sql`now()` })
      .where(eq(sessions.id, sessionId));

    return row as Session;
  },
};
