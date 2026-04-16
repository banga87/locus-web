# MCP Tool Polish — Strict Section Errors + Diff-History Pagination

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `get_document`'s silent section-miss fallback with a structured `section_not_found` error, and add cursor-based pagination to `get_diff_history`.

**Architecture:** Two narrow, independent changes in `src/lib/tools/implementations/`. Both tools already share the same executor/audit plumbing via `LocusTool`, so every change stays inside the tool's own file plus its sibling test file. Cursor is an opaque base64-encoded `{t, id}` JSON pair; keyset pagination sorts by `(updatedAt DESC, id DESC)` with `updatedAt > since` as a top-level AND against the cursor predicate.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres/Supabase), Vitest, AJV for input-schema validation.

**Spec:** `docs/superpowers/specs/2026-04-16-mcp-tool-errors-pagination-design.md` (commit `7aa3591`).

**Working directory:** `C:\Code\locus\locus-web\.worktrees\mcp-auth-in\` on branch `mcp-auth-in`.

**Run tests:** `npx vitest run <path>` — no `test` script in `package.json`. Tests hit a live Supabase database via the shared fixture helpers in `src/lib/tools/__tests__/_fixtures.ts`; dev env must already have `NEXT_PUBLIC_SUPABASE_URL` + service role key wired.

**Commit policy:** small, frequent commits — one per green test cluster within a task.

---

## File Structure

| File | Change |
|---|---|
| `src/lib/tools/implementations/get-document.ts` | Split helpers, swap section-miss fallback to error |
| `src/lib/tools/implementations/get-diff-history.ts` | Add `limit` + `cursor` schema, keyset WHERE, cursor codec, audit fields |
| `src/lib/tools/__tests__/get-document.test.ts` | Add 2 tests for `section_not_found` |
| `src/lib/tools/__tests__/get-diff-history.test.ts` | Add 5 tests for pagination |

No new files. No schema migrations. All audit additions land in the existing `details` `jsonb` column.

---

## Task 1: `get_document` — strict `section_not_found` error

**Files:**
- Modify: `src/lib/tools/implementations/get-document.ts` (current section-miss fallback at lines 182-191; helper at lines 266-291)
- Test: `src/lib/tools/__tests__/get-document.test.ts`

### Step 1 — Write both failing `section_not_found` tests together

- [ ] Open `src/lib/tools/__tests__/get-document.test.ts`. First, add a zero-H2 fixture doc inside `beforeAll` (after the huge-doc insert around line 80):

```typescript
  // Doc with zero H2 headings — section lookup must still fail cleanly.
  await db.insert(documents).values({
    companyId: fixtures.companyId,
    brainId: fixtures.brainId,
    title: 'No Sections Doc',
    slug: `nosec-${fixtures.suffix}`,
    path: `brand/nosec-${fixtures.suffix}`,
    content: '# Heading One\n\nBody with no H2s at all.',
    status: 'active',
  });
```

Then add both `it` blocks inside `describe('get_document', ...)`, after the "slices to a single H2 section" test:

```typescript
it('returns section_not_found with available_sections listing every H2 when section is mistyped', async () => {
  const result = await executeTool(
    'get_document',
    {
      path: `${SECTIONED_PATH_BASE}-${fixtures.suffix}`,
      section: 'Actors', // not a real section in the sectioned fixture doc
    },
    fixtures.context,
  );

  expect(result.success).toBe(false);
  expect(result.error?.code).toBe('section_not_found');
  expect(result.error?.retryable).toBe(false);
  expect(result.error?.message).toContain("'Actors'");
  const anyErr = result.error as unknown as { available_sections?: string[] };
  expect(anyErr.available_sections).toEqual(['Overview', 'Pricing', 'Support']);
  expect(result.error?.hint).toContain('available_sections');
});

