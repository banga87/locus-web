// Session manager — Task 2 will replace this stub with real
// per-turn writes to `session_turns` and a context loader that prepends
// prior messages to the LLM message array.
//
// Phase 1 ships with the chat route already calling `getContext()` +
// `persistTurn()` so Task 2 is a one-module swap with no route changes.
// Until then:
//   - `getContext()` returns [] — every chat turn starts fresh.
//   - `persistTurn()` is a no-op.
//
// Importers MUST go through this module so the seam stays single-file.

import type { ModelMessage } from 'ai';

export interface PersistTurnInput {
  sessionId: string;
  userMessage: unknown;
  assistantMessage: unknown;
  toolCalls: unknown;
  usage: unknown;
}

export const sessionManager = {
  /**
   * Load the prior conversation history for a session as `ModelMessage`s
   * ready to splice in front of the new user message.
   *
   * Stub: returns []. Task 2 will read from `session_turns`.
   */
  async getContext(_sessionId: string): Promise<ModelMessage[]> {
    return [];
  },

  /**
   * Append a turn to `session_turns`. Called from the route's `onFinish`
   * callback inside `waitUntil` so the write doesn't block streaming.
   *
   * Stub: no-op. Task 2 will insert the user + assistant messages, the
   * tool calls + results, and the usage row.
   */
  async persistTurn(_input: PersistTurnInput): Promise<void> {
    return;
  },
};
