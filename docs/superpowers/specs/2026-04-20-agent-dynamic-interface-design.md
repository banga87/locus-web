# Agent-driven dynamic interface

**Date:** 2026-04-20
**Status:** Draft (awaiting review)
**Scope:** Exploration of a system where an agent can construct its own interactive UI surface — choosing from a pre-built component library via MCP tool calls — to present structured information and collect user input outside of chat.

---

## Motivation

The chat surface is the right modality for open-ended conversation, but it is a poor fit for structured outputs: dashboards, weekly reports, metric summaries, approval flows with configurable parameters. Today, all of this lands as markdown text in a message bubble.

The idea here is to let the agent *compose* a purpose-built interface on the fly — not by writing arbitrary code, but by calling into a constrained component library whose parameters the agent already understands. The constraints are the point: pre-built components mean no arbitrary code execution, predictable rendering, and a well-defined schema the agent can reason about from the tool description alone.

**Primary use cases driving the design:**

- **Periodic reports** — agent surfaces a dashboard (charts, tables, metric cards) populated with data it just retrieved; user reads without needing to parse prose.
- **Configuration / approval flows** — agent needs a human decision before proceeding; it renders a form with the relevant variables already populated; user adjusts and confirms.
- **Data exploration** — agent finds something interesting and wants to give the user handles to slice and filter it interactively.

---

## Decisions taken during brainstorming

These are load-bearing for the rest of the spec.

- **Inline-in-chat first, canvas second.** Components render as special message parts inside the existing chat surface. A dedicated canvas/dashboard route is a later-phase concern once the component vocabulary is proven in practice.
- **Component vocabulary is the product decision.** The MCP tool description is the spec the agent reads; keeping the vocabulary tight keeps the tool description legible and the agent's reasoning predictable.
- **Bidirectional via new turn, not blocking.** Component interactions create a new agent turn with structured state injected as context. The agent is never blocked waiting for user input — it simply receives a `component_response` event on its next turn.
- **Props must go through explicit allow-listed rendering.** All component props are rendered as text or typed values — never as raw HTML. XSS sanitization is enforced at the component level, not at the tool call level.

---

## Architecture

### How it fits today's rendering pipeline

The existing `UIMessage.parts` pipeline already demonstrates this pattern at small scale: `ProposalCard` and `SkillProposalCard` are pre-built components that render when the agent calls a specific tool. This design generalizes that into a first-class system.

```
Agent calls render_component tool
  → tool result: { type: 'ui_component', componentType, props }
  → message-bubble.tsx / tool-call-indicator.tsx detects ui_component result
  → dispatches to pre-built component renderer
  → component renders inline in chat stream
```

No changes to the harness (`src/lib/agent/`). The tool is registered like any other in `src/lib/tools/implementations/`. The rendering branch is added in the existing part-walker in `message-bubble.tsx`.

### Bidirectional state roundtrip

When the user interacts with a component (submits a form, confirms an action), the component fires an event that creates a new turn. The `UserPromptSubmit` hook injects the component state as structured context above the user message:

```json
{
  "type": "component_response",
  "componentId": "budget-form-1",
  "values": { "threshold": 15000, "currency": "GBP" }
}
```

The agent sees this as part of the conversation history and continues. No blocking, no polling, no new transport mechanism.

### Canvas view (Phase 2)

A `/canvas/[sessionId]` route reads persisted component specs from the DB and renders them in a spatial layout. This requires:

- A persistence model for component specs (component type + props + layout position stored per session turn)
- A layout composition system (agent specifies a grid position or the canvas auto-flows)
- A shareable URL so reports can be sent to stakeholders without opening a chat session

This is deferred until the inline path proves the component vocabulary.

---

## Component vocabulary (v1 proposal)

Two categories: display and input.

### Display

| Type | Key props |
|---|---|
| `metric_card` | `label`, `value`, `delta`, `deltaDirection`, `unit` |
| `table` | `columns: [{ key, label, type }]`, `rows: object[]`, `caption` |
| `line_chart` | `series: [{ label, data: [{ x, y }] }]`, `xLabel`, `yLabel` |
| `bar_chart` | `series: [{ label, data: [{ category, value }] }]`, `xLabel`, `yLabel` |
| `markdown_card` | `content` (markdown string, Streamdown-rendered) |

### Input

| Type | Key props |
|---|---|
| `form` | `fields: [{ key, label, type, defaultValue, options? }]`, `submitLabel` |
| `confirm_action` | `title`, `description`, `confirmLabel`, `cancelLabel` |

Field types for `form`: `text`, `number`, `select`, `slider` (with `min`/`max`/`step`), `date`.

Each component type gets a JSON schema. The MCP tool description includes the full schema so the agent can construct valid calls without trial and error.

---

## Tool definition sketch

```typescript
// src/lib/tools/implementations/render_ui.ts

export const renderUiTool: LocusTool = {
  name: 'render_ui',
  description: `Render a UI component inline in the chat interface.
    Use display components (metric_card, table, line_chart, bar_chart, markdown_card)
    to present structured data visually. Use input components (form, confirm_action)
    to collect structured input from the user — the user's response will arrive as
    a component_response in the next turn.`,
  inputSchema: { /* discriminated union on componentType */ },
  execute: async ({ componentType, props }, ctx) => {
    return { type: 'ui_component', componentType, props, componentId: generateId() };
  }
};
```

The tool's execute is lightweight — it returns a structured payload that the rendering layer knows how to handle. No DB write needed for the inline-chat phase.

---

## Security considerations

- **No raw HTML in props.** All string values are rendered as text nodes or passed through Streamdown. The component renderer must not use `dangerouslySetInnerHTML`.
- **Schema validation on execute.** The tool executor's AJV validation pipeline (already in place) catches malformed props before they reach the renderer.
- **Component ID is server-generated.** Agents cannot specify `componentId` — it is assigned at execute time to prevent spoofing of `component_response` events.
- **Input components do not execute code.** `form` and `confirm_action` fire structured events only; they have no `onClick` or `href` props.

---

## Open questions

1. **Layout in the canvas view.** Should the agent specify grid positions explicitly, or should the canvas auto-flow and let the user rearrange? Auto-flow is simpler to specify but produces generic layouts.
2. **Component updates.** Can the agent update a previously-rendered component (e.g. refresh a chart with new data in the same turn)? Requires addressing components by ID within a turn.
3. **Report persistence and sharing.** What is the ownership / access model for saved canvas views? Per-session? Per-company? Shareable link?
4. **Streaming components.** Can a `table` stream rows as the agent retrieves data, or must all rows be provided in a single tool call?

---

## Implementation path

1. Define the component JSON schemas and add `render_ui` to `src/lib/tools/implementations/`
2. Add a `ui_component` branch in `tool-call-indicator.tsx` / `message-bubble.tsx`
3. Build the v1 component library under `src/components/agent-ui/`
4. Wire `component_response` injection into the `UserPromptSubmit` hook path
5. Ship inline-in-chat; gather usage signal on which components get used
6. Design canvas persistence model once component vocabulary is stable
