# Frontmatter Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the lossy marked→Tiptap→Turndown round-trip of frontmatter with a schema-aware FrontmatterPanel + body-only Tiptap, so every typed document (`type: workflow` first, `skill`/`agent-definition` later) keeps its YAML intact across edits.

**Architecture:** `splitFrontmatter` isolates the YAML block before Tiptap ever sees it, a `FrontmatterPanel` edits it in structured form (with a raw-YAML escape hatch), and `joinFrontmatter` reassembles a canonical markdown file at save. A `FrontmatterSchema` registry keyed on `documents.type` is the cross-doc plugin surface. Server PATCH path is unchanged and becomes defence-in-depth.

**Tech Stack:** Next.js (App Router), React, Tiptap 3.x + StarterKit, marked 18, turndown 7, js-yaml 4, Vitest + jsdom + Testing Library, Drizzle ORM on Supabase Postgres.

**Spec:** [`docs/superpowers/specs/2026-04-17-frontmatter-editor-design.md`](../specs/2026-04-17-frontmatter-editor-design.md)

**Worktree:** `C:\Code\locus\locus-web\.worktrees\workflows` (branch `workflows`). All paths below are relative to this worktree root.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `src/lib/frontmatter/markdown.ts` | `splitFrontmatter`, `joinFrontmatter`, hand-rolled emitter for the schema-driven subset of YAML. Pure, no I/O. |
| `src/lib/frontmatter/__tests__/markdown.test.ts` | Round-trip, CRLF, missing-frontmatter, byte-stability tests. |
| `src/lib/frontmatter/schemas/types.ts` | `FrontmatterField`, `FrontmatterSchema`, `ValidateResult` types. |
| `src/lib/frontmatter/schemas/workflow.ts` | `workflowSchema` — wraps `validateWorkflowFrontmatter`. |
| `src/lib/frontmatter/schemas/index.ts` | `schemaRegistry` map + `getSchema(type)` helper. |
| `src/lib/frontmatter/schemas/__tests__/workflow.test.ts` | Wrapper contract tests. |
| `src/components/frontmatter/frontmatter-panel.tsx` | Stateless panel: fields mode / raw mode / toggle / error banner. |
| `src/components/frontmatter/__tests__/frontmatter-panel.test.tsx` | Render + toggle + field-change tests. |
| `src/components/frontmatter/use-frontmatter-editor.ts` | Shared React hook: split on mount, debounced save, join on flush. |
| `src/components/frontmatter/__tests__/use-frontmatter-editor.test.ts` | Debounce + save-body composition tests. |
| `scripts/lib/repair-frontmatter.ts` | DB-free helpers (detect corruption, extract v1 workflow, compare bodies) — imported by both the CLI and its tests. |
| `scripts/migrate-repair-frontmatter.ts` | CLI entry: connects to the DB, iterates candidates, calls helpers, closes pg client. |
| `scripts/__tests__/repair-frontmatter.test.ts` | Unit tests over the helpers — no DB, no network. |

### Existing files to modify

| File | Change |
|---|---|
| `src/components/brain/document-editor.tsx` | Replace ad-hoc debounce + direct marked/turndown with `useFrontmatterEditor`. Render `FrontmatterPanel` when `documents.type` has a schema. |
| `src/components/workflows/workflow-detail-tabs.tsx` | Same hook. Replace read-only `WorkflowFrontmatterFields` sidebar with editable `FrontmatterPanel`. |
| `src/components/workflows/new-workflow-form.tsx` | Seed content via `workflowSchema.defaults()` + `joinFrontmatter`. Drop the literal `WORKFLOW_FRONTMATTER` constant. |
| `src/components/workflows/workflow-frontmatter-fields.tsx` | **Delete.** Replaced by `FrontmatterPanel`. |

### Commands reference

All tests run via vitest directly (no `"test"` script in `package.json`):

```bash
npx vitest run <path-to-test>         # one-shot, CI-style
npx vitest <path-to-test>             # watch mode during development
npm run lint                           # eslint + harness-boundary check
npx tsc --noEmit                       # type-check (no build script for this)
```

---

## Pre-flight

- [ ] **Confirm worktree + branch**

```bash
cd C:/Code/locus/locus-web/.worktrees/workflows
git status
git branch --show-current
```
Expected: on branch `workflows`, clean or only the Phase 1.5 workflows changes present.

- [ ] **Confirm dependencies**

Use the Read tool on `package.json` and verify these entries are present (no new deps needed):

- `dependencies["js-yaml"]` — `^4.1.1` or compatible
- `dependencies["marked"]` — `^18.0.0` or compatible
- `dependencies["turndown"]` — `^7.2.4` or compatible
- `devDependencies["vitest"]` — `^4.1.4` or compatible
- `devDependencies["@testing-library/react"]` — any recent version

If any are missing, stop and flag — the plan assumes no new installs.

---

## Task 1: Pure `splitFrontmatter` / `joinFrontmatter` + schema-driven YAML emitter

This is the contract the whole plan hangs on. Ship it first, test it thoroughly, then everything downstream can trust it.

