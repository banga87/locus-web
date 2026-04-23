# Frontmatter Editor — Design Spec

**Date:** 2026-04-17
**Status:** Draft for review
**Predecessor:** [`2026-04-16-workflows-design.md`](./2026-04-16-workflows-design.md) — first surface that requires this primitive

---

## 1. Summary

Tatara stores typed documents (`type: workflow`, future `type: skill`, `type: agent-definition`, etc.) as **markdown files with YAML frontmatter**. Frontmatter carries the fields agents read at runtime (workflow `output`/`requires_mcps`, skill `allowed-tools`, and so on). The current rich-text editor (Tiptap with marked→HTML on load and Turndown→markdown on save) is hostile to frontmatter: marked interprets `---` as `<hr>`, flattens the YAML block into a heading, and Turndown re-serialises the result as prose (`* * *\n\n## type: workflow output: document …`). A single autosave destroys the frontmatter. On reload, the server re-parses the corrupted content and clears `documents.type`, after which the trigger route 404s on “workflow_not_found”.

This spec defines a **Frontmatter Editor primitive**: a schema-aware panel for structured frontmatter fields paired with a body-only Tiptap surface. Frontmatter is stripped before load and reassembled at save. A `FrontmatterSchema` registry (keyed on `documents.type`) lets every current and future typed document plug in the same surface with its own field set. Markdown-on-disk stays canonical: `---\n<yaml>\n---\n\n<body>`.

## 2. Philosophy

Two principles drive the design.

**Markdown-first.** Per memory `feedback_markdown_first.md`, content and definitions live in markdown + YAML; operational state gets its own tables. Frontmatter is content. It stays in the file. We don't split it into a `documents.frontmatter` jsonb column; the server keeps deriving `type` and metadata from content on every write.

**Structured edits, not YAML poetry.** The SKILL.md precedent is instructive: skill authors edit YAML in plain-text editors because that's what they already have. We have a rich-text editor. The equivalent is **not** "make Tiptap tolerate YAML," it is **"give frontmatter its own authoring surface that can never corrupt it."** Users edit typed fields through form controls; a raw-YAML escape hatch handles edge cases (unregistered types, schema drift, copy-paste from elsewhere).

## 3. Scope

### In scope

1. **FrontmatterSchema registry.** Keyed on `documents.type`. Declares field list, types, validation, and labels for each registered doc type. Workflow is the first consumer.
2. **FrontmatterPanel component.** Renders a form for a given schema value; emits typed patches. Always-visible "View raw YAML" toggle opens an inline YAML code editor on the same panel, with validation.
3. **Body-only Tiptap surface.** Frontmatter stripped before marked converts to HTML; Tiptap never sees `---` fences. Save reassembles `panelYaml + '\n\n' + turndown(body)`.
4. **PATCH contract update.** Client sends canonical markdown (frontmatter + body). Server-side PATCH frontmatter-sync path is unchanged — it keeps validating and mirroring into `metadata` + `type`, now as defence-in-depth rather than the only line of defence.
5. **Workflow integration.** The existing `WorkflowFrontmatterFields` (read-only sidebar) is replaced by the new `FrontmatterPanel` wired to the workflow schema. `new-workflow-form.tsx` starts a new doc with schema defaults rather than a literal YAML string.
6. **Migration: repair corrupted docs.** One-off script to identify docs where `documents.type IS NULL` but an earlier `document_versions` row had valid frontmatter, and restore `content` + `type` + `metadata` from that snapshot.
7. **Tests.** Frontmatter panel round-trip (bytes stable when unchanged), body-only Tiptap round-trip (frontmatter preserved across save), schema-registry dispatch, migration dry-run.

### Out of scope

- Replacing the marked/turndown body pipeline (Approach B). Pre-existing body-pipeline imperfections (tables, raw HTML, comments) stay as-is.
- Splitting frontmatter into a jsonb column (Approach C). Violates markdown-first.
- Schema UI generation from JSON Schema. Field-def objects are hand-written per type — small surface, explicit is better than magic for v0.
- Collaborative editing / conflict resolution. Single-writer editor, same as today.
- `documents.frontmatter` agent-write tool. Agents today edit `content` directly via `update_document`; the PATCH frontmatter-sync path keeps that working.
- Export / MCP integration changes. External consumers continue to see the same on-disk format; nothing in the MCP layer moves.

## 4. Architecture