it('returns section_not_found with empty available_sections when the document has no H2 headings', async () => {
  const result = await executeTool(
    'get_document',
    {
      path: `brand/nosec-${fixtures.suffix}`,
      section: 'Anything',
    },
    fixtures.context,
  );

  expect(result.success).toBe(false);
  expect(result.error?.code).toBe('section_not_found');
  const anyErr = result.error as unknown as { available_sections?: string[] };
  expect(anyErr.available_sections).toEqual([]);
});
```

### Step 2 — Run the new tests and confirm both fail

- [ ] Run: `npx vitest run src/lib/tools/__tests__/get-document.test.ts -t "section_not_found"`
- [ ] Expected: both FAIL. Current implementation returns `success: true` with the full doc and an HTML comment, so `result.success` will be `true` in both cases.

### Step 3 — Extend `ToolError` shape (or rely on index signature) to include `available_sections`

- [ ] Open `src/lib/tools/types.ts`. Locate the `ToolError` interface (lines 83-106). Add an optional field below `suggestions`:

```typescript
  /** Exhaustive list of valid section names returned with `section_not_found`. */
  availableSections?: string[];
```

Wait — the existing JSON field name in the spec is `available_sections` (snake_case), matching the wire format the executor already uses for other error fields (`suggestions`, `retryable`, `retryAfter`). Add it as `available_sections` to match:

```typescript
  /** Exhaustive list of valid section names returned with `section_not_found`. */
  available_sections?: string[];
```

Check how the executor serializes `ToolError` — if it passes through untouched (no camelCase→snake_case remap), the snake_case field name is fine. Confirm by searching:

- [ ] Run: `rg 'retryAfter|retryable' src/lib/tools/executor.ts`
- [ ] If the executor treats `ToolError` as a flat pass-through, keep the field as `available_sections`. If it does a rename (unlikely), match that pattern.

### Step 4 — Add a `listH2Headings` helper and keep `extractH2Section` as pure lookup

- [ ] Edit `src/lib/tools/implementations/get-document.ts`. Just above the existing `extractH2Section` function (around line 266), add:

```typescript
/**
 * Enumerate all H2 headings in markdown content, in document order,
 * verbatim (preserves case and surrounding punctuation). Used by
 * `section_not_found` error responses.
 */
function listH2Headings(content: string): string[] {
  const headings: string[] = [];
  for (const line of content.split('\n')) {
    if (line.startsWith('## ')) {
      headings.push(line.slice(3).trim());
    }
  }
  return headings;
}
```

Leave `extractH2Section` untouched — it already returns `string | null`, which is exactly what we need.

### Step 5 — Swap the section-miss fallback to a structured error

- [ ] In `src/lib/tools/implementations/get-document.ts`, replace lines 180-191 (the `// -------- Body (optionally sliced to a section) --------------------` block) with:

```typescript
    // -------- Body (optionally sliced to a section) --------------------
    let body = doc.content;
    if (section) {
      const extracted = extractH2Section(doc.content, section);
      if (extracted === null) {
        return {
          success: false,
          error: {
            code: 'section_not_found',
            message: `No section titled '${section}' in document '${doc.path}'.`,
            available_sections: listH2Headings(doc.content),
            hint: 'Pick one of the available_sections, or call again without `section` to get the full document.',
            retryable: false,
          },
          metadata: {
            responseTokens: 0,
            executionMs: 0,
            documentsAccessed: [doc.id],
            details: {
              eventType: 'document.read',
              path: doc.path,
              section_requested: section,
              found: true,
              section_found: false,
            },
          },
        };
      }
      body = extracted;
    }
```

Rationale for the audit delta: `found: true` distinguishes this from `document_not_found` (which sets `found: false`); `section_found: false` tells the reader why we errored out.

### Step 6 — Also add `section_found: true` to the happy path

- [ ] In the same file, locate the successful return around line 232-253 (the `return { success: true, ... }` at the end of `call()`). Extend the `details` object:

```typescript
        details: {
          eventType: 'document.read',
          path: doc.path,
          section_requested: section,
          truncated,
          section_found: section ? true : null,
        },
```

`section_found: null` when no `section` was requested keeps the field's tri-state meaningful: `null = n/a`, `true = matched`, `false = mistyped-errored`.

### Step 7 — Run the full get_document test file and verify green

