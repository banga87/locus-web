// Hydrate persisted session turns into AI SDK v6 `UIMessage`s for SSR.
//
// Storage shape (see `src/lib/sessions/manager.ts:persistTurn`):
//   - `userMessage`         — the original `UIMessage` from useChat() — used as-is.
//   - `assistantMessages`   — `ResponseMessage[]`
//                             (`AssistantModelMessage | ToolModelMessage`)
//                             — model-side shape, NOT a UIMessage.
//
// AI SDK v6 only ships `convertToModelMessages` (UI → model). There is
// no first-party converter the other direction. So for hydration we
// walk the model-side content array and rebuild the minimum UIMessage
// fields the chat UI consumes:
//
//   - text content → TextUIPart
//   - tool-call content → DynamicToolUIPart (state: 'output-available'
//                          if a matching tool-result message is present,
//                          else 'input-available')
//
// The assistant message's id is synthetic — the original streaming id
// was discarded — but useChat doesn't care about uniqueness across
// reload, only across the active session.
//
// We don't try to reconstruct file/source/reasoning parts: Phase 1's
// chat doesn't surface them, and they aren't present in the persisted
// payload from the `streamText` onFinish event in our setup.

import type { UIMessage } from 'ai';

interface SessionTurnRow {
  turnNumber: number;
  userMessage: unknown;
  assistantMessages: unknown;
}

export function hydrateUIMessages(turns: SessionTurnRow[]): UIMessage[] {
  const out: UIMessage[] = [];
  for (const t of turns) {
    const userMsg = sanitizeUserMessage(t.userMessage, t.turnNumber);
    if (userMsg) out.push(userMsg);

    const assistantMsgs = buildAssistantMessages(
      t.assistantMessages,
      t.turnNumber,
    );
    out.push(...assistantMsgs);
  }
  return out;
}

/**
 * The persisted user message is the raw UIMessage from useChat — we
 * trust the structure but defend against legacy rows that might be
 * missing fields after a schema change.
 */
function sanitizeUserMessage(
  raw: unknown,
  turnNumber: number,
): UIMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const role = obj.role;
  if (role !== 'user') return null;
  if (!Array.isArray(obj.parts)) return null;
  const id =
    typeof obj.id === 'string' && obj.id.length > 0
      ? obj.id
      : `turn-${turnNumber}-user`;
  return { id, role: 'user', parts: obj.parts as UIMessage['parts'] };
}

/**
 * Walk the persisted `ResponseMessage[]` and emit one assistant
 * UIMessage per assistant entry, with text + tool parts inlined. Tool
 * results from following ToolModelMessages are spliced back into the
 * matching assistant message's tool parts so the chat UI can show
 * them as 'output-available' instead of 'input-available'.
 */
function buildAssistantMessages(
  raw: unknown,
  turnNumber: number,
): UIMessage[] {
  if (!Array.isArray(raw)) return [];

  // First pass: collect tool results keyed by toolCallId so we can
  // attach them to the corresponding assistant tool-call parts.
  const toolResults = new Map<string, unknown>();
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const msg = m as Record<string, unknown>;
    if (msg.role !== 'tool') continue;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (!c || typeof c !== 'object') continue;
      const part = c as Record<string, unknown>;
      // v6 ToolResult content shape: { type: 'tool-result', toolCallId, output: ... }.
      // Some payloads also use 'result' as the field name — accept both.
      if (part.type !== 'tool-result') continue;
      const id = part.toolCallId;
      if (typeof id !== 'string') continue;
      toolResults.set(id, part.output ?? part.result);
    }
  }

  const out: UIMessage[] = [];
  let idx = 0;
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const msg = m as Record<string, unknown>;
    if (msg.role !== 'assistant') continue;

    const parts: UIMessage['parts'] = [];
    const content = msg.content;

    if (typeof content === 'string') {
      if (content.length > 0) {
        parts.push({ type: 'text', text: content });
      }
    } else if (Array.isArray(content)) {
      for (const c of content) {
        if (!c || typeof c !== 'object') continue;
        const part = c as Record<string, unknown>;
        switch (part.type) {
          case 'text': {
            const text = part.text;
            if (typeof text === 'string' && text.length > 0) {
              parts.push({ type: 'text', text });
            }
            break;
          }
          case 'tool-call': {
            const toolCallId =
              typeof part.toolCallId === 'string' ? part.toolCallId : '';
            const toolName =
              typeof part.toolName === 'string' ? part.toolName : 'unknown';
            const input = part.input ?? part.args;
            const output = toolResults.get(toolCallId);
            // We always emit `dynamic-tool` here because every Locus
            // tool is registered via `dynamicTool()` (see
            // `src/lib/agent/tool-bridge.ts`). The chat UI handles
            // both `tool-<name>` and `dynamic-tool` parts identically.
            if (output !== undefined) {
              parts.push({
                type: 'dynamic-tool',
                toolName,
                toolCallId,
                state: 'output-available',
                input,
                output,
              } as unknown as UIMessage['parts'][number]);
            } else {
              parts.push({
                type: 'dynamic-tool',
                toolName,
                toolCallId,
                state: 'input-available',
                input,
              } as unknown as UIMessage['parts'][number]);
            }
            break;
          }
          // reasoning / file / source / etc. — skipped for MVP hydration.
        }
      }
    }

    if (parts.length === 0) continue;

    out.push({
      id: `turn-${turnNumber}-assistant-${idx++}`,
      role: 'assistant',
      parts,
    });
  }

  return out;
}