```
 ┌──────────────────────────────────────────────────────────────────┐
 │                     Client: Document Editor                      │
 │                                                                  │
 │   on load (server markdown → split) :                            │
 │       splitFrontmatter(content)                                  │
 │          ├──► frontmatterText → parse → schema.validate          │
 │          │         (or raw-YAML mode on failure)                 │
 │          │       └──► FrontmatterPanel state                     │
 │          └──► bodyMarkdown → marked → HTML → Tiptap              │
 │                                                                  │
 │   on save (client → PATCH):                                      │
 │       panelToYaml(panelState, schema)   ──┐                      │
 │       turndown(editor.getHTML())        ──┼── canonical          │
 │                                           │   markdown file      │
 │       joined: `---\n${yaml}\n---\n\n${body}` ──► PATCH content   │
 └──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
 ┌──────────────────────────────────────────────────────────────────┐
 │     Server: PATCH /api/brain/documents/[id] (unchanged shape)    │
 │                                                                  │
 │     content → extractDocumentTypeFromContent → documents.type    │
 │     content → js-yaml.load + validate{type} → documents.metadata │
 │                                                                  │
 │     (Defence-in-depth: client now always sends valid frontmatter,│
 │      but the server stays authoritative in case a non-panel      │
 │      writer — a future agent tool, a direct PATCH — submits      │
 │      content.)                                                   │
 └──────────────────────────────────────────────────────────────────┘
```

## 5. Components

### 5.1 `FrontmatterSchema` (registry)

A pure data module. No DB, no I/O.

```ts
// src/lib/frontmatter/schemas/types.ts
export type FrontmatterField =
  | { kind: 'string'; name: string; label: string; required?: boolean; placeholder?: string }
  | { kind: 'nullable-string'; name: string; label: string; placeholder?: string }
  | { kind: 'enum'; name: string; label: string; options: readonly string[]; required?: boolean }
  | { kind: 'string-array'; name: string; label: string; itemLabel?: string };

export interface FrontmatterSchema {
  /** Exact value of the `type` field. Uniquely identifies the schema. */
  type: string;
  /** Display name shown in the panel header. */
  label: string;
  /** Ordered field list — drives rendering order. */
  fields: readonly FrontmatterField[];
  /** Default value for a brand-new document of this type. */
  defaults: () => Record<string, unknown>;
  /** Full-shape validator — server-side result shape; re-used client-side. */
  validate: (input: unknown) => { ok: true; value: Record<string, unknown> } | { ok: false; errors: Array<{ field: string; message: string }> };
}
```

Workflow schema is defined once and registered in a central map:

```ts
// src/lib/frontmatter/schemas/workflow.ts
import { validateWorkflowFrontmatter } from '@/lib/brain/frontmatter';

export const workflowSchema: FrontmatterSchema = {
  type: 'workflow',
  label: 'Workflow',
  fields: [
    { kind: 'enum', name: 'output', label: 'Output', options: ['document', 'message', 'both'], required: true },
    { kind: 'nullable-string', name: 'output_category', label: 'Category', placeholder: 'Folder slug or leave empty' },
    { kind: 'string-array', name: 'requires_mcps', label: 'Required MCPs', itemLabel: 'MCP slug' },
    { kind: 'nullable-string', name: 'schedule', label: 'Schedule (cron)', placeholder: 'Reserved — manual only' },
  ],
  defaults: () => ({ output: 'document', output_category: null, requires_mcps: [], schedule: null }),
  validate: (input) => {
    const r = validateWorkflowFrontmatter({ type: 'workflow', ...(input as Record<string, unknown>) });
    return r.ok
      ? { ok: true, value: { output: r.value.output, output_category: r.value.output_category, requires_mcps: r.value.requires_mcps, schedule: r.value.schedule } }
      : { ok: false, errors: r.errors };
  },
};

// src/lib/frontmatter/schemas/index.ts
export const schemaRegistry: Record<string, FrontmatterSchema> = {
  workflow: workflowSchema,
  // skill: skillSchema,           // later
  // 'agent-definition': …         // later
};

export function getSchema(type: string | null): FrontmatterSchema | null {
  if (!type) return null;
  return schemaRegistry[type] ?? null;
}
```

### 5.2 `splitFrontmatter` / `joinFrontmatter` (pure helpers)

One module, shared between editor client code and server parsers.

```ts
// src/lib/frontmatter/markdown.ts

export interface SplitResult {
  frontmatterText: string | null;   // the YAML, WITHOUT the --- fences
  body: string;                     // everything after the second ---, with leading blank line trimmed
}

export function splitFrontmatter(content: string): SplitResult;

/**
 * Produces canonical `---\n<yaml>\n---\n\n<body>`.
 * Emits stable key order (fields ordered per the schema) and stable quoting
 * (js-yaml with defaults: no quotes on plain strings, explicit `null`, flow
 * arrays on the single line unless too long).
 * When `frontmatter` is null, returns `body` unchanged.
 */
export function joinFrontmatter(frontmatter: Record<string, unknown> | null, body: string, schema: FrontmatterSchema | null): string;
```