**Files:**
- Create: `src/lib/frontmatter/markdown.ts`
- Create: `src/lib/frontmatter/__tests__/markdown.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/frontmatter/__tests__/markdown.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { splitFrontmatter, joinFrontmatter, emitSchemaYaml } from '../markdown';
import type { FrontmatterSchema } from '../schemas/types';

const fakeWorkflow: FrontmatterSchema = {
  type: 'workflow',
  label: 'Workflow',
  fields: [
    { kind: 'enum', name: 'output', label: 'Output', options: ['document', 'message', 'both'], required: true },
    { kind: 'nullable-string', name: 'output_category', label: 'Category' },
    { kind: 'string-array', name: 'requires_mcps', label: 'Required MCPs' },
    { kind: 'nullable-string', name: 'schedule', label: 'Schedule' },
  ],
  defaults: () => ({ output: 'document', output_category: null, requires_mcps: [], schedule: null }),
  validate: () => ({ ok: true, value: {} }),
};

describe('splitFrontmatter', () => {
  it('splits a well-formed document', () => {
    const raw = '---\ntype: workflow\noutput: document\n---\n\nHello world\n';
    const { frontmatterText, body } = splitFrontmatter(raw);
    expect(frontmatterText).toBe('type: workflow\noutput: document');
    expect(body).toBe('Hello world\n');
  });

  it('handles CRLF line endings', () => {
    const raw = '---\r\ntype: workflow\r\n---\r\n\r\nBody\r\n';
    const { frontmatterText, body } = splitFrontmatter(raw);
    expect(frontmatterText).toBe('type: workflow');
    expect(body).toBe('Body\r\n');
  });

  it('returns null frontmatter when block is missing', () => {
    const raw = '# Just a heading\n\nSome prose.\n';
    const { frontmatterText, body } = splitFrontmatter(raw);
    expect(frontmatterText).toBeNull();
    expect(body).toBe(raw);
  });

  it('returns null frontmatter when the closing --- is missing', () => {
    const raw = '---\ntype: workflow\n# never closed\nbody\n';
    const { frontmatterText, body } = splitFrontmatter(raw);
    expect(frontmatterText).toBeNull();
    expect(body).toBe(raw);
  });

  it('preserves a body that itself contains a --- thematic break', () => {
    const raw = '---\ntype: workflow\noutput: document\n---\n\nBefore\n\n---\n\nAfter\n';
    const { frontmatterText, body } = splitFrontmatter(raw);
    expect(frontmatterText).toBe('type: workflow\noutput: document');
    expect(body).toBe('Before\n\n---\n\nAfter\n');
  });
});

describe('emitSchemaYaml', () => {
  it('emits canonical workflow YAML with null literals and inline empty arrays', () => {
    const out = emitSchemaYaml(
      { output: 'document', output_category: null, requires_mcps: [], schedule: null },
      fakeWorkflow,
    );
    expect(out).toBe(
      'type: workflow\noutput: document\noutput_category: null\nrequires_mcps: []\nschedule: null',
    );
  });

  it('emits block-form arrays for non-empty string arrays', () => {
    const out = emitSchemaYaml(
      { output: 'document', output_category: null, requires_mcps: ['sentry', 'axiom'], schedule: null },
      fakeWorkflow,
    );
    expect(out).toBe(
      'type: workflow\noutput: document\noutput_category: null\nrequires_mcps:\n  - sentry\n  - axiom\nschedule: null',
    );
  });

  it('emits ordered keys per schema.fields, with type first', () => {
    const out = emitSchemaYaml(
      // deliberately-shuffled input
      { schedule: null, output_category: 'Reports', requires_mcps: [], output: 'message' },
      fakeWorkflow,
    );
    expect(out.startsWith('type: workflow\noutput: message\n')).toBe(true);
  });
});

describe('joinFrontmatter', () => {
  it('produces a canonical file with a blank line between fences and body', () => {
    const joined = joinFrontmatter(
      { output: 'document', output_category: null, requires_mcps: [], schedule: null },
      'Body line\n',
      fakeWorkflow,
    );
    expect(joined).toBe(
      '---\ntype: workflow\noutput: document\noutput_category: null\nrequires_mcps: []\nschedule: null\n---\n\nBody line\n',
    );
  });

  it('returns body unchanged when schema is null', () => {
    const joined = joinFrontmatter(null, '# No frontmatter\n', null);
    expect(joined).toBe('# No frontmatter\n');
  });

  it('is byte-stable: split→join with the same value reproduces the file', () => {
    const original =
      '---\ntype: workflow\noutput: document\noutput_category: null\nrequires_mcps: []\nschedule: null\n---\n\nHello\n';
    const { body } = splitFrontmatter(original);
    const joined = joinFrontmatter(
      { output: 'document', output_category: null, requires_mcps: [], schedule: null },
      body,
      fakeWorkflow,
    );
    expect(joined).toBe(original);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run src/lib/frontmatter/__tests__/markdown.test.ts
```
Expected: FAIL (`Cannot find module '../markdown'` or similar — the module and its siblings don't exist yet).

- [ ] **Step 3: Implement `src/lib/frontmatter/markdown.ts`**

```ts
// src/lib/frontmatter/markdown.ts
//
// Pure helpers for splitting and reassembling a markdown document whose
// head is a YAML frontmatter block. Tiptap/marked/turndown never see the
// frontmatter — callers strip it before load and glue it back at save.
//
// The YAML emitter is hand-rolled against a declared schema rather than
// using js-yaml.dump because we need:
//   - stable key order (matches `schema.fields`)
//   - `null` emitted as the literal 'null' (not the empty scalar)
//   - empty arrays inline as `[]`
//   - no fancy anchors, tags, or multi-line scalar styles
// These match the existing canonical shape of WORKFLOW_FRONTMATTER so a
// no-op save is byte-identical on disk.

import type { FrontmatterSchema } from './schemas/types';

export interface SplitResult {
  /** YAML payload with the --- fences stripped, or null if none. */
  frontmatterText: string | null;
  /** Everything after the closing fence (blank-line after it trimmed). */
  body: string;
}

/**
 * Recognise a document that begins with a `---\n` frontmatter fence and
 * split it from the body. Strict: the document must start with the fence
 * on the very first line; an interior `---` is not treated as frontmatter.
 *
 * CRLF-safe — the fence regex tolerates `\r\n` line endings the same way
 * the PATCH route's frontmatter-sync regex does.
 */
export function splitFrontmatter(content: string): SplitResult {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n)?/);
  if (!match) return { frontmatterText: null, body: content };

  const frontmatterText = match[1];
  let body = content.slice(match[0].length);
  // If the closing fence is followed by a blank separator line, strip one
  // so the reassembled file doesn't accumulate leading blank lines.
  if (body.startsWith('\r\n')) body = body.slice(2);
  else if (body.startsWith('\n')) body = body.slice(1);
  return { frontmatterText, body };
}

/**
 * Emit the schema-ordered YAML body (no fences). Deterministic for a
 * given value+schema pair.
 */
export function emitSchemaYaml(
  value: Record<string, unknown>,
  schema: FrontmatterSchema,
): string {
  const lines: string[] = [`type: ${schema.type}`];
  for (const field of schema.fields) {
    const v = value[field.name];
    switch (field.kind) {
      case 'enum':
      case 'string': {
        lines.push(`${field.name}: ${v == null ? '' : String(v)}`);
        break;
      }
      case 'nullable-string': {
        lines.push(`${field.name}: ${v == null ? 'null' : String(v)}`);
        break;
      }
      case 'string-array': {
        if (!Array.isArray(v) || v.length === 0) {
          lines.push(`${field.name}: []`);
        } else {
          lines.push(`${field.name}:`);
          for (const item of v) lines.push(`  - ${String(item)}`);
        }
        break;
      }
    }
  }
  return lines.join('\n');
}

/**
 * Reassemble a canonical markdown file: `---\n<yaml>\n---\n\n<body>`.
 * When `schema` is null the body is returned unchanged (document type has
 * no registered schema — no frontmatter is emitted, caller has already
 * decided the panel is inapplicable).
 */
export function joinFrontmatter(
  value: Record<string, unknown> | null,
  body: string,
  schema: FrontmatterSchema | null,
): string {
  if (!schema || !value) return body;
  const yaml = emitSchemaYaml(value, schema);
  return `---\n${yaml}\n---\n\n${body}`;
}
```

- [ ] **Step 4: Implement the bare schema types so the tests can import them**

Create `src/lib/frontmatter/schemas/types.ts` (minimal — Task 2 fleshes out the rest):

```ts
// src/lib/frontmatter/schemas/types.ts

export type FrontmatterField =
  | { kind: 'string'; name: string; label: string; required?: boolean; placeholder?: string }
  | { kind: 'nullable-string'; name: string; label: string; placeholder?: string }
  | {
      kind: 'enum';
      name: string;
      label: string;
      options: readonly string[];
      required?: boolean;
    }
  | { kind: 'string-array'; name: string; label: string; itemLabel?: string };

export interface ValidationError {
  field: string;
  message: string;
}

export type ValidateResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; errors: ValidationError[] };

export interface FrontmatterSchema {
  /** Exact value of the `type` field; uniquely identifies the schema. */
  type: string;
  /** Display name shown in the panel header. */
  label: string;
  /** Ordered field list — drives rendering and emission order. */
  fields: readonly FrontmatterField[];
  /** Default value for a brand-new document of this type. */
  defaults: () => Record<string, unknown>;
  /** Full-shape validator used client + server. */
  validate: (input: unknown) => ValidateResult;
}
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
npx vitest run src/lib/frontmatter/__tests__/markdown.test.ts
```
Expected: all 11 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/frontmatter/markdown.ts src/lib/frontmatter/schemas/types.ts src/lib/frontmatter/__tests__/markdown.test.ts
git commit -m "feat(frontmatter): split/join helpers + schema-driven YAML emitter"
```

---

## Task 2: Workflow schema + registry

**Files:**
- Create: `src/lib/frontmatter/schemas/workflow.ts`
- Create: `src/lib/frontmatter/schemas/index.ts`
- Create: `src/lib/frontmatter/schemas/__tests__/workflow.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/frontmatter/schemas/__tests__/workflow.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { workflowSchema } from '../workflow';
import { getSchema, schemaRegistry } from '..';

describe('workflowSchema', () => {
  it('exposes the canonical default value', () => {
    expect(workflowSchema.defaults()).toEqual({
      output: 'document',
      output_category: null,
      requires_mcps: [],
      schedule: null,
    });
  });

  it('validates a good value without requiring `type`', () => {
    const r = workflowSchema.validate({
      output: 'message',
      output_category: 'Reports',
      requires_mcps: ['sentry'],
      schedule: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({
        output: 'message',
        output_category: 'Reports',
        requires_mcps: ['sentry'],
        schedule: null,
      });
    }
  });

  it('rejects invalid output', () => {
    const r = workflowSchema.validate({
      output: 'banana',
      output_category: null,
      requires_mcps: [],
      schedule: null,
    });
    expect(r.ok).toBe(false);
  });

  it('has four fields in spec-declared order', () => {
    expect(workflowSchema.fields.map((f) => f.name)).toEqual([
      'output',
      'output_category',
      'requires_mcps',
      'schedule',
    ]);
  });
});

describe('schema registry', () => {
  it('resolves workflow by type', () => {
    expect(getSchema('workflow')).toBe(workflowSchema);
  });

  it('returns null for unknown types', () => {
    expect(getSchema('not-a-type')).toBeNull();
  });

  it('returns null when the input type is null', () => {
    expect(getSchema(null)).toBeNull();
  });

  it('contains workflow in the registry map', () => {
    expect(schemaRegistry.workflow).toBe(workflowSchema);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run src/lib/frontmatter/schemas/__tests__/workflow.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `workflow.ts`**

Create `src/lib/frontmatter/schemas/workflow.ts`:

```ts
// src/lib/frontmatter/schemas/workflow.ts
//
// Wraps the existing `validateWorkflowFrontmatter` (narrow-typed) behind
// the generic FrontmatterSchema contract. The wrapper injects `type:
// 'workflow'` before calling the inner validator because the validator
// enforces it; the panel doesn't surface `type` as an editable field.

import { validateWorkflowFrontmatter } from '@/lib/brain/frontmatter';
import type { FrontmatterSchema } from './types';

export const workflowSchema: FrontmatterSchema = {
  type: 'workflow',
  label: 'Workflow',
  fields: [
    {
      kind: 'enum',
      name: 'output',
      label: 'Output',
      options: ['document', 'message', 'both'] as const,
      required: true,
    },
    {
      kind: 'nullable-string',
      name: 'output_category',
      label: 'Category',
      placeholder: 'Folder slug or leave empty',
    },
    {
      kind: 'string-array',
      name: 'requires_mcps',
      label: 'Required MCPs',
      itemLabel: 'MCP slug',
    },
    {
      kind: 'nullable-string',
      name: 'schedule',
      label: 'Schedule (cron)',
      placeholder: 'Reserved — manual only',
    },
  ],
  defaults: () => ({
    output: 'document',
    output_category: null,
    requires_mcps: [],
    schedule: null,
  }),
  validate: (input) => {
    if (typeof input !== 'object' || input === null) {
      return { ok: false, errors: [{ field: 'input', message: 'must be an object' }] };
    }
    const r = validateWorkflowFrontmatter({ type: 'workflow', ...(input as Record<string, unknown>) });
    if (!r.ok) return { ok: false, errors: r.errors };
    return {
      ok: true,
      value: {
        output: r.value.output,
        output_category: r.value.output_category,
        requires_mcps: r.value.requires_mcps,
        schedule: r.value.schedule,
      },
    };
  },
};
```

- [ ] **Step 4: Implement `index.ts`**

Create `src/lib/frontmatter/schemas/index.ts`:

```ts
// src/lib/frontmatter/schemas/index.ts

import type { FrontmatterSchema } from './types';
import { workflowSchema } from './workflow';

/**
 * Registry of all known FrontmatterSchemas, keyed by the value of the
 * doc's `type` column. Add a new entry here when a new typed doc lands.
 */
export const schemaRegistry: Record<string, FrontmatterSchema> = {
  workflow: workflowSchema,
};

/** Resolve a schema by doc type. Returns null when unregistered or null. */
export function getSchema(type: string | null): FrontmatterSchema | null {
  if (!type) return null;
  return schemaRegistry[type] ?? null;
}

export type { FrontmatterSchema, FrontmatterField, ValidateResult, ValidationError } from './types';
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
npx vitest run src/lib/frontmatter/schemas/__tests__/workflow.test.ts
```
Expected: all 8 tests PASS.

- [ ] **Step 6: Re-run Task 1 tests to confirm no regression**

```bash
npx vitest run src/lib/frontmatter
```
Expected: all Task 1 + Task 2 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/frontmatter/schemas
git commit -m "feat(frontmatter): workflow schema + registry"
```

---

## Task 3: `FrontmatterPanel` component (fields mode + raw mode)

**Files:**
- Create: `src/components/frontmatter/frontmatter-panel.tsx`
- Create: `src/components/frontmatter/__tests__/frontmatter-panel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/frontmatter/__tests__/frontmatter-panel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FrontmatterPanel } from '../frontmatter-panel';
import { workflowSchema } from '@/lib/frontmatter/schemas/workflow';

function baseValue() {
  return {
    output: 'document',
    output_category: null,
    requires_mcps: [],
    schedule: null,
  } as Record<string, unknown>;
}

describe('FrontmatterPanel', () => {
  it('renders the schema label in the header', () => {
    render(
      <FrontmatterPanel
        schema={workflowSchema}
        value={baseValue()}
        rawYaml={null}
        mode="fields"
        canEdit
        onFieldsChange={() => {}}
        onRawChange={() => {}}
        onModeChange={() => {}}
        error={null}
      />,
    );
    expect(screen.getByRole('heading', { name: /workflow/i })).toBeInTheDocument();
  });

  it('renders one control per schema field in fields mode', () => {
    render(
      <FrontmatterPanel
        schema={workflowSchema}
        value={baseValue()}
        rawYaml={null}
        mode="fields"
        canEdit
        onFieldsChange={() => {}}
        onRawChange={() => {}}
        onModeChange={() => {}}
        error={null}
      />,
    );
    expect(screen.getByLabelText(/output/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/category/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/required mcps/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/schedule/i)).toBeInTheDocument();
  });

  it('emits a partial patch on enum change', () => {
    const onFieldsChange = vi.fn();
    render(
      <FrontmatterPanel
        schema={workflowSchema}
        value={baseValue()}
        rawYaml={null}
        mode="fields"
        canEdit
        onFieldsChange={onFieldsChange}
        onRawChange={() => {}}
        onModeChange={() => {}}
        error={null}
      />,
    );
    fireEvent.change(screen.getByLabelText(/output/i), { target: { value: 'message' } });
    expect(onFieldsChange).toHaveBeenCalledWith({ output: 'message' });
  });

  it('emits a raw-mode toggle via onModeChange', () => {
    const onModeChange = vi.fn();
    render(
      <FrontmatterPanel
        schema={workflowSchema}
        value={baseValue()}
        rawYaml={null}
        mode="fields"
        canEdit
        onFieldsChange={() => {}}
        onRawChange={() => {}}
        onModeChange={onModeChange}
        error={null}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /view raw yaml/i }));
    expect(onModeChange).toHaveBeenCalledWith('raw');
  });

  it('renders a textarea with rawYaml contents in raw mode', () => {
    const raw = 'type: workflow\noutput: document';
    render(
      <FrontmatterPanel
        schema={workflowSchema}
        value={baseValue()}
        rawYaml={raw}
        mode="raw"
        canEdit
        onFieldsChange={() => {}}
        onRawChange={() => {}}
        onModeChange={() => {}}
        error={null}
      />,
    );
    const area = screen.getByRole('textbox', { name: /yaml/i }) as HTMLTextAreaElement;
    expect(area.value).toBe(raw);
  });

  it('shows an error banner when error is provided', () => {
    render(
      <FrontmatterPanel
        schema={workflowSchema}
        value={baseValue()}
        rawYaml={'oops'}
        mode="raw"
        canEdit
        onFieldsChange={() => {}}
        onRawChange={() => {}}
        onModeChange={() => {}}
        error={'YAML parse error: …'}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/yaml parse error/i);
  });

  it('forces raw mode and disables fields toggle when schema is null', () => {
    render(
      <FrontmatterPanel
        schema={null}
        value={{}}
        rawYaml="custom: value"
        mode="raw"
        canEdit
        onFieldsChange={() => {}}
        onRawChange={() => {}}
        onModeChange={() => {}}
        error={null}
      />,
    );
    const toggle = screen.queryByRole('button', { name: /view fields/i });
    // Either not rendered at all, or present-but-disabled — both are acceptable.
    if (toggle) expect(toggle).toBeDisabled();
  });

  it('disables all inputs when canEdit is false', () => {
    render(
      <FrontmatterPanel
        schema={workflowSchema}
        value={baseValue()}
        rawYaml={null}
        mode="fields"
        canEdit={false}
        onFieldsChange={() => {}}
        onRawChange={() => {}}
        onModeChange={() => {}}
        error={null}
      />,
    );
    expect(screen.getByLabelText(/output/i)).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run src/components/frontmatter/__tests__/frontmatter-panel.test.tsx
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `frontmatter-panel.tsx`**

Create `src/components/frontmatter/frontmatter-panel.tsx`:

```tsx
'use client';

// FrontmatterPanel — schema-aware editor for a document's YAML frontmatter.
//
// Two modes:
//   - 'fields': typed form controls from schema.fields
//   - 'raw': plain YAML textarea (escape hatch; also used when ingress
//     parsing fails or the doc type has no registered schema)
//
// Stateless. Caller (useFrontmatterEditor) owns mode + value + rawYaml
// and wires onFieldsChange/onRawChange/onModeChange to scheduled saves.

import type { FrontmatterSchema, FrontmatterField } from '@/lib/frontmatter/schemas/types';

interface Props {
  schema: FrontmatterSchema | null;
  value: Record<string, unknown>;
  rawYaml: string | null;
  mode: 'fields' | 'raw';
  canEdit: boolean;
  /** Partial merge into `value`. */
  onFieldsChange: (patch: Record<string, unknown>) => void;
  onRawChange: (yaml: string) => void;
  onModeChange: (mode: 'fields' | 'raw') => void;
  error: string | null;
}

export function FrontmatterPanel({
  schema,
  value,
  rawYaml,
  mode,
  canEdit,
  onFieldsChange,
  onRawChange,
  onModeChange,
  error,
}: Props) {
  const effectiveMode: 'fields' | 'raw' = schema ? mode : 'raw';

  return (
    <aside className="w-full space-y-4 rounded-lg border border-border bg-card p-4">
      <header className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {schema?.label ?? 'Frontmatter'}
        </h2>
        {schema && (
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => onModeChange(effectiveMode === 'fields' ? 'raw' : 'fields')}
            disabled={!canEdit}
          >
            {effectiveMode === 'fields' ? 'View raw YAML' : 'View fields'}
          </button>
        )}
      </header>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}

      {effectiveMode === 'fields' && schema ? (
        <FieldsForm schema={schema} value={value} canEdit={canEdit} onChange={onFieldsChange} />
      ) : (
        <RawEditor rawYaml={rawYaml ?? ''} canEdit={canEdit} onChange={onRawChange} />
      )}
    </aside>
  );
}

function FieldsForm({
  schema,
  value,
  canEdit,
  onChange,
}: {
  schema: FrontmatterSchema;
  value: Record<string, unknown>;
  canEdit: boolean;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-3">
      {schema.fields.map((field) => (
        <FieldRow
          key={field.name}
          field={field}
          value={value[field.name]}
          canEdit={canEdit}
          onChange={(v) => onChange({ [field.name]: v })}
        />
      ))}
    </div>
  );
}

function FieldRow({
  field,
  value,
  canEdit,
  onChange,
}: {
  field: FrontmatterField;
  value: unknown;
  canEdit: boolean;
  onChange: (v: unknown) => void;
}) {
  const id = `fm-${field.name}`;
  const label = (
    <label htmlFor={id} className="mb-1 block font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
      {field.label}
    </label>
  );

  switch (field.kind) {
    case 'enum': {
      return (
        <div>
          {label}
          <select
            id={id}
            value={(value as string) ?? ''}
            disabled={!canEdit}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            {field.options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      );
    }
    case 'string':
    case 'nullable-string': {
      const str = value == null ? '' : String(value);
      return (
        <div>
          {label}
          <input
            id={id}
            type="text"
            value={str}
            disabled={!canEdit}
            placeholder={field.kind === 'nullable-string' || field.kind === 'string' ? field.placeholder ?? '' : ''}
            onChange={(e) => {
              const next = e.target.value;
              onChange(field.kind === 'nullable-string' && next === '' ? null : next);
            }}
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
        </div>
      );
    }
    case 'string-array': {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div>
          {label}
          <StringArrayEditor
            id={id}
            items={arr}
            canEdit={canEdit}
            itemLabel={field.itemLabel ?? 'item'}
            onChange={onChange}
          />
        </div>
      );
    }
  }
}

function StringArrayEditor({
  id,
  items,
  canEdit,
  itemLabel,
  onChange,
}: {
  id: string;
  items: string[];
  canEdit: boolean;
  itemLabel: string;
  onChange: (items: string[]) => void;
}) {
  return (
    <div id={id} className="space-y-1">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            type="text"
            value={item}
            disabled={!canEdit}
            onChange={(e) => {
              const next = items.slice();
              next[i] = e.target.value;
              onChange(next);
            }}
            className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="px-2 text-xs text-muted-foreground hover:text-ink"
            aria-label="Remove"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={!canEdit}
        onClick={() => onChange([...items, ''])}
        className="text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        + Add {itemLabel}
      </button>
    </div>
  );
}

function RawEditor({
  rawYaml,
  canEdit,
  onChange,
}: {
  rawYaml: string;
  canEdit: boolean;
  onChange: (yaml: string) => void;
}) {
  return (
    <textarea
      aria-label="Raw YAML"
      value={rawYaml}
      disabled={!canEdit}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      rows={Math.max(6, rawYaml.split('\n').length)}
      className="w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
    />
  );
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run src/components/frontmatter/__tests__/frontmatter-panel.test.tsx
```
Expected: all 8 tests PASS. (If `@testing-library/react` assertions like `toBeInTheDocument` fail: verify `vitest.setup.ts` imports `@testing-library/jest-dom`; it already does — see existing component tests under `src/components/shell/__tests__`.)

- [ ] **Step 5: Lint + type-check**

```bash
npx tsc --noEmit
npm run lint
```
Expected: no errors touching the new files.

- [ ] **Step 6: Commit**

```bash
git add src/components/frontmatter/frontmatter-panel.tsx src/components/frontmatter/__tests__/frontmatter-panel.test.tsx
git commit -m "feat(frontmatter): panel component with fields + raw-YAML modes"
```

---

## Task 4: `useFrontmatterEditor` hook

The hook owns the three things every caller needs: (a) split the incoming content once, (b) keep panel state + body HTML in refs, (c) debounce-flush a single PATCH carrying the re-joined `content`. It also coalesces independent field-level patches (title, status, etc.) from non-frontmatter controls.

**Files:**
- Create: `src/components/frontmatter/use-frontmatter-editor.ts`
- Create: `src/components/frontmatter/__tests__/use-frontmatter-editor.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/components/frontmatter/__tests__/use-frontmatter-editor.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFrontmatterEditor } from '../use-frontmatter-editor';

const PRISTINE =
  '---\ntype: workflow\noutput: document\noutput_category: null\nrequires_mcps: []\nschedule: null\n---\n\nBody line\n';

describe('useFrontmatterEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('splits content on mount and exposes initial HTML (body-only)', () => {
    const { result } = renderHook(() =>
      useFrontmatterEditor({
        documentId: 'doc-1',
        initialContent: PRISTINE,
        docType: 'workflow',
        canEdit: true,
      }),
    );
    expect(result.current.panelState.mode).toBe('fields');
    expect(result.current.panelState.value).toMatchObject({ output: 'document' });
    // Body-only HTML must NOT include the frontmatter text…
    expect(result.current.initialHtml).not.toContain('type: workflow');
    // …and must NOT contain an <hr> (the exact marker of the old-path corruption).
    expect(result.current.initialHtml).not.toMatch(/<hr\b/);
  });

  it('debounces a PATCH with rejoined content on body change', async () => {
    const { result } = renderHook(() =>
      useFrontmatterEditor({
        documentId: 'doc-1',
        initialContent: PRISTINE,
        docType: 'workflow',
        canEdit: true,
      }),
    );

    act(() => result.current.onBodyHtmlChange('<p>new body</p>'));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/brain/documents/doc-1');
    expect((init as RequestInit).method).toBe('PATCH');
    const body = JSON.parse((init as RequestInit).body as string) as { content: string };
    expect(body.content).toMatch(/^---\ntype: workflow\n[\s\S]+\n---\n\n/);
    expect(body.content).toContain('new body');
  });

  it('coalesces overlapping panel + body changes into one PATCH', async () => {
    const { result } = renderHook(() =>
      useFrontmatterEditor({
        documentId: 'doc-1',
        initialContent: PRISTINE,
        docType: 'workflow',
        canEdit: true,
      }),
    );

    act(() => result.current.onPanelChange({ output: 'message' }));
    act(() => result.current.onBodyHtmlChange('<p>hi</p>'));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.content).toContain('output: message');
    expect(body.content).toContain('hi');
  });

  it('falls back to raw mode when ingress YAML is invalid', () => {
    const broken = '---\n::: not yaml :::\n---\n\nBody\n';
    const { result } = renderHook(() =>
      useFrontmatterEditor({
        documentId: 'doc-1',
        initialContent: broken,
        docType: 'workflow',
        canEdit: true,
      }),
    );
    expect(result.current.panelState.mode).toBe('raw');
    expect(result.current.panelState.rawYaml).toBe('::: not yaml :::');
    expect(result.current.panelState.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run src/components/frontmatter/__tests__/use-frontmatter-editor.test.ts
```
Expected: FAIL (hook module not found).

- [ ] **Step 3: Implement `use-frontmatter-editor.ts`**

Create `src/components/frontmatter/use-frontmatter-editor.ts`:

```ts
'use client';

// useFrontmatterEditor — React hook that owns the split/join/save lifecycle
// for a typed document. Lifts the ad-hoc debounce blocks out of
// document-editor.tsx and workflow-detail-tabs.tsx into one module.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import TurndownService from 'turndown';
import yaml from 'js-yaml';

import {
  splitFrontmatter,
  joinFrontmatter,
  emitSchemaYaml,
} from '@/lib/frontmatter/markdown';
import { getSchema } from '@/lib/frontmatter/schemas';
import type { FrontmatterSchema } from '@/lib/frontmatter/schemas/types';

const DEBOUNCE_MS = 500;

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface PanelState {
  schema: FrontmatterSchema | null;
  /** Validated value when mode='fields'. May be empty object when mode='raw'. */
  value: Record<string, unknown>;
  rawYaml: string | null;
  mode: 'fields' | 'raw';
  error: string | null;
}

interface Params {
  documentId: string;
  initialContent: string;
  docType: string | null;
  canEdit: boolean;
}

export function useFrontmatterEditor(params: Params) {
  const { documentId, initialContent, docType, canEdit } = params;
  const schema = useMemo(() => getSchema(docType), [docType]);

  const split = useMemo(() => splitFrontmatter(initialContent), [initialContent]);

  const initialPanel = useMemo<PanelState>(() => initialPanelState(split.frontmatterText, schema), [split.frontmatterText, schema]);

  const [panelState, setPanelState] = useState<PanelState>(initialPanel);
  const panelRef = useRef(panelState);
  panelRef.current = panelState;

  const initialHtml = useMemo(() => marked.parse(split.body, { async: false }) as string, [split.body]);
  const latestBodyHtml = useRef(initialHtml);

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const pending = useRef<Record<string, unknown>>({});
  const dirtyContent = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    const body = { ...pending.current };
    pending.current = {};
    timer.current = null;

    if (dirtyContent.current) {
      const bodyMd = turndown.turndown(latestBodyHtml.current);
      const panel = panelRef.current;
      const content = buildContent(panel, bodyMd);
      body.content = content;
      dirtyContent.current = false;
    }

    if (Object.keys(body).length === 0) return;

    setSaveState('saving');
    try {
      const res = await fetch(`/api/brain/documents/${documentId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveState('saved');
    } catch (err) {
      console.error('[useFrontmatterEditor] save failed', err);
      setSaveState('error');
    }
  }, [documentId]);

  const schedule = useCallback(
    (patch: Record<string, unknown>, touchContent: boolean) => {
      pending.current = { ...pending.current, ...patch };
      if (touchContent) dirtyContent.current = true;
      setSaveState('pending');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { void flush(); }, DEBOUNCE_MS);
    },
    [flush],
  );

  const onPanelChange = useCallback(
    (patch: Record<string, unknown>) => {
      setPanelState((prev) => ({ ...prev, value: { ...prev.value, ...patch } }));
      schedule({}, /* touchContent */ true);
    },
    [schedule],
  );

  const onRawChange = useCallback(
    (rawYaml: string) => {
      // Attempt to re-parse back into fields silently; leave mode as-is.
      let parsed: Record<string, unknown> = panelRef.current.value;
      let error: string | null = null;
      try {
        const y = yaml.load(rawYaml) as unknown;
        if (schema) {
          const r = schema.validate(y);
          if (r.ok) parsed = r.value;
          else error = r.errors.map((e) => `${e.field}: ${e.message}`).join('; ');
        } else if (y && typeof y === 'object') {
          parsed = y as Record<string, unknown>;
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      setPanelState((prev) => ({ ...prev, rawYaml, value: parsed, error }));
      schedule({}, /* touchContent */ true);
    },
    [schedule, schema],
  );

  const onModeChange = useCallback(
    (mode: 'fields' | 'raw') => {
      setPanelState((prev) => {
        // Moving to raw: serialise current value to YAML so the textarea starts from a clean state.
        if (mode === 'raw' && prev.schema) {
          return { ...prev, mode, rawYaml: emitSchemaYaml(prev.value, prev.schema) };
        }
        return { ...prev, mode };
      });
    },
    [],
  );

  const onBodyHtmlChange = useCallback(
    (html: string) => {
      latestBodyHtml.current = html;
      schedule({}, /* touchContent */ true);
    },
    [schedule],
  );

  /** For non-frontmatter fields (title, status, …). */
  const onFieldPatch = useCallback(
    (patch: Record<string, unknown>) => {
      schedule(patch, /* touchContent */ false);
    },
    [schedule],
  );

  // Flush on unmount.
  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void flush();
      }
    };
  }, [flush]);

  return {
    initialHtml,
    panelState,
    canEdit,
    saveState,
    onPanelChange,
    onRawChange,
    onModeChange,
    onBodyHtmlChange,
    onFieldPatch,
  };
}

// --- helpers -------------------------------------------------------------

function initialPanelState(
  frontmatterText: string | null,
  schema: FrontmatterSchema | null,
): PanelState {
  if (!schema) {
    return { schema, value: {}, rawYaml: frontmatterText ?? '', mode: 'raw', error: null };
  }

  if (frontmatterText == null) {
    return { schema, value: schema.defaults(), rawYaml: null, mode: 'fields', error: null };
  }

  try {
    const parsed = yaml.load(frontmatterText) as unknown;
    const r = schema.validate(parsed);
    if (r.ok) {
      return { schema, value: r.value, rawYaml: null, mode: 'fields', error: null };
    }
    return {
      schema,
      value: schema.defaults(),
      rawYaml: frontmatterText,
      mode: 'raw',
      error: r.errors.map((e) => `${e.field}: ${e.message}`).join('; '),
    };
  } catch (e) {
    return {
      schema,
      value: schema.defaults(),
      rawYaml: frontmatterText,
      mode: 'raw',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function buildContent(panel: PanelState, bodyMd: string): string {
  if (!panel.schema) {
    // No schema → emit whatever the user typed in raw mode verbatim (if any).
    if (panel.rawYaml && panel.rawYaml.trim().length > 0) {
      return `---\n${panel.rawYaml}\n---\n\n${bodyMd}`;
    }
    return bodyMd;
  }
  if (panel.mode === 'raw' && panel.rawYaml != null) {
    // Raw mode: preserve exact bytes the user typed.
    return `---\n${panel.rawYaml}\n---\n\n${bodyMd}`;
  }
  return joinFrontmatter(panel.value, bodyMd, panel.schema);
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run src/components/frontmatter/__tests__/use-frontmatter-editor.test.ts
```
Expected: all 4 tests PASS.

- [ ] **Step 5: Full frontmatter-module regression**

```bash
npx vitest run src/lib/frontmatter src/components/frontmatter
```
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/frontmatter/use-frontmatter-editor.ts src/components/frontmatter/__tests__/use-frontmatter-editor.test.ts
git commit -m "feat(frontmatter): useFrontmatterEditor hook — split/join/save lifecycle"
```

---

## Task 5: Wire `FrontmatterPanel` into the brain `DocumentEditor`

**Files:**
- Modify: `src/components/brain/document-editor.tsx`

- [ ] **Step 1: Read the current shape**

Open `src/components/brain/document-editor.tsx` with the Read tool. It is ~252 lines. Note the module-scope `DEBOUNCE_MS` and `turndown` constants and the `flush` / `schedule` / `onFrontmatterChange` / `onHtmlUpdate` blocks — these are what Task 4's hook replaces.

- [ ] **Step 2: Rewrite the file to use the hook + panel**

Replace the entire file with:

```tsx
'use client';

// Brain document editor. Now delegates all save/debounce/markdown-split
// plumbing to useFrontmatterEditor; this file is the layout + wiring.

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckIcon, LoaderIcon, XIcon, XCircleIcon } from 'lucide-react';

import { TiptapEditor } from '@/components/editor/tiptap-editor';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import {
  FrontmatterSidebar,
  type FrontmatterValue,
} from './frontmatter-sidebar';
import { FrontmatterPanel } from '@/components/frontmatter/frontmatter-panel';
import {
  useFrontmatterEditor,
  type SaveState,
} from '@/components/frontmatter/use-frontmatter-editor';

interface DocumentData {
  id: string;
  title: string;
  content: string;
  status: 'draft' | 'active' | 'archived';
  confidenceLevel: 'high' | 'medium' | 'low';
  ownerId: string | null;
  /** Denormalised documents.type — drives schema selection. Pass null for plain docs. */
  type: string | null;
}

interface UserOption {
  id: string;
  label: string;
}

interface Props {
  document: DocumentData;
  owners: UserOption[];
}

export function DocumentEditor({ document, owners }: Props) {
  const router = useRouter();

  const [frontmatter, setFrontmatter] = useState<FrontmatterValue>({
    title: document.title,
    status: document.status,
    confidenceLevel: document.confidenceLevel,
    ownerId: document.ownerId,
  });

  const editor = useFrontmatterEditor({
    documentId: document.id,
    initialContent: document.content,
    docType: document.type,
    canEdit: true,
  });

  const onFrontmatterChange = useCallback(
    (patch: Partial<FrontmatterValue>) => {
      setFrontmatter((prev) => ({ ...prev, ...patch }));
      editor.onFieldPatch(patch);
    },
    [editor],
  );

  const breadcrumb = [
    { label: 'Brain', href: '/brain' },
    { label: frontmatter.title || 'Untitled' },
  ];

  return (
    <>
      <div className="topbar">
        <nav className="crumbs" aria-label="Breadcrumb">
          {breadcrumb.map((c, i) => {
            const isLast = i === breadcrumb.length - 1;
            return (
              <span key={i} className={isLast ? 'cur' : undefined}>
                {c.href && !isLast ? <Link href={c.href}>{c.label}</Link> : c.label}
                {!isLast && <span> / </span>}
              </span>
            );
          })}
        </nav>
        <div className="topbar-spacer" />
        <div className="flex items-center gap-3 text-xs">
          <SaveIndicator state={editor.saveState} />
        </div>
        <Link
          href={`/brain/${document.id}`}
          className="icon-btn"
          title="Close editor"
          aria-label="Close editor"
        >
          <XIcon className="size-4" />
        </Link>
        <ThemeToggle />
      </div>

      <div className="mx-auto w-full max-w-6xl px-6 py-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0 rounded-lg border border-border bg-background p-6">
            <input
              type="text"
              value={frontmatter.title}
              onChange={(e) => onFrontmatterChange({ title: e.target.value })}
              placeholder="Untitled"
              className="mb-4 w-full border-0 bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground"
            />
            <TiptapEditor
              initialContent={editor.initialHtml}
              placeholder="Start writing…"
              onUpdate={editor.onBodyHtmlChange}
            />
            <button
              type="button"
              onClick={() => router.push(`/brain/${document.id}`)}
              className="sr-only"
            >
              Done
            </button>
          </div>

          <div className="space-y-4">
            {editor.panelState.schema && (
              <FrontmatterPanel
                schema={editor.panelState.schema}
                value={editor.panelState.value}
                rawYaml={editor.panelState.rawYaml}
                mode={editor.panelState.mode}
                canEdit={editor.canEdit}
                onFieldsChange={editor.onPanelChange}
                onRawChange={editor.onRawChange}
                onModeChange={editor.onModeChange}
                error={editor.panelState.error}
              />
            )}
            <FrontmatterSidebar
              value={frontmatter}
              owners={owners}
              onChange={onFrontmatterChange}
            />
          </div>
        </div>
      </div>
    </>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  switch (state) {
    case 'idle':
      return <span className="text-muted-foreground">Ready</span>;
    case 'pending':
      return <span className="text-muted-foreground">Editing…</span>;
    case 'saving':
      return (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <LoaderIcon className="size-3 animate-spin" />
          Saving…
        </span>
      );
    case 'saved':
      return (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <CheckIcon className="size-3" />
          Saved
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center gap-1 text-destructive">
          <XCircleIcon className="size-3" />
          Failed to save
        </span>
      );
  }
}
```

- [ ] **Step 3: Update the caller to pass `type`**

Open `src/app/(app)/brain/[documentId]/edit/page.tsx`. In the Drizzle `select`, add `type: documents.type`. In the `<DocumentEditor document={doc} …>` render, that field is now part of `doc` — no other change needed.

Change the select block at lines 35-42 to:

```ts
    .select({
      id: documents.id,
      title: documents.title,
      content: documents.content,
      status: documents.status,
      confidenceLevel: documents.confidenceLevel,
      ownerId: documents.ownerId,
      type: documents.type,
    })
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors. If Drizzle complains about `type` not being assignable to the interface, ensure `DocumentData.type` is `string | null` (matches the DB column).

- [ ] **Step 5: Lint**

```bash
npm run lint
```
Expected: pass.

- [ ] **Step 6: Run the full test suite**

```bash
npx vitest run
```
Expected: all tests still pass. Nothing was test-depending on the removed helpers.

- [ ] **Step 7: Commit**

```bash
git add src/components/brain/document-editor.tsx src/app/(app)/brain/[documentId]/edit/page.tsx
git commit -m "refactor(brain): use useFrontmatterEditor + FrontmatterPanel"
```

---

## Task 6: Wire into `WorkflowDetailTabs.DefinitionEditor` + delete `WorkflowFrontmatterFields`

**Files:**
- Modify: `src/components/workflows/workflow-detail-tabs.tsx`
- Delete: `src/components/workflows/workflow-frontmatter-fields.tsx`
- Modify: `src/app/(app)/workflows/[slug]/page.tsx` (drop the `frontmatter` prop)

- [ ] **Step 1: Replace `DefinitionEditor` internals with the hook + panel**

Rewrite the `DefinitionEditor` function in `src/components/workflows/workflow-detail-tabs.tsx` (lines 102–218) to:

```tsx
function DefinitionEditor({
  document,
  docType,
  canEdit,
}: {
  document: DocumentData;
  docType: string | null;
  canEdit: boolean;
}) {
  const [title, setTitle] = useState(document.title);

  const editor = useFrontmatterEditor({
    documentId: document.id,
    initialContent: document.content,
    docType,
    canEdit,
  });

  const onTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setTitle(e.target.value);
      editor.onFieldPatch({ title: e.target.value });
    },
    [editor],
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 rounded-lg border border-border bg-background p-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            {canEdit ? (
              <input
                type="text"
                value={title}
                onChange={onTitleChange}
                placeholder="Untitled"
                className="flex-1 border-0 bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground"
              />
            ) : (
              <h1 className="flex-1 text-2xl font-semibold tracking-tight">{title}</h1>
            )}
            <SaveIndicator state={editor.saveState} />
          </div>

          {canEdit ? (
            <TiptapEditor
              initialContent={editor.initialHtml}
              placeholder="Describe what this workflow should do…"
              onUpdate={editor.onBodyHtmlChange}
            />
          ) : (
            <pre className="whitespace-pre-wrap text-sm text-ink">{document.content}</pre>
          )}
        </div>

        {editor.panelState.schema ? (
          <FrontmatterPanel
            schema={editor.panelState.schema}
            value={editor.panelState.value}
            rawYaml={editor.panelState.rawYaml}
            mode={editor.panelState.mode}
            canEdit={canEdit}
            onFieldsChange={editor.onPanelChange}
            onRawChange={editor.onRawChange}
            onModeChange={editor.onModeChange}
            error={editor.panelState.error}
          />
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update the imports + outer `WorkflowDetailTabs`**

At the top of `workflow-detail-tabs.tsx`:

Remove these imports:
```ts
import { marked } from 'marked';
import TurndownService from 'turndown';
import { WorkflowFrontmatterFields } from './workflow-frontmatter-fields';
import type { WorkflowFrontmatterValue } from './workflow-frontmatter-fields';
```

Add:
```ts
import { FrontmatterPanel } from '@/components/frontmatter/frontmatter-panel';
import {
  useFrontmatterEditor,
  type SaveState,
} from '@/components/frontmatter/use-frontmatter-editor';
```

Delete the module-scope `DEBOUNCE_MS` and `turndown` constants (unused now).

Update the outer `Props`:

```ts
interface Props {
  document: DocumentData;
  runs: RunRow[];
  workflowSlug: string;
  docType: string | null;  // replaces `frontmatter`
  canEdit: boolean;
  activeTab: 'definition' | 'runs';
}
```

And in the `WorkflowDetailTabs` render:

```tsx
{activeTab === 'definition' ? (
  <div className="flex-1 overflow-auto">
    <DefinitionEditor document={document} docType={docType} canEdit={canEdit} />
  </div>
) : (
  <div className="flex-1 overflow-auto px-6 py-6">
    <RunHistoryTable runs={runs} workflowSlug={workflowSlug} />
  </div>
)}
```

- [ ] **Step 3: Update `workflows/[slug]/page.tsx`**

In `src/app/(app)/workflows/[slug]/page.tsx`:

- Remove the `frontmatter` construction block (the `const meta = (row.metadata ?? {}) as …` block and the `const frontmatter = { … }` that follows it — lines 83–96).
- Remove `frontmatter={frontmatter}` from the `<WorkflowDetailTabs …>` call.
- Add `docType={row.type}` to the same call.
- Ensure `type: documents.type` is in the select — it already is at line 53.

- [ ] **Step 4: Delete the orphaned component**

```bash
git rm src/components/workflows/workflow-frontmatter-fields.tsx
```

- [ ] **Step 5: Type-check + lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: no errors. If a stray import of `WorkflowFrontmatterValue` survives somewhere, remove it.

- [ ] **Step 6: Full test suite**

```bash
npx vitest run
```
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/workflows/workflow-detail-tabs.tsx src/app/(app)/workflows/[slug]/page.tsx
git commit -m "refactor(workflow): replace read-only sidebar with editable FrontmatterPanel"
```

---

## Task 7: Update `NewWorkflowForm` to use the schema

**Files:**
- Modify: `src/components/workflows/new-workflow-form.tsx`

- [ ] **Step 1: Rewrite the relevant sections**

Replace the `WORKFLOW_FRONTMATTER` string constant (lines 41–47) and the content-composition logic in `onSubmit` (lines 99–103) as follows:

Imports to add:
```ts
import { workflowSchema } from '@/lib/frontmatter/schemas/workflow';
import { joinFrontmatter } from '@/lib/frontmatter/markdown';
```

Import to remove: the `WORKFLOW_FRONTMATTER` constant declaration.

Replace the body-composition block in `onSubmit`:

```ts
// Old:
// const bodyMd = htmlRef.current ? turndown.turndown(htmlRef.current) : WORKFLOW_BODY_PLACEHOLDER;
// const content = WORKFLOW_FRONTMATTER + '\n\n' + bodyMd;

// New:
const bodyMd = htmlRef.current
  ? turndown.turndown(htmlRef.current)
  : WORKFLOW_BODY_PLACEHOLDER;
const content = joinFrontmatter(workflowSchema.defaults(), bodyMd, workflowSchema);
```

- [ ] **Step 2: Type-check + lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: pass. No unused imports.

- [ ] **Step 3: Regression — server POST path**

No dedicated test here. Task 1's markdown tests already cover byte-stability of the `joinFrontmatter` output, and Task 9's end-to-end shakedown exercises the full create-a-workflow-and-run-it flow against the real dev server. If you want extra confidence before Task 9, eyeball the bytes by creating a workflow in the dev UI and dumping `documents.content` via the Supabase table editor.

- [ ] **Step 4: Commit**

```bash
git add src/components/workflows/new-workflow-form.tsx
git commit -m "refactor(workflow): seed new workflows via workflowSchema.defaults"
```

---

## Task 8: One-off migration script for corrupted workflow docs

**Files:**
- Create: `scripts/lib/repair-frontmatter.ts` — pure helpers (no DB imports), unit-tested.
- Create: `scripts/migrate-repair-frontmatter.ts` — CLI entry that imports the helpers + connects to the DB.
- Create: `scripts/__tests__/repair-frontmatter.test.ts`

The script finds every `documents` row where `type IS NULL` but `metadata ? 'requires_mcps'` (our corruption signature — the PATCH sync preserved metadata but the type column got wiped). For each, it loads the earliest `document_versions` row, checks that v1's content has a valid workflow frontmatter, checks that the v1 body (after stripping the old frontmatter block) matches the current body (after stripping the corrupted preamble) up to whitespace, and if so restores `content`/`type`/`metadata` from the v1 snapshot.

**Why split helpers into `scripts/lib/`:** the existing scripts in `scripts/` (e.g. `backfill-document-type.ts`) call `main()` at the top level and close the pg client in `.finally()`. Importing from such a script in a test would execute `main()` — connecting to a DB and hanging tests. Keeping the helpers in a DB-free lib module lets tests import them without dragging in `src/db`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/__tests__/repair-frontmatter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  bodiesEquivalent,
  isCorruptedWorkflowDoc,
  extractWorkflowFromVersion1,
} from '../lib/repair-frontmatter';

describe('bodiesEquivalent', () => {
  it('treats whitespace-only differences as equal', () => {
    expect(bodiesEquivalent('Hello\n\nworld\n', '  Hello\n  world  \n')).toBe(true);
  });
  it('rejects real content differences', () => {
    expect(bodiesEquivalent('Hello\n', 'Goodbye\n')).toBe(false);
  });
});

describe('isCorruptedWorkflowDoc', () => {
  it('detects the canonical corruption shape', () => {
    expect(
      isCorruptedWorkflowDoc({
        type: null,
        metadata: { requires_mcps: [], output: 'document' },
      }),
    ).toBe(true);
  });
  it('ignores healthy workflow docs', () => {
    expect(
      isCorruptedWorkflowDoc({
        type: 'workflow',
        metadata: { requires_mcps: [], output: 'document' },
      }),
    ).toBe(false);
  });
  it('ignores plain untyped docs', () => {
    expect(isCorruptedWorkflowDoc({ type: null, metadata: {} })).toBe(false);
  });
});

describe('extractWorkflowFromVersion1', () => {
  it('returns the v1 content and parsed frontmatter when valid', () => {
    const v1 =
      '---\ntype: workflow\noutput: document\noutput_category: null\nrequires_mcps: []\nschedule: null\n---\n\nBody.\n';
    const got = extractWorkflowFromVersion1(v1);
    expect(got).not.toBeNull();
    expect(got!.type).toBe('workflow');
    expect(got!.metadata.output).toBe('document');
    expect(got!.body).toBe('Body.\n');
  });
  it('returns null when v1 has no frontmatter', () => {
    expect(extractWorkflowFromVersion1('# heading\n')).toBeNull();
  });
  it('returns null when v1 frontmatter is not a workflow', () => {
    expect(
      extractWorkflowFromVersion1('---\ntype: skill\n---\n\nBody\n'),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run scripts/__tests__/repair-frontmatter.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the pure helpers**

Create `scripts/lib/repair-frontmatter.ts` — DB-free, test-importable:

```ts
// scripts/lib/repair-frontmatter.ts
//
// Pure helpers for the migrate-repair-frontmatter script. No DB imports
// here — this module is safe to import from tests without spinning up
// postgres. The CLI entrypoint (../migrate-repair-frontmatter.ts)
// composes these with the DB layer.

import yaml from 'js-yaml';
import { splitFrontmatter } from '../../src/lib/frontmatter/markdown';
import { validateWorkflowFrontmatter } from '../../src/lib/brain/frontmatter';

export interface DocRow {
  type: string | null;
  metadata: Record<string, unknown> | null;
}

/** A doc is "corrupted" when its type is null but metadata still carries workflow fields. */
export function isCorruptedWorkflowDoc(row: DocRow): boolean {
  if (row.type !== null) return false;
  const meta = row.metadata ?? {};
  return Object.prototype.hasOwnProperty.call(meta, 'requires_mcps');
}

/** Compare two bodies with whitespace flattened, so migration doesn't block on formatting drift. */
export function bodiesEquivalent(a: string, b: string): boolean {
  return normalise(a) === normalise(b);
}

function normalise(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export interface V1Workflow {
  type: 'workflow';
  content: string; // full file, unchanged — safe to write back verbatim
  body: string;
  metadata: {
    output: 'document' | 'message' | 'both';
    output_category: string | null;
    requires_mcps: string[];
    schedule: string | null;
  };
}

/** Extract a validated workflow shape from a document_versions v1 content snapshot. */
export function extractWorkflowFromVersion1(content: string): V1Workflow | null {
  const { frontmatterText, body } = splitFrontmatter(content);
  if (frontmatterText == null) return null;

  let parsed: unknown;
  try {
    parsed = yaml.load(frontmatterText);
  } catch {
    return null;
  }
  const r = validateWorkflowFrontmatter(parsed);
  if (!r.ok) return null;
  return {
    type: 'workflow',
    content,
    body,
    metadata: {
      output: r.value.output,
      output_category: r.value.output_category,
      requires_mcps: r.value.requires_mcps,
      schedule: r.value.schedule,
    },
  };
}
```

- [ ] **Step 4: Implement the CLI entry**

Create `scripts/migrate-repair-frontmatter.ts` — matches the existing `backfill-document-type.ts` pattern (top-level imports, unconditional `main()`, `pgClient.end()` in `.finally`):

```ts
/**
 * One-off migration. Restores documents.type + metadata + content for
 * workflow docs whose frontmatter got flattened by the Tiptap round-trip
 * bug (fixed in the Frontmatter Editor change). Idempotent: docs whose
 * type is already set are skipped.
 *
 * Usage:
 *   npx tsx scripts/migrate-repair-frontmatter.ts --dry-run
 *   npx tsx scripts/migrate-repair-frontmatter.ts --apply
 *
 * Requires DATABASE_URL in the environment (dotenv picks it up).
 */

import 'dotenv/config';
import { asc, eq, isNull, sql } from 'drizzle-orm';

import { db, pgClient } from '../src/db';
import { documents, documentVersions } from '../src/db/schema';
import { splitFrontmatter } from '../src/lib/frontmatter/markdown';
import {
  bodiesEquivalent,
  extractWorkflowFromVersion1,
  isCorruptedWorkflowDoc,
} from './lib/repair-frontmatter';

async function main(): Promise<void> {
  const dryRun = !process.argv.includes('--apply');
  console.log(`[migrate-repair-frontmatter] ${dryRun ? 'DRY-RUN' : 'APPLY'}`);

  const candidates = await db
    .select({
      id: documents.id,
      content: documents.content,
      type: documents.type,
      metadata: documents.metadata,
    })
    .from(documents)
    .where(isNull(documents.type));

  let repaired = 0;
  let skippedNotCorrupt = 0;
  let skippedSubstantive = 0;
  let skippedNoV1 = 0;

  for (const row of candidates) {
    if (
      !isCorruptedWorkflowDoc({
        type: row.type,
        metadata: row.metadata as Record<string, unknown> | null,
      })
    ) {
      skippedNotCorrupt += 1;
      continue;
    }

    const [v1] = await db
      .select({ content: documentVersions.content })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, row.id))
      .orderBy(asc(documentVersions.versionNumber))
      .limit(1);

    if (!v1) {
      skippedNoV1 += 1;
      continue;
    }

    const extracted = extractWorkflowFromVersion1(v1.content);
    if (!extracted) {
      skippedNoV1 += 1;
      continue;
    }

    const currentBody = splitFrontmatter(row.content).body;
    if (!bodiesEquivalent(currentBody, extracted.body)) {
      console.warn(`[skip:substantive] ${row.id}`);
      skippedSubstantive += 1;
      continue;
    }

    console.log(`[restore] ${row.id}`);
    if (!dryRun) {
      await db
        .update(documents)
        .set({
          content: extracted.content,
          type: 'workflow',
          metadata: {
            ...((row.metadata as Record<string, unknown>) ?? {}),
            ...extracted.metadata,
          },
          updatedAt: sql`now()`,
        })
        .where(eq(documents.id, row.id));
    }
    repaired += 1;
  }

  console.log(
    `[migrate-repair-frontmatter] done: repaired=${repaired} skippedNotCorrupt=${skippedNotCorrupt} skippedNoV1=${skippedNoV1} skippedSubstantive=${skippedSubstantive}`,
  );
}

main()
  .catch((err) => {
    console.error('[migrate-repair-frontmatter] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pgClient.end();
  });
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
npx vitest run scripts/__tests__/repair-frontmatter.test.ts
```
Expected: all 8 tests PASS (2 for `bodiesEquivalent`, 3 for `isCorruptedWorkflowDoc`, 3 for `extractWorkflowFromVersion1`). The test imports **only** the pure-helper module (`../lib/repair-frontmatter`), so no `main()` fires and no DB connection is attempted.

- [ ] **Step 6: Dry-run against the real DB**

```bash
cd C:/Code/locus/locus-web/.worktrees/workflows
npx tsx scripts/migrate-repair-frontmatter.ts --dry-run
```
Expected: prints `[restore] 3a80cbe0-e5ce-496d-a620-b9e88bb7783b` plus any other corrupted docs; summary line reports `repaired=N skippedNotCorrupt=M …`. NO DB writes happen.

- [ ] **Step 7: Apply the migration**

```bash
npx tsx scripts/migrate-repair-frontmatter.ts --apply
```
Expected: same `[restore]` lines, followed by the summary. Verify with a quick SQL check via the Supabase MCP or `psql`:
```sql
SELECT id, type, metadata->>'output' FROM documents WHERE id = '3a80cbe0-e5ce-496d-a620-b9e88bb7783b';
```
Expected: `type = 'workflow'`, `output = 'document'`.

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/repair-frontmatter.ts scripts/migrate-repair-frontmatter.ts scripts/__tests__/repair-frontmatter.test.ts
git commit -m "chore(workflow): one-off migration to repair Tiptap-corrupted frontmatter"
```

---

## Task 9: End-to-end shakedown + regression test

Automate the exact bug we set out to fix: create → load → edit body → save → reload → confirm `type`/metadata intact.

**Files:**
- Create: `src/lib/frontmatter/__tests__/integration.round-trip.test.ts` (uses vitest + the helpers; no real HTTP, no real DB — simulates the Tiptap path)

- [ ] **Step 1: Write the regression test**

Create `src/lib/frontmatter/__tests__/integration.round-trip.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { marked } from 'marked';
import TurndownService from 'turndown';

import { splitFrontmatter, joinFrontmatter } from '../markdown';
import { workflowSchema } from '../schemas/workflow';
import { extractDocumentTypeFromContent } from '@/lib/brain/save';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

describe('Tiptap round-trip regression', () => {
  const pristine =
    '---\ntype: workflow\noutput: document\noutput_category: null\nrequires_mcps: []\nschedule: null\n---\n\nDescribe the workflow here.\n';

  it('OLD (broken) path: marked+turndown destroys frontmatter', () => {
    // Prove the bug exists when we DON'T split first.
    const html = marked.parse(pristine, { async: false }) as string;
    const md = turndown.turndown(html);
    expect(extractDocumentTypeFromContent(md)).toBeNull();
  });

  it('NEW (split+join) path: frontmatter survives the same round-trip', () => {
    const { frontmatterText, body } = splitFrontmatter(pristine);
    expect(frontmatterText).not.toBeNull();

    // Simulate Tiptap: marked → edit body in HTML → turndown.
    const html = marked.parse(body, { async: false }) as string;
    const editedHtml = html + '<p>new paragraph</p>';
    const newBodyMd = turndown.turndown(editedHtml);

    const value = workflowSchema.defaults();
    const rejoined = joinFrontmatter(value, newBodyMd, workflowSchema);

    expect(extractDocumentTypeFromContent(rejoined)).toBe('workflow');
    expect(rejoined).toContain('new paragraph');
  });

  it('is byte-stable when nothing in the frontmatter changes', () => {
    const { frontmatterText, body } = splitFrontmatter(pristine);
    const rejoined = joinFrontmatter(workflowSchema.defaults(), body, workflowSchema);
    expect(rejoined).toBe(pristine);
    // extra sanity: the rejoined file also parses cleanly.
    expect(splitFrontmatter(rejoined).frontmatterText).toBe(frontmatterText);
  });
});
```

- [ ] **Step 2: Run — confirm green**

```bash
npx vitest run src/lib/frontmatter/__tests__/integration.round-trip.test.ts
```
Expected: all 3 tests PASS. The "OLD path" test is not a regression check — it's executable documentation that the bug is real. It will PASS because it asserts the broken behaviour.

- [ ] **Step 3: Manual shakedown in dev server**

```bash
cd C:/Code/locus/locus-web/.worktrees/workflows
npm run dev
```

Walk through these steps in the browser:
1. Sign in; navigate to `/workflows/new`.
2. Enter title `Shakedown workflow`; description `Test description.`; Create & edit.
3. Land on `/workflows/<slug>`. Confirm the FrontmatterPanel shows `output: document`, empty MCPs, and a "View raw YAML" toggle.
4. Edit the body — add a new paragraph. Wait ~1s for "Saved".
5. Change `output` in the panel to `message`. Wait ~1s. "Saved".
6. Reload the page. Confirm: panel still shows `output: message`, body preserves your edits, the frontmatter block is still present (verify via the Supabase table editor or `SELECT content FROM documents WHERE slug = 'shakedown-workflow'`).
7. Click the "Run" button. Confirm it does NOT return `workflow_not_found` (the original bug). It should start a run and land on the run view.
8. Open the repaired workflow from Task 8 (slug for `3a80cbe0…`). Confirm the panel loads normally and Run works.

- [ ] **Step 4: Full test suite one more time**

```bash
npx vitest run
npx tsc --noEmit
npm run lint
```
Expected: everything green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/frontmatter/__tests__/integration.round-trip.test.ts
git commit -m "test(frontmatter): regression for Tiptap round-trip preservation"
```

---

## Wrap-up

At this point:

- `documents.content` always leaves the client as a canonical `---\n<yaml>\n---\n\n<body>` file.
- The panel is the authoring surface for frontmatter; Tiptap is body-only.
- The workflow schema is one file; skill and agent-definition schemas plug into the same registry by adding their own file + one line in `schemas/index.ts`.
- `3a80cbe0-e5ce-496d-a620-b9e88bb7783b` and peers are repaired.
- Server PATCH path is unchanged and remains authoritative as defence-in-depth.

Final lint/type pass and a branch-ready log:

```bash
npx vitest run
npx tsc --noEmit
npm run lint
git log --oneline -15
```

---

*End of plan. Tasks are independent enough to dispatch a fresh subagent per task; Tasks 5 and 6 both touch UI that uses the hook from Task 4, but they're orthogonal files and can run in either order.*
