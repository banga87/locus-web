# MCP tool polish: strict section errors + diff-history pagination

**Date:** 2026-04-16
**Status:** Draft
**Scope:** `src/lib/tools/implementations/get-document.ts`, `src/lib/tools/implementations/get-diff-history.ts`, and their tests.

## Motivation

The MCP smoke test after OAuth landed surfaced two behaviours that were flagged as provisional in the Pre-MVP implementation:

1. `get_document` with a mistyped `section` argument silently returns the full document with an HTML comment in the body (`<!-- section 'Actors' not found; returning full document -->`). The author's own comment at `get-document.ts:184-188` flagged this as "flip if noisy in practice." Agents tend to ignore soft signals; a mistyped section name quietly consuming ~7K tokens of context without the agent noticing is exactly the failure mode we want to preempt.
2. `get_diff_history` has no pagination. Fine for today's ~30-document brain; unsafe before the change log grows.

Both are narrow API-shape changes. No external MCP agents are in production yet (Pre-MVP), so we ship the breaking changes without compatibility shims.

## Change 1 — Strict `section_not_found` error in `get_document`

### New behaviour

When the caller passes `section` and no H2 in the document matches (case-insensitive, trimmed), return a structured error instead of falling through to the full document:

```json
{
  "success": false,
  "error": {
    "code": "section_not_found",
    "message": "No section titled 'Actors' in document 'engineering/architecture/auth-and-access'. Available sections: Purpose, 1. Human Authentication, 2. Organization Model, ...",
    "available_sections": [
      "Purpose",
      "1. Human Authentication",
      "2. Organization Model",
      "..."
    ],
    "hint": "Pick one of the available_sections, or call again without `section` to get the full document.",
    "retryable": false
  },
  "metadata": {
    "eventType": "document.read",
    "path": "engineering/architecture/auth-and-access",
    "section_requested": "Actors",
    "found": true,
    "section_found": false
  }
}
```

### Semantics

- `document_not_found` is unchanged — missing document is still a separate error with fuzzy path suggestions.
- `section_not_found` fires only when the document exists but no H2 matches the requested section. Both conditions distinguishable by the `found` / `section_found` metadata fields.
- `available_sections` contains every H2 heading in the document, verbatim (preserving case and surrounding punctuation). Small and deterministic — typical documents have 5–30 H2s, so enumeration is cheap and a fuzzy match adds no value at this size.
- Documents with zero H2s return `available_sections: []` and the hint already covers the recovery path ("call again without `section`").

### Implementation notes

- Split the current `extractH2Section(content, section)` helper in `get-document.ts` into two: a `listH2Headings(content): string[]` enumerator and `extractH2Section(content, section): string | null` remaining the targeted extractor. Keeps heading enumeration separate from extraction and makes the error path testable in isolation.
- Delete the lines that construct the "section not found; returning full document" fallback body (currently `get-document.ts:188-190`).
- Audit-event `details` gains `section_found: boolean` (nullable — only populated when `section` was requested). Because `details` is a `jsonb` column, no migration is required.

### Tests (in `src/lib/tools/__tests__/get-document.test.ts`)

- `returns section_not_found when section is mistyped, with available_sections listing every H2 verbatim`
- `returns section_not_found with available_sections: [] on documents that have no H2s`
- existing "section happy path" and "document_not_found" cases remain unchanged
- audit metadata asserts `section_found: false` on the error path and `section_found: true` on the happy path

## Change 2 — Cursor-based pagination in `get_diff_history`

### New input schema

```ts
{
  since: string;                     // unchanged, required, ISO-8601
  folder?: string;                   // unchanged
  include_content_preview?: boolean; // unchanged
  limit?: number;                    // new, default 50, min 1, max 500
  cursor?: string;                   // new, opaque, from previous response's next_cursor
}
```

### New output schema

```ts
{
  since: string;
  changes: DiffEntry[];
  next_cursor: string | null;
}
```

### Cursor format

Base64-encoded JSON: `{ "t": "<changed_at ISO>", "id": "<document_id>" }`.

Opaque to callers. The format is an internal implementation detail — agents must pass the `next_cursor` value verbatim. Documented in the tool description as opaque.

### Query changes

Sort: `ORDER BY documents.updatedAt DESC, documents.id DESC`. The `id` tiebreaker matters because batched writes (seed scripts, bulk imports) produce multiple rows with identical `updatedAt`; without a stable secondary key, keyset pagination can skip or duplicate rows across page boundaries.

WHERE clause gains keyset predicate when `cursor` is present:

```
updatedAt > since
AND (cursor IS NULL
  OR updatedAt < cursor.t
  OR (updatedAt = cursor.t AND id < cursor.id))
```

Fetch `limit + 1` rows. If the query returns `limit + 1`, trim the last row and emit a `next_cursor` built from the last kept row's `updatedAt` + `id`. Otherwise `next_cursor: null`.

### Error cases

- `limit` outside `[1, 500]` → `invalid_input` with message including the allowed range.
- Malformed `cursor` (bad base64, bad JSON, missing `t` or `id`, unparseable `t` as ISO-8601, non-UUID `id`) → `invalid_input` with hint: `"Pass 'cursor' verbatim from the previous response's 'next_cursor', or omit it to start from the beginning."`

Callers must continue to pass `since` on every paginated request — the tool is stateless. `since` defines the window start; `cursor` advances within that window.

### Audit metadata additions

- `limit: number` — the effective limit applied
- `has_cursor: boolean` — whether the request supplied a cursor
- `returned_count: number` — number of changes in the response (post-trim)

All land in the `details` jsonb blob. No migration.

### Tests (in `src/lib/tools/__tests__/get-diff-history.test.ts`)

- `paginates newest-first with a stable cursor across two pages — concat equals unpaginated result`
- `respects limit bounds (min 1, max 500) and returns invalid_input outside the range`
- `handles ties on updatedAt via the id tiebreaker — no duplicates, no skips when three documents share a timestamp`
- `rejects malformed cursor with invalid_input (covers bad base64, missing fields, non-ISO timestamp)`
- `next_cursor is null on the final page`
- existing `since`-validation, folder-filter, and preview tests remain unchanged

## Out of scope

- No `until` / upper-bound on `get_diff_history` — can be added later without schema churn.
- No changes to `get_document_diff` (already has a `limit` param, no cursor needed at one-document granularity).
- No changes to `search_documents`.
- No database migration — all changes are application-code plus optional jsonb fields in audit events.

## Rollout

- Breaking changes to both tools. Pre-MVP, no external agents in production, no compat flag.
- Both changes ship together in a single PR to keep tool-schema churn to one roundtrip for any downstream skill metadata.
- MCP integration tests (`src/lib/mcp/__tests__/`) require no updates — the transport passes inputs through verbatim, so tool-level coverage is sufficient.