- [ ] Run: `npx vitest run src/lib/tools/__tests__/get-document.test.ts`
- [ ] Expected: all tests PASS — both new `section_not_found` cases (mistyped + zero-H2) plus every existing case. If the existing audit assertion (line 205-209) fails because it now sees `section_found: null`, update its `toMatchObject` — `toMatchObject` is lenient so this should not break unless the test is asserting exact equality.

### Step 8 — Commit Task 1

- [ ] Run:

```bash
cd C:\Code\locus\locus-web\.worktrees\mcp-auth-in
git add src/lib/tools/types.ts \
        src/lib/tools/implementations/get-document.ts \
        src/lib/tools/__tests__/get-document.test.ts
git commit -m "feat(mcp): return section_not_found instead of silent fallback

When get_document's section argument doesn't match any H2, return a
structured error with available_sections listing every H2 verbatim.
Silent full-doc fallback burned context without the agent noticing."
```

---

## Task 2: `get_diff_history` — cursor-based pagination

**Files:**
- Modify: `src/lib/tools/implementations/get-diff-history.ts`
- Test: `src/lib/tools/__tests__/get-diff-history.test.ts`

### Step 1 — Write the failing tests: basic pagination, limit bounds, and null-cursor final page

- [ ] Open `src/lib/tools/__tests__/get-diff-history.test.ts`. Append inside the existing `describe('get_diff_history', ...)` block, after the last existing `it`:

```typescript
it('paginates newest-first with a stable cursor across two pages', async () => {
  const page1 = await executeTool(
    'get_diff_history',
    { since: BOUNDARY.toISOString(), limit: 1 },
    fixtures.context,
  );
  expect(page1.success).toBe(true);
  const p1 = page1.data as {
    changes: Array<{ path: string }>;
    next_cursor: string | null;
  };
  expect(p1.changes.length).toBe(1);
  expect(p1.next_cursor).toBeTruthy();

  const page2 = await executeTool(
    'get_diff_history',
    { since: BOUNDARY.toISOString(), limit: 1, cursor: p1.next_cursor },
    fixtures.context,
  );
  expect(page2.success).toBe(true);
  const p2 = page2.data as {
    changes: Array<{ path: string }>;
    next_cursor: string | null;
  };
  expect(p2.changes.length).toBe(1);
  const combined = [...p1.changes.map((c) => c.path), ...p2.changes.map((c) => c.path)];
  expect(combined).toContain(`brand/brand-${fixtures.suffix}`);
  expect(combined).toContain(`pricing/pricing-${fixtures.suffix}`);
  expect(new Set(combined).size).toBe(combined.length); // no duplicates
});

it('returns next_cursor=null on the final page', async () => {
  // limit comfortably exceeds the number of rows in the window.
  const result = await executeTool(
    'get_diff_history',
    { since: BOUNDARY.toISOString(), limit: 500 },
    fixtures.context,
  );
  expect(result.success).toBe(true);
  const data = result.data as { changes: unknown[]; next_cursor: string | null };
  expect(data.next_cursor).toBeNull();
});

it('rejects limit outside [1, 500] with invalid_input', async () => {
  for (const badLimit of [0, 501, -1, 10000]) {
    const result = await executeTool(
      'get_diff_history',
      { since: BOUNDARY.toISOString(), limit: badLimit },
      fixtures.context,
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('invalid_input');
  }
});
```

### Step 2 — Run the new tests and confirm they fail

- [ ] Run: `npx vitest run src/lib/tools/__tests__/get-diff-history.test.ts -t "paginates newest-first|next_cursor=null|rejects limit"`
- [ ] Expected: the first two FAIL because the tool doesn't accept `limit`/`cursor` yet and the AJV schema will reject (`additionalProperties: false` is set) — so even the happy-path test short-circuits to `invalid_input`. The third test passes for the wrong reason (also `invalid_input`, but due to unknown property, not bounds); that's fine — it'll pass for the right reason after Step 3.

### Step 3 — Add `limit` and `cursor` to the input schema

- [ ] Edit `src/lib/tools/implementations/get-diff-history.ts`. Extend the `GetDiffHistoryInput` interface (lines 15-19):