CRLF-safe: the regex is `/^---\r?\n([\s\S]*?)\r?\n---/`, matching the existing PATCH helper.

### 5.3 `FrontmatterPanel` (client component)

One file: `src/components/frontmatter/frontmatter-panel.tsx`. Stateless. Takes:

```ts
interface Props {
  schema: FrontmatterSchema | null;   // null → raw-YAML-only mode
  value: Record<string, unknown>;
  rawYaml: string | null;              // only set when we're in raw mode (ingress parse failed OR user toggled)
  mode: 'fields' | 'raw';
  canEdit: boolean;
  /** Partial merge into `value`. Follows the same convention as the existing onFrontmatterChange in document-editor.tsx. */
  onFieldsChange: (patch: Record<string, unknown>) => void;
  onRawChange: (yaml: string) => void;
  onModeChange: (mode: 'fields' | 'raw') => void;
  error: string | null;
}
```

- `mode: 'fields'` renders typed inputs per `schema.fields`.
- `mode: 'raw'` renders a monospace textarea with live YAML validation (parses on every keystroke; shows parse errors without blocking typing — same silent-skip discipline as the PATCH sync).
- Toggle button is always visible.
- When `schema` is null (unregistered type, or plain knowledge doc), `mode` is forced to `'raw'` and the fields toggle is disabled.

### 5.4 Body-only Tiptap surface

`TiptapEditor` is unchanged. Its callers (`DocumentEditor`, `WorkflowDetailTabs.DefinitionEditor`) change to:

1. On mount: `splitFrontmatter(document.content)` → `initialHtml = marked.parse(split.body)`.
2. On update: `turndown.turndown(html)` → body markdown, composed into a PATCH patch as `{ content: joinFrontmatter(panelState, bodyMd, schema) }`.

This keeps `TiptapEditor` generic and leaves the body-pipeline quirks exactly where they were.

### 5.5 `DocumentEditor` and `WorkflowDetailTabs.DefinitionEditor`

Two call sites, one new shared hook `useFrontmatterEditor` that owns the split state, the panel state, and the save coalescing:

```ts
// src/components/frontmatter/use-frontmatter-editor.ts
function useFrontmatterEditor(params: {
  documentId: string;
  initialContent: string;
  docType: string | null;   // documents.type
  canEdit: boolean;
}): {
  initialHtml: string;
  panelState: PanelState;
  onPanelChange: (patch) => void;
  onBodyHtmlChange: (html: string) => void;
  saveState: SaveState;
  // internally calls joinFrontmatter + schedules debounced PATCH of { content }
};
```

The hook replaces the ad-hoc save-debounce blocks currently duplicated in `document-editor.tsx` and `workflow-detail-tabs.tsx`. Both call sites become thinner.

### 5.6 `NewWorkflowForm`

Today this file embeds a literal `WORKFLOW_FRONTMATTER` string constant and concatenates it to the Turndown body. After this change:

1. The form gets a FrontmatterPanel preloaded with `workflowSchema.defaults()`.
2. On submit, it calls `joinFrontmatter(panelState, bodyMd, workflowSchema)` and POSTs the result.

Same wire format, same server behaviour. The "describe a new workflow" path (agent-authored, via Platform Agent) is untouched — the agent produces markdown directly.

## 6. Data flow

### Load
```
1. Server reads documents.content → hands raw markdown to page
2. Client: const split = splitFrontmatter(content)
3. Client: const schema = getSchema(documents.type)
4. Client: try { parsed = js-yaml.load(split.frontmatterText); validated = schema.validate(parsed) }
          ok        → panel mode 'fields', value = validated.value
          parse err → panel mode 'raw', rawYaml = split.frontmatterText, error banner
          shape err → panel mode 'raw', rawYaml = yaml-stringify(parsed), show per-field errors
5. Tiptap initialised with marked.parse(split.body)
```

### Save (every 500ms debounce)
```
1. panelToYaml = js-yaml.dump(panelState, { lineWidth: 80, noRefs: true, forceQuotes: false })
   — or, when mode='raw', use rawYaml directly (bytes preserved if unchanged)
2. bodyMd = turndown.turndown(editorHtml)
3. content = joinFrontmatter(panelState, bodyMd, schema)
4. PATCH /api/brain/documents/{id} { content, …other field patches }
5. Server: extractDocumentTypeFromContent(content) → updates documents.type
          js-yaml.load + validateWorkflowFrontmatter → updates metadata
   (both unchanged from today)
```

