'use client';

// Renders a single UIMessage from @ai-sdk/react. Walks `message.parts`
// so the render logic stays close to the AI SDK v6 shape:
//   - text parts → Markdown (user messages are plain text by convention)
//   - dynamic-tool parts → <ToolCallIndicator> with state mapped from
//     the AI SDK `state` field
//   - static tool parts (`tool-<name>`) → same indicator. Note: every
//     Locus tool is bridged via `dynamicTool`, but we still pattern-match
//     both shapes because `@ai-sdk/react`'s runtime is free to emit
//     either depending on how the server registered tools.
//   - reasoning / step-start / unknown → skipped
//
// Visual contract (plan lines 1442):
//   - User: right-aligned, primary colored background
//   - Agent: left-aligned, card-colored background, Markdown body
//
// Markdown rendering: we use `MessageResponse` from @/components/
// ai-elements/message — it wraps Streamdown, which safely parses
// incremental/streaming markdown without HTML passthrough and without
// re-parsing the whole string on every chunk. This is the recommended
// renderer for `useChat` text parts per the ai-elements skill.

import type { UIMessage } from 'ai';

import { MessageResponse } from '@/components/ai-elements/message';
import { cn } from '@/lib/utils';

import { ToolCallIndicator, type IndicatorState } from './tool-call-indicator';

interface MessageBubbleProps {
  message: UIMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <div
      className={cn(
        'flex w-full',
        isUser ? 'justify-end' : 'justify-start',
      )}
      data-role={message.role}
    >
      <div
        className={cn(
          'max-w-[80%] space-y-2 rounded-2xl px-4 py-2.5 text-sm',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-card text-card-foreground border border-border',
        )}
      >
        {message.parts.map((part, idx) => (
          <PartRenderer
            key={`${message.id}-${idx}`}
            part={part}
            isUser={isUser}
          />
        ))}
      </div>
    </div>
  );
}

// `UIMessagePart` is a discriminated union; narrow off `part.type`.
type AnyPart = UIMessage['parts'][number];

function PartRenderer({ part, isUser }: { part: AnyPart; isUser: boolean }) {
  // Text — render as Markdown for agent messages, plain text for user.
  if (part.type === 'text') {
    const text = (part as { text: string }).text;
    if (!text) return null;
    if (isUser) {
      return <p className="whitespace-pre-wrap break-words">{text}</p>;
    }
    return <MarkdownPart text={text} />;
  }

  // Static tool part — `tool-<name>`. Shape from AI SDK v6 UIToolInvocation.
  if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
    const toolName = part.type.slice('tool-'.length);
    return <ToolPart part={part as AnyToolPart} toolName={toolName} />;
  }

  // Dynamic tool part — emitted when the server registered the tool via
  // `dynamicTool()`. `toolName` lives in the part body.
  if (part.type === 'dynamic-tool') {
    const p = part as AnyToolPart & { toolName: string };
    return <ToolPart part={p} toolName={p.toolName} />;
  }

  // Reasoning / step-start / source / file / data-* — not rendered in MVP.
  return null;
}

// Shared shape for both static (tool-NAME) and dynamic (dynamic-tool) parts.
// We don't need the full generic typing; just the fields we read.
type AnyToolPart = {
  state:
    | 'input-streaming'
    | 'input-available'
    | 'approval-requested'
    | 'approval-responded'
    | 'output-available'
    | 'output-error'
    | 'output-denied';
  input?: unknown;
  output?: unknown;
  errorText?: string;
  toolCallId: string;
};

function ToolPart({
  part,
  toolName,
}: {
  part: AnyToolPart;
  toolName: string;
}) {
  let indicatorState: IndicatorState;
  let errorText: string | undefined;

  // Collapse the six v6 states into our three display states. Tool
  // results that come back as `{ error: true, ... }` from a LocusTool's
  // execute wrapper (see `bridgeLocusTool`) are still `output-available`
  // from the AI SDK's perspective — we sniff the payload below so the
  // UI reflects the customer-visible error.
  switch (part.state) {
    case 'input-streaming':
    case 'input-available':
    case 'approval-requested':
    case 'approval-responded':
      indicatorState = 'pending';
      break;
    case 'output-error':
    case 'output-denied':
      indicatorState = 'error';
      errorText = part.errorText;
      break;
    case 'output-available': {
      // LocusTool wrappers surface errors as `{ error: true, message }`
      // instead of throwing. Respect that.
      const out = part.output;
      if (
        out &&
        typeof out === 'object' &&
        (out as { error?: unknown }).error === true
      ) {
        indicatorState = 'error';
        const msg = (out as { message?: unknown }).message;
        if (typeof msg === 'string') errorText = msg;
      } else {
        indicatorState = 'complete';
      }
      break;
    }
    default:
      // Unknown state (forward-compat): treat as pending so the user
      // still sees *something* rather than a blank slot.
      indicatorState = 'pending';
  }

  return (
    <div className="py-0.5">
      <ToolCallIndicator
        toolName={toolName}
        args={part.input}
        state={indicatorState}
        errorText={errorText}
      />
    </div>
  );
}

function MarkdownPart({ text }: { text: string }) {
  // MessageResponse (Streamdown under the hood) is streaming-aware and
  // escapes HTML. The `chat-markdown` class lets our CSS in globals.css
  // style headings / lists / links / code blocks inside the bubble.
  return (
    <div className="chat-markdown">
      <MessageResponse>{text}</MessageResponse>
    </div>
  );
}