```typescript
interface GetDiffHistoryInput {
  since: string;
  folder?: string;
  include_content_preview?: boolean;
  limit?: number;
  cursor?: string;
}
```

Extend the `inputSchema` (lines 45-54) to add the two new properties and keep `additionalProperties: false`:

```typescript
  inputSchema: {
    type: 'object',
    properties: {
      since: { type: 'string', format: 'date-time' },
      folder: { type: 'string', minLength: 1 },
      include_content_preview: { type: 'boolean' },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      cursor: { type: 'string', minLength: 1 },
    },
    required: ['since'],
    additionalProperties: false,
  },
```

`minimum`/`maximum` enforcement happens in AJV — out-of-range `limit` values surface as `invalid_input` via the executor's standard path. No custom check needed in `call()`.

Also extend the output shape (`GetDiffHistoryOutput`, lines 29-32):

```typescript
interface GetDiffHistoryOutput {
  since: string;
  changes: DiffEntry[];
  next_cursor: string | null;
}
```

### Step 4 — Add cursor encode/decode helpers at the bottom of the file

- [ ] Append to `src/lib/tools/implementations/get-diff-history.ts`:

```typescript
// ---------------------------------------------------------------------------
// Cursor codec
// ---------------------------------------------------------------------------

/**
 * Opaque cursor shape. Callers never see the JSON — they receive and
 * replay `next_cursor` verbatim. Format is base64-encoded JSON with
 * `t` (ISO-8601 timestamp of the last row's updatedAt) and `id`
 * (documents.id of the same row, never a joined-row id).
 */
interface CursorPayload {
  t: string;
  id: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

function decodeCursor(raw: string): CursorPayload | null {
  try {
    const json = Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as { t?: unknown }).t !== 'string' ||
      typeof (parsed as { id?: unknown }).id !== 'string'
    ) {
      return null;
    }
    const { t, id } = parsed as CursorPayload;
    if (Number.isNaN(new Date(t).getTime())) return null;
    if (!UUID_RE.test(id)) return null;
    return { t, id };
  } catch {
    return null;
  }
}
```

### Step 5 — Update the query to use keyset pagination

- [ ] In `call()`, replace the current lines 82-113 (everything from `const includePreview = ...` down through the first `db.select({...})...where(and(...whereClauses))` call) with the new paginated version:

```typescript
    const includePreview = input.include_content_preview === true;
    const limit = input.limit ?? 50;

    // Decode cursor (if present) before building the query. Malformed
    // cursors surface as invalid_input — can't be expressed in JSON Schema
    // since the payload is opaque.
    let cursor: CursorPayload | null = null;
    if (typeof input.cursor === 'string') {
      cursor = decodeCursor(input.cursor);
      if (cursor === null) {
        return {
          success: false,
          error: {
            code: 'invalid_input',
            message: `'${input.cursor}' is not a valid cursor.`,
            hint:
              "Pass 'cursor' verbatim from the previous response's 'next_cursor', or omit it to start from the beginning.",
            retryable: false,
          },
          metadata: {
            responseTokens: 0,
            executionMs: 0,
            documentsAccessed: [],
            details: { eventType: 'document.diff_history' },
          },
        };
      }
    }

    // `isNull(documents.type)` restricts results to user-authored
    // documents — scaffolding/skills/agent-definitions carry a non-null
    // `type` and should never surface in the change feed.
    const whereClauses = [
      eq(documents.brainId, context.brainId),
      isNull(documents.deletedAt),
      isNull(documents.type),
      gt(documents.updatedAt, since),
    ];
    if (input.folder) {
      whereClauses.push(eq(folders.slug, input.folder));
    }
    if (cursor) {
      // Keyset predicate: rows strictly "after" the cursor in the
      // (updatedAt DESC, id DESC) ordering. Note: since stays ANDed at
      // the top level and never relaxes — a stale cursor whose t <= since
      // naturally produces an empty page.
      const cursorTime = new Date(cursor.t);
      whereClauses.push(
        or(
          lt(documents.updatedAt, cursorTime),
          and(
            eq(documents.updatedAt, cursorTime),
            lt(documents.id, cursor.id),
          ),
        )!,
      );
    }

    // Fetch limit+1 so we can detect whether another page exists without
    // a second query. Sort DESC on both keys for the keyset to work.
    const docs = await db
      .select({
        id: documents.id,
        path: documents.path,
        updatedAt: documents.updatedAt,
        content: documents.content,
        folderSlug: folders.slug,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .leftJoin(folders, eq(folders.id, documents.folderId))
      .where(and(...whereClauses))
      .orderBy(desc(documents.updatedAt), desc(documents.id))
      .limit(limit + 1);
```

