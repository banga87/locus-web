// Unit tests for `buildUIModel` — the reducer that collapses the flat
// workflow_run_events stream into ordered turn items.
//
// The reducer is the piece that broke when the runner changed AgentEvent
// payload keys (camelCase) while the reducer still read snake_case —
// making every persisted tool call render as "Using Unknown…" and never
// transition from pending. Guarding the payload-shape contract here so
// that drift can't silently return.

import { describe, expect, it } from 'vitest';

import { buildUIModel } from '../run-view';
import type { WorkflowRunEvent } from '@/hooks/use-workflow-run';

function ev(partial: Partial<WorkflowRunEvent> & Pick<WorkflowRunEvent, 'eventType'>): WorkflowRunEvent {
  return {
    id: partial.id ?? `evt-${Math.random().toString(36).slice(2, 10)}`,
    runId: partial.runId ?? 'run-1',
    sequence: partial.sequence ?? 0,
    eventType: partial.eventType,
    payload: partial.payload ?? {},
    createdAt: partial.createdAt ?? '2026-04-18T00:00:00Z',
  };
}

describe('buildUIModel', () => {
  it('resolves tool_result back to its tool_start by toolCallId', () => {
    const events = [
      ev({ eventType: 'turn_start', payload: { turnNumber: 0 } }),
      ev({
        eventType: 'tool_start',
        payload: {
          toolCallId: 'toolu_abc',
          toolName: 'search_documents',
          args: { query: 'foo' },
        },
      }),
      ev({
        eventType: 'tool_result',
        payload: {
          toolCallId: 'toolu_abc',
          toolName: 'search_documents',
          result: { results: [] },
          isError: false,
        },
      }),
      ev({ eventType: 'turn_complete', payload: { finishReason: 'stop' } }),
    ];

    const { turns } = buildUIModel(events);
    expect(turns).toHaveLength(1);
    const items = turns[0]!.items;
    expect(items).toHaveLength(1);
    const [tool] = items;
    expect(tool!.kind).toBe('tool');
    if (tool!.kind !== 'tool') throw new Error('unreachable');
    expect(tool!.entry.toolName).toBe('search_documents');
    expect(tool!.entry.state).toBe('complete');
    expect(tool!.entry.result).toEqual({ results: [] });
  });

  it('marks tool calls as errored when isError is true and surfaces errorText', () => {
    const events = [
      ev({ eventType: 'turn_start', payload: { turnNumber: 0 } }),
      ev({
        eventType: 'tool_start',
        payload: { toolCallId: 'toolu_x', toolName: 'web_fetch', args: {} },
      }),
      ev({
        eventType: 'tool_result',
        payload: {
          toolCallId: 'toolu_x',
          toolName: 'web_fetch',
          result: { message: 'blocked by robots.txt' },
          isError: true,
        },
      }),
    ];
    const { turns } = buildUIModel(events);
    const tool = turns[0]!.items[0];
    if (tool!.kind !== 'tool') throw new Error('expected tool item');
    expect(tool.entry.state).toBe('error');
    expect(tool.entry.errorText).toBe('blocked by robots.txt');
  });

  it('preserves chronological order of text and tool calls within a turn', () => {
    const events = [
      ev({ eventType: 'turn_start' }),
      ev({ eventType: 'llm_delta', payload: { delta: 'Looking up ' } }),
      ev({ eventType: 'llm_delta', payload: { delta: 'the answer.' } }),
      ev({
        eventType: 'tool_start',
        payload: { toolCallId: 't1', toolName: 'search_documents', args: {} },
      }),
      ev({
        eventType: 'tool_result',
        payload: { toolCallId: 't1', toolName: 'search_documents', result: {}, isError: false },
      }),
      ev({ eventType: 'llm_delta', payload: { delta: 'Found it.' } }),
    ];
    const items = buildUIModel(events).turns[0]!.items;
    expect(items.map((i) => i.kind)).toEqual(['text', 'tool', 'text']);
    expect(items[0]!.kind === 'text' && items[0]!.text).toBe('Looking up the answer.');
    expect(items[2]!.kind === 'text' && items[2]!.text).toBe('Found it.');
  });

  it('coalesces consecutive reasoning deltas and keeps them separate from text', () => {
    const events = [
      ev({ eventType: 'turn_start' }),
      ev({ eventType: 'reasoning', payload: { delta: 'First I' } }),
      ev({ eventType: 'reasoning', payload: { delta: ' consider X.' } }),
      ev({ eventType: 'llm_delta', payload: { delta: 'Here goes.' } }),
    ];
    const items = buildUIModel(events).turns[0]!.items;
    expect(items.map((i) => i.kind)).toEqual(['reasoning', 'text']);
    expect(items[0]!.kind === 'reasoning' && items[0]!.text).toBe('First I consider X.');
  });

  it('captures run_error payload.message', () => {
    const { runError } = buildUIModel([
      ev({ eventType: 'run_error', payload: { message: 'workflow doc missing' } }),
    ]);
    expect(runError).toBe('workflow doc missing');
  });

  it('falls back to "unknown" when tool_start payload omits toolName (guard, not a regression gate)', () => {
    // Sanity: if a future runner version drops toolName, we still render
    // something rather than crashing. Kept as explicit documentation that
    // "unknown" is a fallback — not the happy path.
    const events = [
      ev({ eventType: 'turn_start' }),
      ev({ eventType: 'tool_start', payload: { toolCallId: 'tN', args: {} } }),
    ];
    const items = buildUIModel(events).turns[0]!.items;
    expect(items[0]!.kind).toBe('tool');
    if (items[0]!.kind !== 'tool') throw new Error('unreachable');
    expect(items[0]!.entry.toolName).toBe('unknown');
  });
});
