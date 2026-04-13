// Public types for the session manager. Mirror the Drizzle schema in
// `src/db/schema/sessions.ts` + `session-turns.ts`, with the JSON columns
// surfaced as `unknown` (callers narrow when they use them).

import type { UIMessage } from 'ai';

export type SessionStatus = 'active' | 'completed';

export interface Session {
  id: string;
  companyId: string;
  brainId: string;
  userId: string;
  status: SessionStatus;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  firstMessage: string | null;
  createdAt: Date;
  lastActiveAt: Date;
}

/**
 * One persisted user→agent exchange. `userMessage` is the raw `UIMessage`
 * from `useChat()`. `assistantMessages` is the v6 `response.messages`
 * array — an `AssistantModelMessage` plus any `ToolModelMessage`s the
 * multi-step loop generated.
 */
export interface SessionTurn {
  id: string;
  sessionId: string;
  turnNumber: number;
  userMessage: unknown;
  assistantMessages: unknown[];
  toolCalls: PersistedToolCall[];
  inputTokens: number;
  outputTokens: number;
  createdAt: Date;
}

/**
 * Minimal denormalised tool-call summary stored per turn. The full
 * detail also lives inside `assistantMessages`; this column exists so
 * audit/billing surfaces can read tool invocations without parsing the
 * full assistant message structure.
 */
export interface PersistedToolCall {
  toolName: string;
  args: unknown;
  result?: unknown;
}

/**
 * Parameters accepted by `sessionManager.persistTurn`. The shape mirrors
 * what the chat route's `onFinish` callback already passes today.
 *
 * `usage` follows AI SDK v6's `LanguageModelUsage` (`inputTokens` /
 * `outputTokens` / `totalTokens`), not the v4 `promptTokens` /
 * `completionTokens` shape used in the original plan sample.
 */
export interface PersistTurnParams {
  sessionId: string;
  userMessage: UIMessage | unknown;
  /** v6 `response.messages` from the streamText `onFinish` event. */
  assistantMessage: unknown[];
  toolCalls: PersistedToolCall[] | unknown[];
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}