Then update the imports at the top of the file (line 7) to add `or` and `lt`:

```typescript
import { and, desc, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';
```

### Step 6 — Trim `limit+1` rows, build `next_cursor`, drop the old sort

- [ ] Replace the existing sort/return at the end of `call()` (lines 177-195). The new version trims and builds `next_cursor`:

```typescript
    // Trim and build next_cursor. `docs` came back DESC-ordered, so the
    // last kept row's (updatedAt, id) is the cursor for the next page.
    let nextCursor: string | null = null;
    const kept = docs;
    if (docs.length > limit) {
      kept.length = limit; // drop the probe row in place
      const last = kept[kept.length - 1];
      nextCursor = encodeCursor({
        t: last.updatedAt.toISOString(),
        id: last.id,
      });
    }

    // Versions lookup runs on the kept set only.
    const docIds = kept.map((d) => d.id);
    const latestVersions = new Map<
      string,
      { summary: string | null; versionNumber: number; createdAt: Date }
    >();

    if (docIds.length > 0) {
      const versionRows = await db
        .select({
          documentId: documentVersions.documentId,
          versionNumber: documentVersions.versionNumber,
          changeSummary: documentVersions.changeSummary,
          createdAt: documentVersions.createdAt,
        })
        .from(documentVersions)
        .where(inArray(documentVersions.documentId, docIds))
        .orderBy(desc(documentVersions.createdAt));

      for (const v of versionRows) {
        if (!latestVersions.has(v.documentId)) {
          latestVersions.set(v.documentId, {
            summary: v.changeSummary,
            versionNumber: v.versionNumber,
            createdAt: v.createdAt,
          });
        }
      }
    }

    const changes: DiffEntry[] = kept.map((d) => {
      const latest = latestVersions.get(d.id);
      const changeType = latest
        ? latest.versionNumber === 1
          ? 'created'
          : 'updated'
        : d.createdAt.getTime() === d.updatedAt.getTime()
          ? 'created'
          : 'updated';

      const entry: DiffEntry = {
        path: d.path,
        change_type: changeType,
        changed_at: d.updatedAt.toISOString(),
        summary: latest?.summary ?? null,
      };
      if (includePreview) {
        entry.preview = (d.content ?? '').slice(0, PREVIEW_CHARS);
      }
      return entry;
    });

    // No post-sort needed — the DB already returned DESC-ordered rows.

    return {
      success: true,
      data: { since: input.since, changes, next_cursor: nextCursor },
      metadata: {
        responseTokens: 0,
        executionMs: 0,
        documentsAccessed: kept.map((d) => d.id),
        details: {
          eventType: 'document.diff_history',
          since: input.since,
          folder: input.folder ?? null,
          limit,
          has_cursor: cursor !== null,
          returned_count: changes.length,
          change_count: changes.length, // keep legacy field for the existing audit-assert test
        },
      },
    };
```

Delete the removed blocks: the earlier `docIds`/`latestVersions` assembly (lines 114-150), the old `.map(...)` that built `changes` (lines 152-175), and the post-sort (lines 177-178).

### Step 7 — Run the full test file; expect the pagination test + existing tests to pass