### Byte stability
`joinFrontmatter` uses `js-yaml.dump` with a fixed option set and schema-driven key order. For unchanged field values the emitted block is byte-identical across saves. In raw mode with an unchanged `rawYaml`, the exact original bytes are preserved.

**Null-literal emission:** js-yaml defaults to emitting `null` as the empty scalar (e.g. `schedule:` with nothing after the colon). The existing workflow frontmatter seed writes `output_category: null` as a literal. To match the existing canonical shape and avoid spurious git diffs, `joinFrontmatter` either (a) configures js-yaml with a custom type representer that emits `null` as the literal string, or (b) post-processes the dumped YAML to rewrite empty-scalar `null` lines. The implementer picks whichever is cleaner at the time; the on-disk format tolerates both, but consistency with `WORKFLOW_FRONTMATTER` matters for the "no-op save is byte-identical" invariant.

## 7. Failure modes

| Case | Behaviour |
|---|---|
| `documents.content` has no frontmatter at all | `splitFrontmatter` returns `{ frontmatterText: null, body: content }`. Panel hidden for types without a schema; for typed docs, panel opens in fields mode with `schema.defaults()` and a small banner "Frontmatter was missing; defaults applied on next save." |
| YAML parse error on ingress | Panel opens in raw mode showing original `frontmatterText`, error banner. User either fixes YAML directly or clicks "Reset to defaults." Body editor functional throughout. |
| Schema validation error (structure OK, fields wrong) | Panel in fields mode with per-field errors + raw-mode fallback one click away. Save still goes through — server is the final validator, and `documents.type` will stay set because the `type:` line is intact. |
| Save races | Debounced save uses a single pending-patch object (same pattern as today). Panel changes and body changes both flow through the same scheduler, so only one PATCH is ever in flight per debounce window. |
| Agent writes via `update_document` | The agent submits full content (body + frontmatter). Server's existing parser path handles it. Editor state reloads from server on next mount. |
| Invalid YAML saved from raw mode | Same silent-skip server policy as today. `documents.type` stays set if the `type:` line parses; metadata sync skips. Trigger-time preflight catches real problems. |
| Doc of type whose schema isn't registered yet | `getSchema(type)` returns null → panel forced to raw-YAML mode. Body editor unchanged. New types cost one small file to add a schema. |
| Very long YAML / large `requires_mcps` arrays | `js-yaml.dump` with `lineWidth: 80` flows arrays onto multiple lines cleanly. No corruption risk because arrays live in the panel, not in Tiptap. |

## 8. Migration

Two moves.

### 8.1 Repair the corrupted workflow docs

One-off maintenance route/script: for every document where `type IS NULL AND metadata ? 'requires_mcps'` (i.e. had its type wiped but still has workflow metadata), fetch the earliest `document_versions` row, parse its content, and if that content has a valid `type: workflow` frontmatter block, update `documents` to restore `content`, `type`, and `metadata` from that snapshot. Skip any doc whose user edits since then appear substantive and ask the user to fix it rather than silently clobbering their work.

**Substantive-edit heuristic:** strip the corrupted frontmatter prefix from `documents.content` (the `* * *\n\n## type: workflow ...` preamble Turndown produces), then compare the remaining body — after whitespace normalisation — to the v1 body (also stripped of its frontmatter). If the two differ by more than whitespace, the script logs the doc id and skips it. If they match, it overwrites `content` / `type` / `metadata` from v1 and writes a new `document_versions` row with `change_summary = 'migration: restore frontmatter from v1 snapshot'` for audit.

Known victim: `3a80cbe0-e5ce-496d-a620-b9e88bb7783b` (project `wvobnayfskzegvrniomq`). Its v1 content is pristine.

The script is idempotent (no changes if `documents.type` is already set) and logs every mutation.

### 8.2 Wire the new editor

Not a migration in the DB sense — the on-disk format is unchanged. The switch is purely client-side. Old clients (none in prod yet; the workflows feature is in a worktree) would keep sending content through the broken path; new clients always produce canonical files. Nothing to version or gate.

## 9. Testing strategy

