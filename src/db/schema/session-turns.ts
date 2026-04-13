// One row per user message + agent response pair within a session.
//
// `userMessage` is the raw `UIMessage` the chat route received from
// `useChat()`. `assistantMessages` is the `response.messages` array from
// the AI SDK v6 `streamText` `onFinish` event — typically one assistant
// message plus any tool messages from the multi-step loop.
//
// `getContext()` reconstructs the LLM prompt by walking turns in order,
// converting each `userMessage` UI shape via `convertToModelMessages`
// and passing through `assistantMessages` (already `ModelMessage`-shaped
// — `ResponseMessage = AssistantModelMessage | ToolModelMessage`).
//
// `toolCalls` is a separate column for cheap reads from the audit /
// billing surface. Same data is also embedded in `assistantMessages`,
// but extracting it on every list-render would be wasteful.
//
// CASCADE on `session_id` FK: when a session is hard-deleted (Phase 2+
// concern), its turns go with it. Phase 1 only soft-archives via
// `status = 'completed'`, so the cascade is dormant.

import {
  pgTable,
  uuid,
  integer,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { sessions } from './sessions';

export const sessionTurns = pgTable(
  'session_turns',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),

    // 1-indexed sequential within a session. Derived in
    // `persistTurn` inside the same transaction as the insert + counter
    // bump so concurrent writes can't interleave.
    turnNumber: integer('turn_number').notNull(),

    // Raw shapes — see file header.
    userMessage: jsonb('user_message').notNull(),
    assistantMessages: jsonb('assistant_messages').notNull(),
    toolCalls: jsonb('tool_calls').notNull().default([]),

    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('session_turns_session_turn_idx').on(t.sessionId, t.turnNumber),
  ],
);