- [ ] Run: `npx vitest run src/lib/tools/__tests__/get-diff-history.test.ts`
- [ ] Expected: all existing tests PASS plus the new "paginates newest-first" test PASS. The existing "returns docs updated after the boundary" test now also implicitly validates that `next_cursor` is `null` when the result fits in one page (since it doesn't pass `limit`, the default 50 applies).

### Step 8 — Write the failing test: tied updatedAt across entire window

- [ ] Still in `get-diff-history.test.ts`, add three more rows inside `beforeAll` that share a single `updatedAt` value. Place this after the existing `// Stale doc` insert (around line 106):

```typescript
  // Three docs sharing the exact same updatedAt, all after the boundary.
  // Pagination must still be deterministic via the id tiebreaker.
  const TIED = new Date('2026-03-15T12:00:00.000Z');
  for (let i = 0; i < 3; i++) {
    await db.insert(documents).values({
      companyId: fixtures.companyId,
      brainId: fixtures.brainId,
      folderId: fixtures.folderBrandId,
      title: `Tied Doc ${i}`,
      slug: `tied-${i}-${fixtures.suffix}`,
      path: `brand/tied-${i}-${fixtures.suffix}`,
      content: `Tied doc ${i}`,
      status: 'active',
      createdAt: BEFORE,
      updatedAt: TIED,
    });
  }
```

Then add the test:

```typescript
it('handles ties across the whole window via id tiebreaker — no duplicates, no skips', async () => {
  // Narrow `since` so only the three tied docs surface.
  const sinceIso = '2026-03-01T00:00:00.000Z';

  const page1 = await executeTool(
    'get_diff_history',
    { since: sinceIso, limit: 1 },
    fixtures.context,
  );
  const p1 = page1.data as { changes: Array<{ path: string }>; next_cursor: string | null };
  expect(p1.changes.length).toBe(1);
  expect(p1.next_cursor).toBeTruthy();

  const page2 = await executeTool(
    'get_diff_history',
    { since: sinceIso, limit: 1, cursor: p1.next_cursor },
    fixtures.context,
  );
  const p2 = page2.data as { changes: Array<{ path: string }>; next_cursor: string | null };
  expect(p2.changes.length).toBe(1);

  const page3 = await executeTool(
    'get_diff_history',
    { since: sinceIso, limit: 1, cursor: p2.next_cursor },
    fixtures.context,
  );
  const p3 = page3.data as { changes: Array<{ path: string }>; next_cursor: string | null };
  expect(p3.changes.length).toBe(1);
  expect(p3.next_cursor).toBeNull();

  const combined = [...p1.changes, ...p2.changes, ...p3.changes].map((c) => c.path);
  expect(new Set(combined).size).toBe(3); // all three tied docs, no dupes
  for (const p of combined) {
    expect(p.startsWith(`brand/tied-`)).toBe(true);
  }
});
```

### Step 9 — Run the ties test; expect PASS

- [ ] Run: `npx vitest run src/lib/tools/__tests__/get-diff-history.test.ts -t "handles ties across the whole window"`
- [ ] Expected: PASS. If it fails with duplicates or skips, the `lt(documents.id, cursor.id)` tiebreaker is wrong — verify the WHERE predicate built in Step 5 uses `lt` (not `gt` or `lte`) on `id`.

### Step 10 — Write the failing test: malformed cursor

- [ ] Add this test in `get-diff-history.test.ts`:

```typescript
it('rejects malformed cursor with invalid_input', async () => {
  const cases = [
    'not-base64!!',                                        // invalid base64
    Buffer.from('{"not":"a cursor"}').toString('base64'), // missing t/id
    Buffer.from('{"t":"nope","id":"also-not-uuid"}').toString('base64'),
  ];
  for (const cursor of cases) {
    const result = await executeTool(
      'get_diff_history',
      { since: BOUNDARY.toISOString(), cursor },
      fixtures.context,
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('invalid_input');
    expect(result.error?.hint).toContain('next_cursor');
  }
});
```

### Step 11 — Run the malformed-cursor test; expect PASS

- [ ] Run: `npx vitest run src/lib/tools/__tests__/get-diff-history.test.ts -t "rejects malformed cursor"`
- [ ] Expected: PASS. All three malformed-cursor shapes should be rejected at decode time.

### Step 12 — Write the failing test: stale cursor (cursor.t ≤ since)

- [ ] Add this test:

```typescript
it('returns empty changes and null next_cursor when cursor.t <= since (stale-cursor no-op)', async () => {
  // Cursor from before the since boundary — keyset predicate + since
  // AND naturally produce an empty page. No error.
  const staleCursor = Buffer.from(
    JSON.stringify({
      t: '2025-01-01T00:00:00.000Z',
      id: '00000000-0000-0000-0000-000000000000',
    }),
    'utf8',
  ).toString('base64');

  const result = await executeTool(
    'get_diff_history',
    { since: BOUNDARY.toISOString(), cursor: staleCursor },
    fixtures.context,
  );
  expect(result.success).toBe(true);
  const data = result.data as { changes: unknown[]; next_cursor: string | null };
  expect(data.changes).toEqual([]);
  expect(data.next_cursor).toBeNull();
});
```

### Step 13 — Run the stale-cursor test; expect PASS

- [ ] Run: `npx vitest run src/lib/tools/__tests__/get-diff-history.test.ts -t "stale-cursor no-op"`
- [ ] Expected: PASS. Success with empty array — no special-case error.

### Step 14 — Run all pagination tests and the full diff-history suite; expect all PASS

- [ ] Run: `npx vitest run src/lib/tools/__tests__/get-diff-history.test.ts`
- [ ] Expected: every test PASS (the five new pagination tests plus the five existing tests). If the existing "fires an audit entry" test (line 202-216) fails because `toMatchObject` sees new audit fields (`limit`, `has_cursor`, `returned_count`), that's fine — `toMatchObject` is lenient about extra fields. If the test asserts exact equality on `details`, relax it to `toMatchObject`.

### Step 15 — Commit Task 2

- [ ] Run:

```bash
cd C:\Code\locus\locus-web\.worktrees\mcp-auth-in
git add src/lib/tools/implementations/get-diff-history.ts \
        src/lib/tools/__tests__/get-diff-history.test.ts
git commit -m "feat(mcp): cursor pagination on get_diff_history

Add limit (default 50, max 500) + opaque base64 cursor keyed on
(updatedAt DESC, id DESC). Stale cursor (cursor.t <= since) is a
valid no-op returning empty changes. Audit gains limit / has_cursor
/ returned_count."
```

---

## Task 3: Full-suite verification

**Files:** no code changes, verification only.

### Step 1 — Run the entire tool-tests suite

- [ ] Run: `npx vitest run src/lib/tools/__tests__/`
- [ ] Expected: all tool tests PASS. If any unrelated test fails, investigate before proceeding — do not suppress.

### Step 2 — Run lint + boundary check

- [ ] Run: `npm run lint`
- [ ] Expected: no errors. If ESLint flags the new `or()/lt()` import patterns, fix and re-run.

### Step 3 — Smoke-test the live MCP endpoint

- [ ] Start the dev server in another shell: `npm run dev`. Confirm `NEXT_PUBLIC_APP_ORIGIN=http://localhost:3000` and `MCP_OAUTH_JWT_SECRET` are set in `.env`.
- [ ] From a Claude Code session connected to `locus-local`, issue two smoke calls:
  - `get_document` with a deliberately wrong `section` against any real doc → expect `section_not_found` with a populated `available_sections`.
  - `get_diff_history` with `limit: 1` and a `since` before any doc in the brain → expect exactly one change plus a `next_cursor` string.
- [ ] Expected: both MCP calls return the new shapes end-to-end.

### Step 4 — Final commit (only if Step 3 surfaced adjustments)

- [ ] If the smoke test revealed any gap (e.g., a missing field in the wire payload, a regression in a response shape), fix in-place and commit with a descriptive message. Otherwise this step is a no-op.

---

## Done when

- Both tool changes are merged into the same PR on branch `mcp-auth-in`.
- `npx vitest run src/lib/tools/__tests__/` is green.
- `npm run lint` is clean.
- Live MCP smoke test returns the new shapes.
- Spec (`docs/superpowers/specs/2026-04-16-mcp-tool-errors-pagination-design.md`) and this plan both sit alongside the code in the same commit range.