- **Unit: `splitFrontmatter` / `joinFrontmatter`** — round-trip stability (bytes unchanged on no-op), CRLF handling, missing-frontmatter cases, trailing newline discipline.
- **Unit: `workflowSchema.validate`** — reuses existing `validateWorkflowFrontmatter` tests; add coverage for the new wrapper that adds `type: 'workflow'`.
- **Component: `FrontmatterPanel`** — Testing-Library render of each field kind; toggle fields↔raw; error banner on invalid YAML.
- **Component: `DocumentEditor` (and the workflow DefinitionEditor)** — load a workflow doc, verify the frontmatter block never reaches Tiptap's HTML (regression: assert `editor.getHTML()` has no `<hr>` or `<h2>type: workflow</h2>`), edit a field, save, assert PATCH body contains a valid `---…---` block.
- **Integration (real Supabase, not mocks — per `feedback_markdown_first.md` neighbouring norms):** create → load → edit-body → save → reload → type + metadata unchanged. Edit field → save → metadata mirrors the new value. Paste invalid YAML in raw mode → save → `documents.type` preserved (only metadata sync skipped).
- **Migration script:** dry-run test against a fixture DB with the known-corruption shape.

## 10. Upgrade seams

The two stable spines are the **on-disk markdown format** and the **`FrontmatterSchema` registry**. Everything plugs around those.

| Future need | What changes, where |
|---|---|
| Add a new typed doc (`skill`, `agent-definition`) | Add one file: `schemas/skill.ts`. Register it in `schemas/index.ts`. No editor changes. |
| Schema UI generation from Zod / JSON Schema | Replace the hand-written `fields` array with a derivation from the existing validator; the panel component stays. |
| Agent-facing frontmatter introspection | Expose the registry as an MCP endpoint or inject into agent context. Already schema-typed in one place. |
| Collaborative editing | Yjs-backed Tiptap doc for the body; the frontmatter panel remains a single-writer form because the fields are small and changes are atomic. |
| Validation on save (server-side strict) | Today's silent-skip lives on for backward compat with agent writes. A `?strict=true` PATCH query could opt into 400 on invalid frontmatter for the editor path without affecting other writers. |
| "Raw edit the whole file" mode (power users) | One new top-level panel mode: full-file textarea bypassing both panel and Tiptap. Save calls the same PATCH. Zero changes to the schema registry. |

## 11. Implementation sequence

Order reflects dependency and testability; each step leaves the app working.

1. **`splitFrontmatter` / `joinFrontmatter` + tests.** Pure module, no UI. Establishes the save-format contract. *~0.5 day*
2. **`FrontmatterSchema` type + `workflowSchema` + registry.** Ports `validateWorkflowFrontmatter` into the registry wrapper. *~0.5 day*
3. **`FrontmatterPanel` component + unit tests.** Fields + raw mode + toggle. No wiring yet. *~1 day*
4. **`useFrontmatterEditor` hook + wire into `DocumentEditor`.** Shared debounce/save, body-only Tiptap. Feature-flag or behind a `?fm=new` query string during shakedown. *~1 day*
5. **Wire into `WorkflowDetailTabs.DefinitionEditor`.** Replace the read-only `WorkflowFrontmatterFields` sidebar with the new panel. *~0.5 day*
6. **Update `NewWorkflowForm`.** Use `workflowSchema.defaults()` + `joinFrontmatter`; drop the `WORKFLOW_FRONTMATTER` string. *~0.5 day*
7. **Migration script for corrupted workflow docs.** Dry-run, then apply. *~0.5 day*
8. **Integration tests + manual shakedown.** Workflow create → edit → run end-to-end on a real DB. *~0.5–1 day*

**Total: ~5 days.** Single-developer. Steps 3–5 carry the UI complexity; 1–2 are the contract; 7 is one-off cleanup.

## 12. Key design choices

| Decision | Choice | Rationale |
|---|---|---|
| Where frontmatter is stored | Still inside `documents.content` | Preserves markdown-first principle (memory); single source of truth |
| How frontmatter is edited | Structured form panel with raw-YAML escape hatch | Matches actual user edit patterns; prevents WYSIWYG from ever touching YAML |
| How schema is declared | Hand-written `FrontmatterField[]` per type | Explicit, small, no magic; easy to extend |
| Markdown body pipeline | Unchanged (marked / turndown) | Isolate the problem; body quirks are pre-existing and orthogonal |
| Server-side changes | None (same PATCH, same parser paths) | Defence-in-depth: client now sends valid bytes, server keeps checking |
| Handling of unregistered types | Raw-YAML-only panel | Graceful degradation without blocking edits |
| Invalid YAML save policy | Silent-skip for metadata sync, preserve `type` | Matches existing PATCH behaviour; don't fight half-edited state |
| Migration approach | Restore from `document_versions` snapshot | Zero data loss; the corruption is reversible because v1 is pristine |
| Byte stability | Canonical js-yaml.dump in fields mode; raw bytes in raw mode | Clean git diffs when nothing changed |

---

*End of spec. Review comments welcome. On approval, writing-plans skill produces the implementation plan.*
