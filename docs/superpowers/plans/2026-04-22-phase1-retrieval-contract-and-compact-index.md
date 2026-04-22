# Phase 1 Implementation Plan — Retrieval Contract + Compact Index + Provider Interface

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a provenance-returning retrieval API and an always-on rule-based `compact_index` for every document, while keeping the existing `search_documents` tool working unchanged for agents. End the phase with a `MemoryProvider` interface extracted from the working implementation.

**Architecture:** New harness-pure subsystem at `src/lib/memory/` with: rule-based compact-index extractor (proper nouns, key sentence, flags, dates, topics), scoring primitives (phrase boost, proper-noun boost, temporal proximity), retrieval core (scan/expand/hybrid modes) that composes tsvector ranking with the new boosts and attaches full provenance to results, and overview generator that writes folder rollups as `type: overview` documents. At phase end, the working implementation is wrapped in a `MemoryProvider` adapter so later phases can swap the provider.

**Tech Stack:** TypeScript, Next.js 16 App Router, Drizzle ORM on Supabase Postgres (tsvector + GIN), Vitest for tests, AI SDK only at route-layer boundary. Harness-pure (`src/lib/memory/` receives the same `check-harness-boundary.sh` protection as `src/lib/agent/`).

**Spec reference:** `docs/superpowers/specs/2026-04-22-agent-memory-architecture-design.md` (Section 12, Phase 1).

---

## File structure

```
locus-web/
  src/
    db/
      schema/
        documents.ts                        [MODIFY — add compactIndex column]
      migrations/
        0022_documents_compact_index.sql    [NEW]
    lib/
      memory/                               [NEW — harness-pure]
        types.ts                            [NEW]
        compact-index/
          proper-nouns.ts
          key-sentence.ts
          flags.ts
          date-hints.ts
          topics.ts
          extract.ts
          merge.ts
          __tests__/*.test.ts
        scoring/
          phrase-boost.ts
          proper-noun-boost.ts
          temporal-proximity.ts
          compose.ts
          __tests__/*.test.ts
        overview/
          generate.ts
          invalidate.ts
          __tests__/generate.test.ts
        providers/
          tatara-hybrid/
            index.ts                        [extracted at end of phase]
        core.ts
        README.md
        __tests__/
          core.test.ts
          cross-tenancy.test.ts             [critical correctness test]
      write-pipeline/                     [NEW — single merge point per spec §8.1]
        ingest.ts
        __tests__/ingest.test.ts
      tools/
        implementations/
          search-documents.ts               [MODIFY — delegate to memory/core, emit provenance]
          __tests__/
            search-documents.test.ts        [NEW]
    app/api/
      admin/backfill-compact-index/
        route.ts                            [NEW — admin-only one-shot backfill]
      brain/documents/
        route.ts                            [MODIFY — call write-pipeline on create + overview invalidation]
        [id]/route.ts                       [MODIFY — same for update]
        __tests__/compact-index-on-write.test.ts   [NEW — end-to-end]
  tests/benchmarks/                         [NEW]
    runner.ts
    fixtures/sample.json
    README.md
  scripts/
    check-harness-boundary.sh               [MODIFY — add src/lib/memory/]
```

---

## Conventions used in this plan

- **Test framework:** `vitest`. Run a single file with `npx vitest run src/lib/memory/compact-index/__tests__/proper-nouns.test.ts`. Run all: `npx vitest run`.
- **Migrations:** raw SQL in `src/db/migrations/NNNN_name.sql`, numbered sequentially. `drizzle-kit` is used for schema introspection, not migration generation — migrations are hand-written to maintain precise control (see existing 0001–0021).
- **TDD rhythm:** one test, fail, minimal code, pass, commit. Resist writing implementation before the test.
- **Boundary rule:** every file under `src/lib/memory/` must not import from `next/*`, `@vercel/functions`, `src/lib/agent/`, or `src/lib/subagent/`. Imports from `@/db` are fine (the DB client is platform-agnostic).
- **Commit style:** match existing history — `type: short summary` (e.g. `feat:`, `refactor:`, `test:`, `docs:`, `chore:`). Keep first line ≤72 chars.
- **Co-author trailer:** every commit uses `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **File-level comment banner:** follow the project's existing top-of-file prose style (see `src/lib/tools/implementations/search-documents.ts:1-7`). One short paragraph, no emoji, no marketing.

---

## Task 1: Add `compact_index` column + migration

**Files:**
- Modify: `src/db/schema/documents.ts`
- Create: `src/db/migrations/0022_documents_compact_index.sql`

- [ ] **Step 1: Draft the migration SQL**

Create `src/db/migrations/0022_documents_compact_index.sql`:

```sql
-- Adds compact_index: a rule-based structured summary of every document
-- used by search_documents scan mode to surface ~40-token hits before
-- the agent fetches full content. Populated on every write by
-- src/lib/memory/compact-index/extract.ts. Always-on, zero LLM cost.
-- See docs/superpowers/specs/2026-04-22-agent-memory-architecture-design.md.

ALTER TABLE documents
  ADD COLUMN compact_index jsonb;

-- GIN indexes on the fields agents filter by in retrieval.
CREATE INDEX IF NOT EXISTS documents_compact_index_entities_idx
  ON documents USING gin ((compact_index -> 'entities'));

CREATE INDEX IF NOT EXISTS documents_compact_index_topics_idx
  ON documents USING gin ((compact_index -> 'topics'));

CREATE INDEX IF NOT EXISTS documents_compact_index_flags_idx
  ON documents USING gin ((compact_index -> 'flags'));
```

- [ ] **Step 2: Apply the migration in dev**

Run:
```bash
psql "$DATABASE_URL" -f src/db/migrations/0022_documents_compact_index.sql
```
Expected: `ALTER TABLE` + three `CREATE INDEX` lines, no errors.

- [ ] **Step 3: Update the Drizzle schema**

Edit `src/db/schema/documents.ts`. Add to the `documents` table definition, under the existing `metadata` jsonb line (~line 143):

```typescript
    // Rule-based structured summary written by
    // src/lib/memory/compact-index/extract.ts on every document save.
    // Target ~40 tokens when serialized. See
    // docs/superpowers/specs/2026-04-22-agent-memory-architecture-design.md
    // §6.1 for the shape.
    compactIndex: jsonb('compact_index'),
```

Also add three index entries at the bottom of the `(table) => [ ... ]` array:

```typescript
    index('documents_compact_index_entities_idx').using(
      'gin',
      sql`(${table.compactIndex} -> 'entities')`,
    ),
    index('documents_compact_index_topics_idx').using(
      'gin',
      sql`(${table.compactIndex} -> 'topics')`,
    ),
    index('documents_compact_index_flags_idx').using(
      'gin',
      sql`(${table.compactIndex} -> 'flags')`,
    ),
```

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema/documents.ts src/db/migrations/0022_documents_compact_index.sql
git commit -m "$(cat <<'EOF'
feat: add compact_index jsonb column to documents

Phase 1 Task 1 of agent-memory-architecture. Adds the column + GIN
indexes on entities/topics/flags paths. Population is wired in a
subsequent task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Memory subsystem types + README

**Files:**
- Create: `src/lib/memory/types.ts`
- Create: `src/lib/memory/README.md`

- [ ] **Step 1: Write the types file**

Create `src/lib/memory/types.ts`:

```typescript
// Core types for the memory subsystem. Harness-pure: no imports from
// next/*, @vercel/functions, src/lib/agent, or src/lib/subagent.
//
// The MemoryProvider interface is intentionally NOT declared here yet —
// it will be extracted in Task 27 once the concrete implementation has
// settled. See docs/superpowers/specs/2026-04-22-agent-memory-architecture-design.md §5.3.

export type AuthoredBy =
  | 'human'
  | 'generating_agent'
  | 'maintenance_agent'
  | 'rule_based';

export type ConfidenceTier = 'authored' | 'extracted' | 'inferred';

// The structured summary persisted in documents.compact_index.
// Target ~40 tokens when JSON-serialized.
export interface CompactIndex {
  entities: string[];          // slugs referencing type=entity docs
  topics: string[];            // normalized lowercase
  flags: string[];             // controlled vocab (DECISION, POLICY, CORE, …)
  proper_nouns: string[];      // verbatim capitalized sequences from content
  key_sentence: string;        // <=200 chars verbatim
  date_hints: string[];        // ISO-8601 strings
  authored_by: AuthoredBy;
  computed_at: string;         // ISO-8601
}

// Input to retrieve(). brainId + companyId are REQUIRED — every query
// is tenant-scoped.
export interface RetrieveQuery {
  brainId: string;
  companyId: string;
  query: string;
  mode: 'scan' | 'expand' | 'hybrid';
  tierCeiling: ConfidenceTier;
  filters?: {
    folderPath?: string;
    docTypes?: string[];
    dateRange?: { from?: Date; to?: Date };
    flags?: string[];
    confidenceMin?: number;
  };
  limit?: number;
  tokenBudget?: number;
}

// Provenance attached to every retrieval result.
// Strict-tier callers receive only 'authored' | 'extracted' in
// confidenceTier — never 'inferred'. This is enforced inside the
// retrieval core by refusing to load inferred-tier content.
export interface Provenance {
  brainId: string;
  path: string;
  updatedAt: string;
  version: number;
  confidenceTier: 'authored' | 'extracted';
}

export interface Snippet {
  mode: 'compact' | 'headline' | 'full';
  text: string;
  anchor?: string;
}

export interface Excerpt {
  before: string;
  match: string;
  after: string;
}

export interface RankedResult {
  documentId: string;
  slug: string;
  title: string;
  score: number;
  provenance: Provenance;
  snippet: Snippet;
  compactIndex?: CompactIndex;
  excerpt?: Excerpt;
}
```

- [ ] **Step 2: Write the subsystem README**

Create `src/lib/memory/README.md`:

```markdown
# src/lib/memory/

Harness-pure memory subsystem. Retrieval, compact-index extraction,
scoring, and overview generation.

## Rules

- No imports from `next/*`, `@vercel/functions`, `src/lib/agent`, or
  `src/lib/subagent`. `scripts/check-harness-boundary.sh` enforces this.
- No `Request`/`Response` parameters. Pass a plain context object.
- DB access via `@/db` only.

## Why the boundary

Retrieval must be callable from:
- Next.js route handlers (today)
- Vercel Cron handlers (Phase 4)
- Workflow DevKit durable workers (Phase 5+)
- Test harnesses + external benchmarks (always)

Any coupling to Next.js primitives would break the benchmark path and
the async-surface portability.

## Layout

- `types.ts` — shared shapes (`CompactIndex`, `RetrieveQuery`, `RankedResult`, …)
- `compact-index/` — rule-based extractor
- `scoring/` — boost primitives
- `overview/` — folder rollup generator
- `core.ts` — `retrieve()` entry point (Task 17+)
- `providers/tatara-hybrid/` — provider adapter extracted in Task 27

See `docs/superpowers/specs/2026-04-22-agent-memory-architecture-design.md`.
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/memory/types.ts src/lib/memory/README.md
git commit -m "$(cat <<'EOF'
feat: scaffold memory subsystem with shared types

Phase 1 Task 2. Types only; implementations in subsequent tasks.
README documents the harness-pure rule that will be enforced by the
boundary check after Task 10.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Compact-index extractor — proper_nouns

**Files:**
- Create: `src/lib/memory/compact-index/proper-nouns.ts`
- Create: `src/lib/memory/compact-index/__tests__/proper-nouns.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/memory/compact-index/__tests__/proper-nouns.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractProperNouns } from '../proper-nouns';

describe('extractProperNouns', () => {
  it('extracts single capitalized tokens', () => {
    expect(extractProperNouns('Acme owns Widget.')).toEqual(['Acme', 'Widget']);
  });

  it('extracts multi-word proper nouns', () => {
    expect(extractProperNouns('Jane Smith joined Acme Corp today.')).toEqual([
      'Jane Smith',
      'Acme Corp',
    ]);
  });

  it('skips sentence-initial non-proper words', () => {
    // "The" and "Today" at sentence start are common-case stopwords.
    expect(
      extractProperNouns('The team met with Acme. Today we signed.'),
    ).toEqual(['Acme']);
  });

  it('deduplicates', () => {
    expect(extractProperNouns('Acme Acme Acme')).toEqual(['Acme']);
  });

  it('caps at 20 entries', () => {
    const content = Array.from({ length: 30 }, (_, i) => `Name${i}`).join(' ');
    expect(extractProperNouns(content)).toHaveLength(20);
  });

  it('returns empty on empty input', () => {
    expect(extractProperNouns('')).toEqual([]);
  });

  it('ignores ALLCAPS tokens', () => {
    expect(extractProperNouns('API HTTP GET Request')).toEqual(['Request']);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx vitest run src/lib/memory/compact-index/__tests__/proper-nouns.test.ts`
Expected: FAIL — "Cannot find module '../proper-nouns'".

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/memory/compact-index/proper-nouns.ts`:

```typescript
// Regex-based proper-noun extraction with a stopword list of sentence-
// initial words that commonly begin sentences without being proper nouns.
// Deterministic, zero-cost; runs on every document save.

const SENTENCE_INITIAL_STOPWORDS = new Set([
  'The', 'A', 'An', 'This', 'That', 'These', 'Those',
  'It', 'We', 'You', 'They', 'He', 'She', 'I',
  'Today', 'Yesterday', 'Tomorrow', 'Now', 'Then',
  'However', 'Therefore', 'But', 'And', 'Or', 'So',
  'After', 'Before', 'When', 'While', 'Since',
]);

const MAX_ENTRIES = 20;

// Matches one or more consecutive Capitalized words (exactly one
// uppercase letter followed by lowercase letters). This excludes
// ALLCAPS acronyms like API / HTTP / GET.
const PROPER_NOUN_RE = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;

export function extractProperNouns(content: string): string[] {
  if (!content) return [];

  const sentences = content.split(/(?<=[.!?])\s+/);
  const seen = new Set<string>();
  const out: string[] = [];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    // Collect candidates with their position in the sentence so we can
    // drop sentence-initial stopwords (position 0).
    let match: RegExpExecArray | null;
    PROPER_NOUN_RE.lastIndex = 0;
    while ((match = PROPER_NOUN_RE.exec(trimmed)) !== null) {
      const phrase = match[1];
      const startsAtZero = match.index === 0;
      const firstWord = phrase.split(/\s+/)[0];

      if (startsAtZero && SENTENCE_INITIAL_STOPWORDS.has(firstWord)) {
        continue;
      }
      if (seen.has(phrase)) continue;

      seen.add(phrase);
      out.push(phrase);
      if (out.length >= MAX_ENTRIES) return out;
    }
  }

  return out;
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npx vitest run src/lib/memory/compact-index/__tests__/proper-nouns.test.ts`
Expected: PASS all 7 cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory/compact-index/proper-nouns.ts src/lib/memory/compact-index/__tests__/proper-nouns.test.ts
git commit -m "$(cat <<'EOF'
feat(memory): proper-noun extractor for compact_index

Phase 1 Task 3. Regex + sentence-initial stopword list; caps at 20.
No LLM cost; runs on every doc save.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Compact-index extractor — key_sentence

**Files:**
- Create: `src/lib/memory/compact-index/key-sentence.ts`
- Create: `src/lib/memory/compact-index/__tests__/key-sentence.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/memory/compact-index/__tests__/key-sentence.test.ts
import { describe, it, expect } from 'vitest';
import { extractKeySentence } from '../key-sentence';

describe('extractKeySentence', () => {
  it('returns the first sentence containing a decision word', () => {
    const content =
      'This is boring intro text.\n\nWe decided to use GraphQL instead of REST. Further prose.';
    expect(extractKeySentence(content)).toBe(
      'We decided to use GraphQL instead of REST.',
    );
  });

  it('falls back to first substantial (>=12 tokens) sentence if no decision words', () => {
    const content =
      'Short. This sentence has more than twelve tokens and should be chosen as the key one.';
    expect(extractKeySentence(content)).toBe(
      'This sentence has more than twelve tokens and should be chosen as the key one.',
    );
  });

  it('truncates at 200 chars', () => {
    const long = 'We decided ' + 'x'.repeat(300) + '.';
    const out = extractKeySentence(long);
    expect(out.length).toBeLessThanOrEqual(200);
  });

  it('returns empty string when no qualifying sentence exists', () => {
    expect(extractKeySentence('Hi. Ok. Maybe.')).toBe('');
  });

  it('strips markdown syntax from the returned sentence', () => {
    const content = '**We decided** to use GraphQL.';
    expect(extractKeySentence(content)).toBe('We decided to use GraphQL.');
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/lib/memory/compact-index/__tests__/key-sentence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implementation**

```typescript
// src/lib/memory/compact-index/key-sentence.ts
//
// Picks one short verbatim sentence to represent the document in
// retrieval results. Priority: sentences with decision words, then
// substantial-length sentences (>=12 tokens), then nothing.

const DECISION_WORDS = [
  'decided', 'chose', 'agreed', 'committed', 'launched',
  'shipped', 'rejected', 'approved', 'selected', 'picked',
  'will', 'must', 'require', 'mandate', 'policy',
];

const MAX_CHARS = 200;
const MIN_TOKENS = 12;

function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')
    .trim();
}

function truncate(s: string): string {
  if (s.length <= MAX_CHARS) return s;
  return s.slice(0, MAX_CHARS - 1).trimEnd() + '…';
}

export function extractKeySentence(content: string): string {
  if (!content) return '';

  const sentences = content
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((s) => stripMarkdown(s.trim()))
    .filter((s) => s.length > 0);

  // Priority 1: first sentence with a decision word.
  for (const s of sentences) {
    const lower = s.toLowerCase();
    if (DECISION_WORDS.some((w) => lower.includes(w))) {
      return truncate(s);
    }
  }

  // Priority 2: first sentence with >= MIN_TOKENS tokens.
  for (const s of sentences) {
    const tokenCount = s.split(/\s+/).length;
    if (tokenCount >= MIN_TOKENS) return truncate(s);
  }

  return '';
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/lib/memory/compact-index/__tests__/key-sentence.test.ts`
Expected: PASS 5/5.

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory/compact-index/key-sentence.ts src/lib/memory/compact-index/__tests__/key-sentence.test.ts
git commit -m "feat(memory): key-sentence extractor for compact_index

Phase 1 Task 4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Compact-index extractor — flags

**Files:**
- Create: `src/lib/memory/compact-index/flags.ts`
- Create: `src/lib/memory/compact-index/__tests__/flags.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// src/lib/memory/compact-index/__tests__/flags.test.ts
import { describe, it, expect } from 'vitest';
import { extractFlags } from '../flags';

describe('extractFlags', () => {
  it('detects flag headers (## DECISION, ## POLICY, ## CORE)', () => {
    const content = '## DECISION\nWe go with GraphQL.\n\n## POLICY\nText.';
    expect(extractFlags(content).sort()).toEqual(['DECISION', 'POLICY'].sort());
  });

  it('detects frontmatter !decision / !core hints (case-insensitive)', () => {
    // Content excludes the frontmatter block; the caller passes raw content.
    // Here we treat the full document body as input.
    const content = '!decision We chose X.\n\nMore text.';
    expect(extractFlags(content)).toEqual(['DECISION']);
  });

  it('deduplicates across heading and hint sources', () => {
    const content = '## DECISION\nWe chose.\n\n!decision also noted';
    expect(extractFlags(content)).toEqual(['DECISION']);
  });

  it('ignores unknown flags', () => {
    expect(extractFlags('## RANDOMFLAG\ntext')).toEqual([]);
  });

  it('returns empty on no match', () => {
    expect(extractFlags('plain text')).toEqual([]);
  });
});
```

- [ ] **Step 2: Fail**

Run: `npx vitest run src/lib/memory/compact-index/__tests__/flags.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementation**

```typescript
// src/lib/memory/compact-index/flags.ts
//
// Controlled-vocab flag extraction. Looks for:
//   (a) ## FLAG_NAME headings (capital words)
//   (b) !flag_name hints anywhere in content

const CONTROLLED_FLAGS = new Set([
  'DECISION',
  'POLICY',
  'CORE',
  'PIVOT',
  'ORIGIN',
  'SENSITIVE',
  'TECHNICAL',
]);

export function extractFlags(content: string): string[] {
  if (!content) return [];

  const found = new Set<string>();

  // (a) ## HEADING form.
  const headingRe = /^#{1,6}\s+([A-Z][A-Z_]*)\b/gm;
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(content)) !== null) {
    const name = m[1];
    if (CONTROLLED_FLAGS.has(name)) found.add(name);
  }

  // (b) !flag_name form (case-insensitive).
  const hintRe = /(?:^|\s)!([a-z_]+)\b/g;
  while ((m = hintRe.exec(content)) !== null) {
    const name = m[1].toUpperCase();
    if (CONTROLLED_FLAGS.has(name)) found.add(name);
  }

  return Array.from(found).sort();
}
```

- [ ] **Step 4: Pass**

Run: `npx vitest run src/lib/memory/compact-index/__tests__/flags.test.ts`
Expected: PASS 5/5.

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory/compact-index/flags.ts src/lib/memory/compact-index/__tests__/flags.test.ts
git commit -m "feat(memory): flag extractor for compact_index

Phase 1 Task 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Compact-index extractor — date_hints

**Files:**
- Create: `src/lib/memory/compact-index/date-hints.ts`
- Create: `src/lib/memory/compact-index/__tests__/date-hints.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// src/lib/memory/compact-index/__tests__/date-hints.test.ts
import { describe, it, expect } from 'vitest';
import { extractDateHints } from '../date-hints';

describe('extractDateHints', () => {
  it('extracts ISO-8601 date strings', () => {
    expect(extractDateHints('Released on 2026-04-22.')).toEqual(['2026-04-22']);
  });

  it('extracts multiple dates', () => {
    const content = 'Signed 2026-01-15 and renewed 2027-01-15.';
    expect(extractDateHints(content)).toEqual(['2026-01-15', '2027-01-15']);
  });

  it('deduplicates', () => {
    expect(extractDateHints('2026-04-22 and 2026-04-22')).toEqual([
      '2026-04-22',
    ]);
  });

  it('ignores invalid date-looking strings', () => {
    expect(extractDateHints('2026-13-45')).toEqual([]);
    expect(extractDateHints('2026-04-32')).toEqual([]);
  });

  it('caps at 10 entries', () => {
    const content = Array.from(
      { length: 20 },
      (_, i) => `2026-04-${String(i + 1).padStart(2, '0')}`,
    ).join(' ');
    expect(extractDateHints(content)).toHaveLength(10);
  });
});
```

- [ ] **Step 2: Fail → Step 3: Implementation**

```typescript
// src/lib/memory/compact-index/date-hints.ts
const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const MAX_ENTRIES = 10;

function isValidDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  // Validate via Date; reject if it rolled over.
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function extractDateHints(content: string): string[] {
  if (!content) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  ISO_DATE_RE.lastIndex = 0;
  while ((m = ISO_DATE_RE.exec(content)) !== null) {
    const [full, ys, ms, ds] = m;
    const y = Number(ys);
    const mo = Number(ms);
    const d = Number(ds);
    if (!isValidDate(y, mo, d)) continue;
    if (seen.has(full)) continue;
    seen.add(full);
    out.push(full);
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}
```

- [ ] **Step 4: Pass**

Run: `npx vitest run src/lib/memory/compact-index/__tests__/date-hints.test.ts`
Expected: PASS 5/5.

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory/compact-index/date-hints.ts src/lib/memory/compact-index/__tests__/date-hints.test.ts
git commit -m "feat(memory): date-hint extractor for compact_index

Phase 1 Task 6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Compact-index extractor — topics

**Files:**
- Create: `src/lib/memory/compact-index/topics.ts`
- Create: `src/lib/memory/compact-index/__tests__/topics.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// src/lib/memory/compact-index/__tests__/topics.test.ts
import { describe, it, expect } from 'vitest';
import { extractTopics } from '../topics';

describe('extractTopics', () => {
  it('ranks by normalized frequency and excludes stopwords', () => {
    const content =
      'enterprise enterprise enterprise pricing pricing the the the the a a a';
    expect(extractTopics(content).slice(0, 2)).toEqual([
      'enterprise',
      'pricing',
    ]);
  });

  it('normalizes to lowercase', () => {
    const content = 'Pricing Pricing Pricing enterprise enterprise';
    expect(extractTopics(content)).toContain('pricing');
    expect(extractTopics(content)).toContain('enterprise');
  });

  it('caps at 8 entries', () => {
    const content = Array.from({ length: 20 }, (_, i) => `word${i} `.repeat(5))
      .join(' ');
    expect(extractTopics(content).length).toBeLessThanOrEqual(8);
  });

  it('returns empty on empty input', () => {
    expect(extractTopics('')).toEqual([]);
  });

  it('ignores short tokens (<3 chars)', () => {
    expect(extractTopics('ab ab ab pricing pricing pricing')).toEqual([
      'pricing',
    ]);
  });
});
```

- [ ] **Step 2: Fail → Step 3: Implementation**

```typescript
// src/lib/memory/compact-index/topics.ts
//
// Word-frequency topic extraction with stopword filter. Normalized to
// lowercase, length >= 3. Ordered by descending frequency.

const STOPWORDS = new Set([
  'the', 'and', 'but', 'for', 'nor', 'yet', 'so',
  'a', 'an', 'in', 'on', 'at', 'to', 'of', 'with',
  'is', 'was', 'are', 'were', 'be', 'been', 'being',
  'this', 'that', 'these', 'those', 'it', 'its',
  'we', 'you', 'they', 'he', 'she', 'i',
  'not', 'no', 'yes', 'or', 'if', 'then', 'than',
  'by', 'from', 'as', 'into', 'about', 'will', 'would',
  'can', 'could', 'should', 'may', 'might', 'must',
  'have', 'has', 'had', 'do', 'does', 'did',
  'all', 'any', 'some', 'each', 'every',
  'more', 'most', 'less', 'least', 'very',
]);

const MIN_LEN = 3;
const MAX_ENTRIES = 8;

export function extractTopics(content: string): string[] {
  if (!content) return [];

  const counts = new Map<string, number>();
  const tokens = content
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= MIN_LEN && !STOPWORDS.has(t));

  for (const t of tokens) {
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_ENTRIES)
    .map(([w]) => w);
}
```

- [ ] **Step 4: Pass**

Run: `npx vitest run src/lib/memory/compact-index/__tests__/topics.test.ts`
Expected: PASS 5/5.

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory/compact-index/topics.ts src/lib/memory/compact-index/__tests__/topics.test.ts
git commit -m "feat(memory): topics extractor for compact_index

Phase 1 Task 7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Compact-index composer — extract()

**Files:**
- Create: `src/lib/memory/compact-index/extract.ts`
- Create: `src/lib/memory/compact-index/__tests__/extract.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// src/lib/memory/compact-index/__tests__/extract.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { extractCompactIndex } from '../extract';

describe('extractCompactIndex', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T12:00:00Z'));
  });

  it('composes all fields into a CompactIndex', () => {
    const content = '## DECISION\n\nAcme Corp signed on 2026-04-22. Enterprise pricing approved.';
    const result = extractCompactIndex(content, { entities: [] });

    expect(result.proper_nouns).toContain('Acme Corp');
    expect(result.flags).toContain('DECISION');
    expect(result.date_hints).toContain('2026-04-22');
    expect(result.topics).toContain('enterprise');
    expect(result.key_sentence).toBeTruthy();
    expect(result.authored_by).toBe('rule_based');
    expect(result.computed_at).toBe('2026-04-22T12:00:00.000Z');
  });

  it('passes through explicitly provided entities', () => {
    const result = extractCompactIndex('prose', {
      entities: ['acme-corp', 'jane-smith'],
    });
    expect(result.entities).toEqual(['acme-corp', 'jane-smith']);
  });

  it('handles empty content', () => {
    const result = extractCompactIndex('', { entities: [] });
    expect(result.proper_nouns).toEqual([]);
    expect(result.key_sentence).toBe('');
    expect(result.authored_by).toBe('rule_based');
  });
});
```

- [ ] **Step 2: Fail → Step 3: Implementation**

```typescript
// src/lib/memory/compact-index/extract.ts
//
// The main rule-based extractor. Composes the five field extractors
// into a CompactIndex. authored_by is always 'rule_based' from this
// function — higher-precedence sources (generating agents, humans,
// Maintenance Agent) use merge() to stamp their own authored_by.

import type { CompactIndex } from '../types';
import { extractProperNouns } from './proper-nouns';
import { extractKeySentence } from './key-sentence';
import { extractFlags } from './flags';
import { extractDateHints } from './date-hints';
import { extractTopics } from './topics';

export interface ExtractOptions {
  // Entities are not rule-extracted in Phase 1 — they come from
  // frontmatter (Phase 3) or are left empty. Explicit pass-through.
  entities: string[];
}

export function extractCompactIndex(
  content: string,
  options: ExtractOptions,
): CompactIndex {
  return {
    entities: options.entities,
    topics: extractTopics(content),
    flags: extractFlags(content),
    proper_nouns: extractProperNouns(content),
    key_sentence: extractKeySentence(content),
    date_hints: extractDateHints(content),
    authored_by: 'rule_based',
    computed_at: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Pass**

Run: `npx vitest run src/lib/memory/compact-index/__tests__/extract.test.ts`
Expected: PASS 3/3.

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory/compact-index/extract.ts src/lib/memory/compact-index/__tests__/extract.test.ts
git commit -m "feat(memory): compose rule-based extractors into extract()

Phase 1 Task 8.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Compact-index merge with precedence

**Files:**
- Create: `src/lib/memory/compact-index/merge.ts`
- Create: `src/lib/memory/compact-index/__tests__/merge.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// src/lib/memory/compact-index/__tests__/merge.test.ts
import { describe, it, expect } from 'vitest';
import { mergeCompactIndex } from '../merge';
import type { CompactIndex } from '../types';

function base(authored_by: CompactIndex['authored_by']): CompactIndex {
  return {
    entities: [],
    topics: [],
    flags: [],
    proper_nouns: [],
    key_sentence: '',
    date_hints: [],
    authored_by,
    computed_at: '2026-04-22T12:00:00.000Z',
  };
}

describe('mergeCompactIndex', () => {
  it('human beats generating_agent beats maintenance beats rule_based', () => {
    const rb = { ...base('rule_based'), topics: ['rb-topic'] };
    const ma = { ...base('maintenance_agent'), topics: ['ma-topic'] };
    const ga = { ...base('generating_agent'), topics: ['ga-topic'] };
    const hu = { ...base('human'), topics: ['hu-topic'] };

    expect(mergeCompactIndex([rb, ma, ga, hu]).topics).toEqual(['hu-topic']);
    expect(mergeCompactIndex([hu, rb]).topics).toEqual(['hu-topic']);
  });

  it('lower-precedence source fills a field the higher source left empty', () => {
    const rb = { ...base('rule_based'), topics: ['rb-topic'], flags: ['F'] };
    const hu = { ...base('human'), topics: ['hu-topic'] }; // flags empty
    const merged = mergeCompactIndex([rb, hu]);
    expect(merged.topics).toEqual(['hu-topic']);
    expect(merged.flags).toEqual(['F']);
  });

  it('empty inputs return rule_based defaults', () => {
    const merged = mergeCompactIndex([]);
    expect(merged.authored_by).toBe('rule_based');
    expect(merged.topics).toEqual([]);
  });

  it('authored_by reflects the highest-precedence source that contributed', () => {
    const rb = { ...base('rule_based'), topics: ['rb'] };
    const hu = { ...base('human'), flags: ['POLICY'] };
    expect(mergeCompactIndex([rb, hu]).authored_by).toBe('human');
  });
});
```

- [ ] **Step 2: Fail → Step 3: Implementation**

```typescript
// src/lib/memory/compact-index/merge.ts
//
// Precedence-based per-field merge of CompactIndex values from multiple
// sources. Per spec §8.2:
//   human > generating_agent > maintenance_agent > rule_based
//
// For each field, pick the value from the highest-precedence source
// that provided a non-empty value.

import type { AuthoredBy, CompactIndex } from '../types';

const ORDER: Record<AuthoredBy, number> = {
  human: 4,
  generating_agent: 3,
  maintenance_agent: 2,
  rule_based: 1,
};

function empty(v: unknown): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'string') return v.length === 0;
  return false;
}

export function mergeCompactIndex(
  inputs: CompactIndex[],
): CompactIndex {
  // Sort descending by precedence so we iterate highest-first.
  const sorted = [...inputs].sort(
    (a, b) => ORDER[b.authored_by] - ORDER[a.authored_by],
  );

  const fields = [
    'entities',
    'topics',
    'flags',
    'proper_nouns',
    'date_hints',
    'key_sentence',
  ] as const;

  const result: CompactIndex = {
    entities: [],
    topics: [],
    flags: [],
    proper_nouns: [],
    key_sentence: '',
    date_hints: [],
    authored_by: 'rule_based',
    computed_at: new Date().toISOString(),
  };

  let winningAuthor: AuthoredBy = 'rule_based';
  let anyFieldSet = false;

  for (const f of fields) {
    for (const src of sorted) {
      if (!empty(src[f])) {
        // deep-copy arrays; strings copy by value
        (result as any)[f] = Array.isArray(src[f])
          ? [...(src[f] as string[])]
          : src[f];
        if (ORDER[src.authored_by] > ORDER[winningAuthor]) {
          winningAuthor = src.authored_by;
        }
        anyFieldSet = true;
        break;
      }
    }
  }

  if (anyFieldSet) result.authored_by = winningAuthor;
  return result;
}
```

- [ ] **Step 4: Pass**

Run: `npx vitest run src/lib/memory/compact-index/__tests__/merge.test.ts`
Expected: PASS 4/4.

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory/compact-index/merge.ts src/lib/memory/compact-index/__tests__/merge.test.ts
git commit -m "feat(memory): precedence-based merge for compact_index

Phase 1 Task 9. human > generating_agent > maintenance > rule_based.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Extend harness-boundary check to `src/lib/memory/`

**Files:**
- Modify: `scripts/check-harness-boundary.sh`

- [ ] **Step 1: Edit the script**

Change the `TARGET_DIRS` array to include the new memory subsystem:

```bash
TARGET_DIRS=("${ROOT_DIR}/src/lib/agent" "${ROOT_DIR}/src/lib/connectors" "${ROOT_DIR}/src/lib/memory")
```

Also extend the subagent-boundary section similarly — the memory subsystem must not import from `src/lib/subagent/` either.

- [ ] **Step 2: Run the check**

Run: `bash scripts/check-harness-boundary.sh`
Expected: `check-harness-boundary: OK` (assuming no forbidden imports have been added).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add scripts/check-harness-boundary.sh
git commit -m "chore: extend harness-boundary check to src/lib/memory/

Phase 1 Task 10. Memory subsystem must stay platform-agnostic per
AGENTS.md rule.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Create write pipeline + wire compact-index into route handlers

**Files:**
- Create: `src/lib/write-pipeline/ingest.ts`
- Create: `src/lib/write-pipeline/__tests__/ingest.test.ts`
- Modify: `src/app/api/brain/documents/route.ts` (POST: document create)
- Modify: `src/app/api/brain/documents/[id]/route.ts` (PUT/PATCH: document update)

**Important context:** The actual `db.insert(documents)` / `db.update(documents)` happens in route handlers — `src/lib/brain/save.ts` is misnamed (it only contains frontmatter parsing helpers). The spec (§8.1) places the write pipeline at `src/lib/write-pipeline/ingest.ts` as the single merge point that all sources funnel through. Phase 1 creates that module with one stage (compact_index population). Phase 3 adds frontmatter-triple parsing to the same module; Phase 4 makes Maintenance Agent calls into it. Setting it up now locates code where the spec says it belongs without adding features.

- [ ] **Step 1: Read the route handlers**

Read both:
- `src/app/api/brain/documents/route.ts` (look for `db.insert(documents)`)
- `src/app/api/brain/documents/[id]/route.ts` (look for `db.update(documents)`)

Identify exactly where the new row's `content` and parsed frontmatter are available. That's the call site for the write pipeline.

- [ ] **Step 2: Failing unit test for the pipeline**

Create `src/lib/write-pipeline/__tests__/ingest.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { populateCompactIndexForWrite } from '../ingest';

describe('populateCompactIndexForWrite', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T12:00:00Z'));
  });

  it('returns a CompactIndex with rule_based authoring', () => {
    const ci = populateCompactIndexForWrite({
      content: '## DECISION\n\nAcme Corp signed.',
      frontmatterEntities: [],
    });
    expect(ci.authored_by).toBe('rule_based');
    expect(ci.flags).toContain('DECISION');
    expect(ci.proper_nouns).toContain('Acme Corp');
  });

  it('passes frontmatter entities through unchanged', () => {
    const ci = populateCompactIndexForWrite({
      content: 'prose',
      frontmatterEntities: ['acme-corp'],
    });
    expect(ci.entities).toEqual(['acme-corp']);
  });
});
```

- [ ] **Step 3: Fail**

Run: `npx vitest run src/lib/write-pipeline/__tests__/ingest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the pipeline module**

Create `src/lib/write-pipeline/ingest.ts`:

```typescript
// Single merge point for document writes (spec §8.1). Phase 1 contains
// only one stage: rule-based compact_index population. Phase 3 adds
// frontmatter-triple parsing here; Phase 4 the Maintenance Agent calls
// the same function with authored_by='maintenance_agent'.
//
// Harness-pure. No Next.js / Vercel imports. Callable from route
// handlers, cron handlers, tests, benchmarks.

import type { CompactIndex } from '@/lib/memory/types';
import { extractCompactIndex } from '@/lib/memory/compact-index/extract';

export interface WriteIngestInput {
  content: string;
  frontmatterEntities: string[];
}

/**
 * Compute the CompactIndex that should land in `documents.compact_index`
 * on insert or update. Caller is responsible for the actual DB write.
 */
export function populateCompactIndexForWrite(
  input: WriteIngestInput,
): CompactIndex {
  return extractCompactIndex(input.content, {
    entities: input.frontmatterEntities,
  });
}
```

- [ ] **Step 5: Pass unit test**

Run: `npx vitest run src/lib/write-pipeline/__tests__/ingest.test.ts`
Expected: PASS 2/2.

- [ ] **Step 6: Wire into the create route**

In `src/app/api/brain/documents/route.ts`, the route already parses the frontmatter (to derive `type`) and loads the folder row. **Reuse both** — don't re-parse or re-load. Immediately before `db.insert(documents).values(...)`, add:

```typescript
import { populateCompactIndexForWrite } from '@/lib/write-pipeline/ingest';
// parseFrontmatterRaw is already imported in this file — reuse the
// parsed frontmatter variable the type-derivation code produces.

// `frontmatter` here is the existing Record<string, …> already parsed
// upstream by extractDocumentTypeFromContent / parseFrontmatterRaw.
// If the route keeps the parsed object in a local variable, reuse it;
// otherwise, parse once at the top of the handler and thread through.
const fmEntities = Array.isArray((frontmatter as any).entities)
  ? ((frontmatter as any).entities as unknown[]).filter(
      (e): e is string => typeof e === 'string',
    )
  : [];

const compactIndex = populateCompactIndexForWrite({
  content: finalContent,
  frontmatterEntities: fmEntities,
});

await db.insert(documents).values({
  // ... existing fields ...
  compactIndex,
});
```

- [ ] **Step 7: Wire into the update route**

In `src/app/api/brain/documents/[id]/route.ts`, same pattern — reuse the already-parsed frontmatter and the already-loaded `existing` row (the prior version fetched at the top of the handler). Immediately before `db.update(documents).set(...)`:

```typescript
import { populateCompactIndexForWrite } from '@/lib/write-pipeline/ingest';

const fmEntities = Array.isArray((frontmatter as any).entities)
  ? ((frontmatter as any).entities as unknown[]).filter(
      (e): e is string => typeof e === 'string',
    )
  : [];

const compactIndex = populateCompactIndexForWrite({
  content: updatedContent,
  frontmatterEntities: fmEntities,
});

await db
  .update(documents)
  .set({
    // ... existing fields ...
    compactIndex,
  })
  .where(eq(documents.id, id));
```

If either route handles multiple branches (e.g. create vs. fork vs. revision), wire the call into every path that produces a final `content` string.

- [ ] **Step 8: Integration test against the route handlers**

If route-level integration tests exist for documents (check `src/app/api/brain/documents/__tests__/`), extend one to assert that after a successful POST, `documents.compact_index` is non-null and has `authored_by === 'rule_based'`. If no such test exists, add one — but keep scope tight: one happy-path POST + read.

```typescript
// src/app/api/brain/documents/__tests__/compact-index-on-write.test.ts
// Integration test using the existing test harness for route handlers.
// Confirms compact_index is populated end-to-end through the route.

it('POST /api/brain/documents populates compact_index', async () => {
  const res = await postDocumentViaTestHarness({
    title: 'Compact Index Wire Test',
    content: '## DECISION\n\nAcme Corp signed on 2026-04-22.',
    // brainId, companyId via the harness's existing context fixture
  });
  const created = await res.json();

  const [row] = await db
    .select({ compactIndex: documents.compactIndex })
    .from(documents)
    .where(eq(documents.id, created.id))
    .limit(1);

  const ci = row.compactIndex as any;
  expect(ci.authored_by).toBe('rule_based');
  expect(ci.flags).toContain('DECISION');
});
```

If the project lacks a route-test harness, fall back to: import the relevant POST handler directly, build a minimal `Request`, invoke it, and assert against the DB.

- [ ] **Step 9: Regression — run all existing tests**

Run: `npx vitest run`
Expected: all pre-existing tests pass. The `compact_index` column is **nullable at the DB level** (Task 1 does not add NOT NULL), so direct-insert fixtures in existing tests continue to work; failures here would only come from tests that *assert* specific compact_index content or downstream code that demands it. Fix forward by either updating those tests' expectations or by populating compact_index in the fixture.

- [ ] **Step 10: Commit**

```bash
git add src/lib/write-pipeline/ src/app/api/brain/documents/route.ts src/app/api/brain/documents/[id]/route.ts src/app/api/brain/documents/__tests__/
git commit -m "$(cat <<'EOF'
feat: write-pipeline module populates compact_index on every save

Phase 1 Task 11. Creates src/lib/write-pipeline/ingest.ts as the
single merge point per spec §8.1. Both create and update route
handlers call it before db.insert / db.update.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Admin backfill endpoint for existing documents

**Files:**
- Create: `src/app/api/admin/backfill-compact-index/route.ts`

- [ ] **Step 1: Failing test (optional — this is a one-shot admin job)**

Skip a dedicated test; verify manually after invocation by querying `documents WHERE compact_index IS NULL`.

- [ ] **Step 2: Write the handler**

Create `src/app/api/admin/backfill-compact-index/route.ts`:

```typescript
// One-shot backfill of compact_index for documents written before
// Task 11 landed. Paginates in batches; each batch is a single
// transaction. Invoked manually by an admin after migration 0022 is
// applied.
//
// Route-layer code — Next.js primitives OK here.

import { NextResponse } from 'next/server';
import { eq, isNull, and } from 'drizzle-orm';
import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { extractCompactIndex } from '@/lib/memory/compact-index/extract';
import { requireAdmin } from '@/lib/auth/require-admin';

export const maxDuration = 300; // 5 min for large corpora

const BATCH_SIZE = 500;

export async function POST(request: Request) {
  await requireAdmin(request);

  const url = new URL(request.url);
  const brainId = url.searchParams.get('brainId'); // optional scope

  let totalUpdated = 0;

  // Loop batches until no rows remain with compact_index IS NULL.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await db
      .select({
        id: documents.id,
        content: documents.content,
        metadata: documents.metadata,
      })
      .from(documents)
      .where(
        brainId
          ? and(isNull(documents.compactIndex), eq(documents.brainId, brainId))
          : isNull(documents.compactIndex),
      )
      .limit(BATCH_SIZE);

    if (rows.length === 0) break;

    for (const row of rows) {
      const frontmatterEntities =
        (row.metadata as Record<string, unknown> | null)?.entities as
          | string[]
          | undefined;
      const ci = extractCompactIndex(row.content ?? '', {
        entities: frontmatterEntities ?? [],
      });
      await db
        .update(documents)
        .set({ compactIndex: ci })
        .where(eq(documents.id, row.id));
    }

    totalUpdated += rows.length;
  }

  return NextResponse.json({ updated: totalUpdated });
}
```

**Note:** `requireAdmin` should be whatever admin-gate helper the project uses. If unavailable, reject with a 403 unless the request carries an env-configured admin token. DO NOT ship an unauthenticated backfill endpoint.

- [ ] **Step 3: Manual verification**

Run locally:
```bash
curl -X POST 'http://localhost:3000/api/admin/backfill-compact-index' \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```
Expected: JSON response `{"updated": N}` where N is the number of docs backfilled.

Then verify:
```sql
SELECT COUNT(*) FROM documents WHERE compact_index IS NULL;
-- Expected: 0 (or only soft-deleted rows)
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/backfill-compact-index/route.ts
git commit -m "feat: admin endpoint to backfill compact_index for legacy docs

Phase 1 Task 12. Paginates in 500-row batches. Admin-gated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Scoring primitive — phrase-boost

**Files:**
- Create: `src/lib/memory/scoring/phrase-boost.ts`
- Create: `src/lib/memory/scoring/__tests__/phrase-boost.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// src/lib/memory/scoring/__tests__/phrase-boost.test.ts
import { describe, it, expect } from 'vitest';
import { phraseBoost } from '../phrase-boost';

describe('phraseBoost', () => {
  it('returns 1.6 when content contains the quoted phrase', () => {
    expect(phraseBoost('"quoted phrase" other', 'this quoted phrase here')).toBe(1.6);
  });

  it('returns 1.0 when there are no quoted phrases in the query', () => {
    expect(phraseBoost('plain query', 'any content')).toBe(1.0);
  });

  it('returns 1.0 when quoted phrase is NOT in the content', () => {
    expect(phraseBoost('"missing"', 'other content')).toBe(1.0);
  });

  it('stacks multiplicatively for multiple phrases', () => {
    const score = phraseBoost('"one" "two"', 'one two both here');
    expect(score).toBeCloseTo(1.6 * 1.6);
  });

  it('is case-insensitive on the match', () => {
    expect(phraseBoost('"Acme Corp"', 'acme corp rocks')).toBe(1.6);
  });
});
```

- [ ] **Step 2: Fail → Step 3: Implementation**

```typescript
// src/lib/memory/scoring/phrase-boost.ts
//
// Multiplicative boost applied to a document's score when the query
// contains one or more quoted phrases AND the document verbatim
// contains that phrase. Case-insensitive match. Per spec §7 hybrid
// scoring.

const BOOST = 1.6;

export function phraseBoost(query: string, content: string): number {
  const phrases = extractQuotedPhrases(query);
  if (phrases.length === 0) return 1.0;

  const lowerContent = content.toLowerCase();
  let multiplier = 1.0;
  for (const p of phrases) {
    if (lowerContent.includes(p.toLowerCase())) multiplier *= BOOST;
  }
  return multiplier;
}

function extractQuotedPhrases(query: string): string[] {
  const out: string[] = [];
  const re = /"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query)) !== null) {
    const trimmed = m[1].trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}
```

- [ ] **Step 4: Pass + Commit**

```bash
npx vitest run src/lib/memory/scoring/__tests__/phrase-boost.test.ts
git add src/lib/memory/scoring/phrase-boost.ts src/lib/memory/scoring/__tests__/phrase-boost.test.ts
git commit -m "feat(memory): phrase-boost scoring primitive

Phase 1 Task 13. 1.6x multiplier on quoted-phrase match.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Scoring primitive — proper-noun-boost

**Files:**
- Create: `src/lib/memory/scoring/proper-noun-boost.ts`
- Create: `src/lib/memory/scoring/__tests__/proper-noun-boost.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// src/lib/memory/scoring/__tests__/proper-noun-boost.test.ts
import { describe, it, expect } from 'vitest';
import { properNounBoost } from '../proper-noun-boost';

describe('properNounBoost', () => {
  it('boosts 1.4x when a proper noun from the query appears in content verbatim', () => {
    expect(properNounBoost('who is Jane', 'Jane leads sales')).toBe(1.4);
  });

  it('returns 1.0 when query has no capitalized tokens', () => {
    expect(properNounBoost('who leads sales', 'anything')).toBe(1.0);
  });

  it('returns 1.0 when proper noun is NOT in content', () => {
    expect(properNounBoost('who is Acme', 'no match here')).toBe(1.0);
  });

  it('ignores sentence-initial stopwords like "The"', () => {
    // "The" at query start should not trigger the boost
    expect(properNounBoost('The sales leader', 'sales is great')).toBe(1.0);
  });

  it('stacks multiplicatively for multiple matches (but caps at 2.0 total)', () => {
    const score = properNounBoost('Jane Smith at Acme', 'Jane Smith works at Acme');
    expect(score).toBeLessThanOrEqual(2.0);
    expect(score).toBeGreaterThan(1.4);
  });
});
```

- [ ] **Step 2: Fail → Step 3: Implementation**

```typescript
// src/lib/memory/scoring/proper-noun-boost.ts
//
// Multiplicative boost applied when proper nouns from the query appear
// verbatim in the document content. Reuses the proper-noun extractor
// so query-side and doc-side share one definition.

import { extractProperNouns } from '../compact-index/proper-nouns';

const PER_MATCH = 1.4;
const CAP = 2.0;

export function properNounBoost(query: string, content: string): number {
  const queryNouns = extractProperNouns(query);
  if (queryNouns.length === 0) return 1.0;

  let multiplier = 1.0;
  for (const n of queryNouns) {
    if (content.includes(n)) {
      multiplier *= PER_MATCH;
      if (multiplier >= CAP) return CAP;
    }
  }
  return Math.min(multiplier, CAP);
}
```

- [ ] **Step 4: Pass + Commit**

```bash
npx vitest run src/lib/memory/scoring/__tests__/proper-noun-boost.test.ts
git add src/lib/memory/scoring/proper-noun-boost.ts src/lib/memory/scoring/__tests__/proper-noun-boost.test.ts
git commit -m "feat(memory): proper-noun-boost scoring primitive

Phase 1 Task 14. 1.4x per match, capped at 2.0.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Scoring primitive — temporal-proximity

**Files:**
- Create: `src/lib/memory/scoring/temporal-proximity.ts`
- Create: `src/lib/memory/scoring/__tests__/temporal-proximity.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// src/lib/memory/scoring/__tests__/temporal-proximity.test.ts
import { describe, it, expect } from 'vitest';
import { temporalProximity } from '../temporal-proximity';

describe('temporalProximity', () => {
  it('returns 1.0 when query has no date', () => {
    expect(temporalProximity('plain query', new Date('2026-04-22'))).toBe(1.0);
  });

  it('returns max boost 1.4 when query date matches doc updated_at exactly', () => {
    const d = new Date('2026-04-22');
    expect(temporalProximity('updated on 2026-04-22', d)).toBeCloseTo(1.4);
  });

  it('decays with distance', () => {
    const d = new Date('2026-04-22');
    const boost30 = temporalProximity('updated on 2026-03-23', d);
    const boost365 = temporalProximity('updated on 2025-04-22', d);
    expect(boost30).toBeLessThan(1.4);
    expect(boost30).toBeGreaterThan(1.0);
    expect(boost365).toBeLessThan(boost30);
    expect(boost365).toBeGreaterThanOrEqual(1.0);
  });

  it('returns 1.0 when query date is invalid', () => {
    expect(temporalProximity('not a date', new Date())).toBe(1.0);
  });
});
```

- [ ] **Step 2: Fail → Step 3: Implementation**

```typescript
// src/lib/memory/scoring/temporal-proximity.ts
//
// Multiplicative boost that favors documents whose updated_at is close
// to a date mentioned in the query. Max 1.4x at zero distance, decays
// geometrically with day-distance; floored at 1.0.

import { extractDateHints } from '../compact-index/date-hints';

const MAX_BOOST = 1.4;
const HALF_LIFE_DAYS = 180;

export function temporalProximity(
  query: string,
  docUpdatedAt: Date,
): number {
  const queryDates = extractDateHints(query);
  if (queryDates.length === 0) return 1.0;

  const docMs = docUpdatedAt.getTime();
  let best = 1.0;
  for (const iso of queryDates) {
    const qMs = new Date(iso).getTime();
    if (Number.isNaN(qMs)) continue;
    const days = Math.abs(docMs - qMs) / (1000 * 60 * 60 * 24);
    const decay = Math.pow(0.5, days / HALF_LIFE_DAYS);
    const boost = 1.0 + (MAX_BOOST - 1.0) * decay;
    if (boost > best) best = boost;
  }
  return best;
}
```

- [ ] **Step 4: Pass + Commit**

```bash
npx vitest run src/lib/memory/scoring/__tests__/temporal-proximity.test.ts
git add src/lib/memory/scoring/temporal-proximity.ts src/lib/memory/scoring/__tests__/temporal-proximity.test.ts
git commit -m "feat(memory): temporal-proximity scoring primitive

Phase 1 Task 15. 1.4x max at zero distance, 180-day half-life decay.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Scoring compose — combine boosts

**Files:**
- Create: `src/lib/memory/scoring/compose.ts`
- Create: `src/lib/memory/scoring/__tests__/compose.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// src/lib/memory/scoring/__tests__/compose.test.ts
import { describe, it, expect } from 'vitest';
import { composeBoostedScore } from '../compose';

describe('composeBoostedScore', () => {
  it('multiplies tsRank by all applicable boosts', () => {
    const score = composeBoostedScore({
      tsRank: 0.5,
      query: '"decision" made by Jane',
      content: 'The decision was made by Jane.',
      docUpdatedAt: new Date('2026-04-22'),
    });
    // phraseBoost: 1.6, properNounBoost: 1.4, temporalProximity: 1.0 (no query date)
    expect(score).toBeCloseTo(0.5 * 1.6 * 1.4);
  });

  it('returns tsRank unchanged when no boosts apply', () => {
    const score = composeBoostedScore({
      tsRank: 0.3,
      query: 'plain query',
      content: 'irrelevant content',
      docUpdatedAt: new Date(),
    });
    expect(score).toBe(0.3);
  });
});
```

- [ ] **Step 2: Fail → Step 3: Implementation**

```typescript
// src/lib/memory/scoring/compose.ts
//
// Composes the three boost primitives into a single multiplier applied
// to tsRank. Phase 2 will add embedding similarity as an additive term
// with its own weight; Phase 1 is lexical + boosts only.

import { phraseBoost } from './phrase-boost';
import { properNounBoost } from './proper-noun-boost';
import { temporalProximity } from './temporal-proximity';

export interface ComposeInput {
  tsRank: number;
  query: string;
  content: string;
  docUpdatedAt: Date;
}

export function composeBoostedScore(input: ComposeInput): number {
  const { tsRank, query, content, docUpdatedAt } = input;
  const m =
    phraseBoost(query, content) *
    properNounBoost(query, content) *
    temporalProximity(query, docUpdatedAt);
  return tsRank * m;
}
```

- [ ] **Step 4: Pass + Commit**

```bash
npx vitest run src/lib/memory/scoring/__tests__/compose.test.ts
git add src/lib/memory/scoring/compose.ts src/lib/memory/scoring/__tests__/compose.test.ts
git commit -m "feat(memory): compose boost primitives into single multiplier

Phase 1 Task 16.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Retrieval core — scan mode

**Files:**
- Create: `src/lib/memory/core.ts`
- Create: `src/lib/memory/__tests__/core.test.ts`

- [ ] **Step 1: Integration test (against dev DB)**

```typescript
// src/lib/memory/__tests__/core.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { retrieve } from '../core';
import { seedTwoDocumentsInOneBrain } from './_fixtures';  // helper you'll write

// The fixtures helper seeds a brain with two documents and returns
// { companyId, brainId, docAId, docBId }. Keep it focused on what
// this test needs.

describe('retrieve — scan mode', () => {
  let ctx: Awaited<ReturnType<typeof seedTwoDocumentsInOneBrain>>;

  beforeAll(async () => {
    ctx = await seedTwoDocumentsInOneBrain({
      docA: { title: 'A', content: 'Acme Corp enterprise pricing.' },
      docB: { title: 'B', content: 'Unrelated content.' },
    });
  });

  it('returns hits with provenance and compact_index, no content', async () => {
    const results = await retrieve({
      brainId: ctx.brainId,
      companyId: ctx.companyId,
      query: 'Acme',
      mode: 'scan',
      tierCeiling: 'extracted',
      limit: 10,
    });

    expect(results.length).toBeGreaterThan(0);
    const hit = results[0];
    expect(hit.provenance.brainId).toBe(ctx.brainId);
    expect(hit.provenance.confidenceTier).toBe('extracted');
    expect(hit.snippet.mode).toBe('compact');
    expect(hit.compactIndex).toBeDefined();
    expect(hit.excerpt).toBeUndefined();
  });
});
```

Create `src/lib/memory/__tests__/_fixtures.ts` with seeding helpers tailored to the project's existing test DB conventions. Use `saveBrainDocument` from Task 11 to insert so compact_index is populated. Return the IDs.

- [ ] **Step 2: Fail → Step 3: Implementation**

Create `src/lib/memory/core.ts`:

```typescript
// src/lib/memory/core.ts
//
// retrieve() — the single entry point for document retrieval. Pure
// TypeScript, DB-only. Callable from route handlers, cron, tests,
// benchmarks.
//
// Phase 1: lexical (tsvector) + compact_index + scoring boosts.
// Phase 2 will add pgvector; Phase 3 adds kg_query and tier-gated
// triple retrieval. tierCeiling is already plumbed here so Phase 3
// needs no signature change.

import { sql } from 'drizzle-orm';
import { db } from '@/db';
import type {
  CompactIndex,
  RankedResult,
  RetrieveQuery,
} from './types';
import { composeBoostedScore } from './scoring/compose';

interface RawRow {
  id: string;
  slug: string;
  title: string;
  path: string;
  content: string;
  updated_at: Date;
  version: number;
  ts_rank: string | number;
  ts_headline: string;
  compact_index: CompactIndex | null;
  folder_slug: string | null;
}

export async function retrieve(q: RetrieveQuery): Promise<RankedResult[]> {
  const limit = q.limit ?? 10;

  const rows = (await db.execute(sql`
    SELECT
      d.id,
      d.slug,
      d.title,
      d.path,
      d.content,
      d.updated_at,
      d.version,
      ts_rank(d.search_vector, plainto_tsquery('english', ${q.query})) AS ts_rank,
      ts_headline(
        'english',
        d.content,
        plainto_tsquery('english', ${q.query}),
        'MaxWords=35, MinWords=15'
      ) AS ts_headline,
      d.compact_index,
      f.slug AS folder_slug
    FROM documents d
    LEFT JOIN folders f ON f.id = d.folder_id
    WHERE d.company_id = ${q.companyId}
      AND d.brain_id = ${q.brainId}
      AND d.deleted_at IS NULL
      AND d.status != 'archived'
      AND d.type IS NULL  -- excludes scaffolding/skills/agent-defs/overviews; matches existing search_documents semantics
      AND d.search_vector @@ plainto_tsquery('english', ${q.query})
    ORDER BY ts_rank DESC
    LIMIT ${limit * 3}
  `)) as unknown as RawRow[];

  // Re-score with boost composition, then sort and truncate to limit.
  const scored = rows.map((r) => {
    const tsRank =
      typeof r.ts_rank === 'number' ? r.ts_rank : Number(r.ts_rank);
    const score = composeBoostedScore({
      tsRank,
      query: q.query,
      content: r.content,
      docUpdatedAt: r.updated_at,
    });
    return { row: r, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);

  return top.map(({ row, score }) => toResult(row, score, q.mode));
}

function toResult(
  row: RawRow,
  score: number,
  mode: RetrieveQuery['mode'],
): RankedResult {
  const base: RankedResult = {
    documentId: row.id,
    slug: row.slug,
    title: row.title,
    score,
    provenance: {
      brainId: '',  // filled below from context
      path: row.path,
      updatedAt: row.updated_at.toISOString(),
      version: row.version,
      confidenceTier: 'extracted',
    },
    snippet: { mode: 'compact', text: '' },
  };

  if (mode === 'scan') {
    return {
      ...base,
      snippet: { mode: 'compact', text: serializeCompact(row.compact_index) },
      compactIndex: row.compact_index ?? undefined,
    };
  }

  // expand / hybrid are Task 18+.
  throw new Error(`retrieve: mode "${mode}" not yet implemented`);
}

function serializeCompact(ci: CompactIndex | null): string {
  if (!ci) return '';
  const parts: string[] = [];
  if (ci.entities.length) parts.push(`entities: ${ci.entities.join(', ')}`);
  if (ci.topics.length) parts.push(`topics: ${ci.topics.join(', ')}`);
  if (ci.flags.length) parts.push(`flags: ${ci.flags.join(', ')}`);
  if (ci.key_sentence) parts.push(`"${ci.key_sentence}"`);
  return parts.join(' | ');
}
```

**Note:** `provenance.brainId` is left empty by `toResult` — fill it before returning by passing `q.brainId` through. Refactor the composer to set it: `base.provenance.brainId = q.brainId`. Keep this minimal; details get richer in Task 18.

Fix the brainId plumbing before moving on:

```typescript
// inside retrieve(), after the top.map:
return top.map(({ row, score }) => {
  const r = toResult(row, score, q.mode);
  r.provenance.brainId = q.brainId;
  return r;
});
```

- [ ] **Step 4: Pass**

Run: `npx vitest run src/lib/memory/__tests__/core.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory/core.ts src/lib/memory/__tests__/core.test.ts src/lib/memory/__tests__/_fixtures.ts
git commit -m "$(cat <<'EOF'
feat(memory): retrieval core with scan mode

Phase 1 Task 17. Lexical tsvector + scoring boosts + provenance.
expand and hybrid modes in subsequent tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Retrieval core — expand mode

**Files:**
- Modify: `src/lib/memory/core.ts`
- Modify: `src/lib/memory/__tests__/core.test.ts`

- [ ] **Step 1: Failing test — expand mode includes excerpt**

Add to `core.test.ts`:

```typescript
describe('retrieve — expand mode', () => {
  // ... same fixture setup ...
  it('returns headline + excerpt', async () => {
    const results = await retrieve({
      brainId: ctx.brainId,
      companyId: ctx.companyId,
      query: 'Acme',
      mode: 'expand',
      tierCeiling: 'extracted',
      limit: 10,
    });
    expect(results[0].snippet.mode).toBe('headline');
    expect(results[0].excerpt).toBeDefined();
  });
});
```

- [ ] **Step 2: Fail**

Run: `npx vitest run src/lib/memory/__tests__/core.test.ts`
Expected: FAIL — throw from `toResult`.

- [ ] **Step 3: Implementation — extend `toResult`**

Replace the `toResult` function in `core.ts`:

```typescript
function toResult(
  row: RawRow,
  score: number,
  mode: RetrieveQuery['mode'],
): RankedResult {
  const base: RankedResult = {
    documentId: row.id,
    slug: row.slug,
    title: row.title,
    score,
    provenance: {
      brainId: '',
      path: row.path,
      updatedAt: row.updated_at.toISOString(),
      version: row.version,
      confidenceTier: 'extracted',
    },
    snippet: { mode: 'compact', text: '' },
  };

  if (mode === 'scan') {
    return {
      ...base,
      snippet: { mode: 'compact', text: serializeCompact(row.compact_index) },
      compactIndex: row.compact_index ?? undefined,
    };
  }

  if (mode === 'expand') {
    const { before, match, after } = sliceExcerpt(row.content, row.ts_headline);
    return {
      ...base,
      snippet: { mode: 'headline', text: row.ts_headline ?? '' },
      compactIndex: row.compact_index ?? undefined,
      excerpt: { before, match, after },
    };
  }

  // hybrid is Task 19.
  throw new Error(`retrieve: mode "${mode}" not yet implemented`);
}

function sliceExcerpt(
  content: string,
  headline: string,
): { before: string; match: string; after: string } {
  // Strip ts_headline markup (<b>…</b>) to find the match position.
  const bare = headline.replace(/<\/?b>/g, '');
  const idx = content.indexOf(bare);
  if (idx < 0) return { before: '', match: bare, after: '' };

  const CONTEXT = 160;
  return {
    before: content.slice(Math.max(0, idx - CONTEXT), idx),
    match: bare,
    after: content.slice(idx + bare.length, idx + bare.length + CONTEXT),
  };
}
```

- [ ] **Step 4: Pass**

Run: `npx vitest run src/lib/memory/__tests__/core.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory/core.ts src/lib/memory/__tests__/core.test.ts
git commit -m "feat(memory): expand mode in retrieval core

Phase 1 Task 18. ts_headline + ±160 char excerpt context.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 19: Retrieval core — hybrid mode

**Files:**
- Modify: `src/lib/memory/core.ts`
- Modify: `src/lib/memory/__tests__/core.test.ts`

- [ ] **Step 1: Failing test — top-3 expand, rest scan**

```typescript
describe('retrieve — hybrid mode', () => {
  it('top 3 results are expand, rest are scan', async () => {
    const results = await retrieve({
      brainId: ctx.brainId,
      companyId: ctx.companyId,
      query: 'Acme',
      mode: 'hybrid',
      tierCeiling: 'extracted',
      limit: 5,
    });
    // Assumes fixture seeds >= 5 matching docs. Adapt fixture if needed.
    expect(results.slice(0, 3).every((r) => r.snippet.mode === 'headline')).toBe(true);
    expect(results.slice(3).every((r) => r.snippet.mode === 'compact')).toBe(true);
  });
});
```

Extend `seedTwoDocumentsInOneBrain` to `seedNDocumentsInOneBrain(n)` or similar — seed 5+ matching docs for this test.

- [ ] **Step 2: Fail → Step 3: Implementation**

Update the `retrieve` function's tail:

```typescript
// At the tail of retrieve():
return top.map(({ row, score }, idx) => {
  const rowMode: RetrieveQuery['mode'] =
    q.mode === 'hybrid' ? (idx < 3 ? 'expand' : 'scan') : q.mode;
  const r = toResult(row, score, rowMode);
  r.provenance.brainId = q.brainId;
  return r;
});
```

- [ ] **Step 4: Pass + Commit**

```bash
npx vitest run src/lib/memory/__tests__/core.test.ts
git add src/lib/memory/core.ts src/lib/memory/__tests__/core.test.ts
git commit -m "feat(memory): hybrid mode — top-3 expand, rest scan

Phase 1 Task 19.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 20: Tier ceiling enforcement

**Files:**
- Modify: `src/lib/memory/core.ts`
- Modify: `src/lib/memory/types.ts` (tighten a role type)
- Create: `src/lib/memory/__tests__/tier-gate.test.ts`

**Note:** Phase 1 has no triples in the DB yet, so there's no inferred content for the core to "refuse to load." This task establishes the mechanism so Phase 3 has no refactor to do. We add:
1. A type-level caller-role constraint so customer-facing call sites can't pass `'inferred'` by construction.
2. A runtime assertion at the top of `retrieve()` for defense in depth.

- [ ] **Step 1: Failing test**

```typescript
// src/lib/memory/__tests__/tier-gate.test.ts
import { describe, it, expect } from 'vitest';
import { retrieve } from '../core';
import { assertTierAllowed } from '../core';

describe('tier ceiling enforcement', () => {
  it('throws when a strict-role context requests inferred tier', () => {
    expect(() =>
      assertTierAllowed({ role: 'customer_facing' }, 'inferred'),
    ).toThrow(/tier/i);
  });

  it('allows research_subagent role to request inferred', () => {
    expect(() =>
      assertTierAllowed({ role: 'research_subagent' }, 'inferred'),
    ).not.toThrow();
  });

  it('allows strict roles to request authored or extracted', () => {
    expect(() =>
      assertTierAllowed({ role: 'customer_facing' }, 'extracted'),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Fail → Step 3: Implementation**

Add to `src/lib/memory/types.ts`:

```typescript
export type CallerRole = 'customer_facing' | 'research_subagent' | 'maintenance_agent';

export interface CallerContext {
  role: CallerRole;
}
```

Add to `src/lib/memory/core.ts` and export:

```typescript
import type { CallerContext, ConfidenceTier } from './types';

export function assertTierAllowed(
  caller: CallerContext,
  requested: ConfidenceTier,
): void {
  if (requested === 'inferred' && caller.role !== 'research_subagent') {
    throw new Error(
      `Retrieval: role "${caller.role}" cannot request tierCeiling "inferred". ` +
        `Only research_subagent may.`,
    );
  }
}
```

Update `retrieve()` signature to optionally accept a caller context, and call the assertion:

```typescript
export async function retrieve(
  q: RetrieveQuery,
  caller: CallerContext = { role: 'customer_facing' },
): Promise<RankedResult[]> {
  assertTierAllowed(caller, q.tierCeiling);
  // … existing body …
}
```

- [ ] **Step 4: Pass + Commit**

```bash
npx vitest run src/lib/memory/__tests__/tier-gate.test.ts
git add src/lib/memory/core.ts src/lib/memory/types.ts src/lib/memory/__tests__/tier-gate.test.ts
git commit -m "$(cat <<'EOF'
feat(memory): tier-ceiling assertion for caller roles

Phase 1 Task 20. Establishes the enforcement seam ahead of Phase 3
triple retrieval. customer_facing cannot request inferred; only
research_subagent may.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 21: Cross-tenancy integration test suite

**Files:**
- Create: `src/lib/memory/__tests__/cross-tenancy.test.ts`

This test is CORRECTNESS-CRITICAL. A failure here is a security regression.

- [ ] **Step 1: Write the test**

```typescript
// src/lib/memory/__tests__/cross-tenancy.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { retrieve } from '../core';
import {
  seedBrainInCompany,
} from './_fixtures';

describe('cross-tenancy isolation', () => {
  let a: Awaited<ReturnType<typeof seedBrainInCompany>>;
  let b: Awaited<ReturnType<typeof seedBrainInCompany>>;

  beforeAll(async () => {
    a = await seedBrainInCompany({
      docs: [{ title: 'SECRET-A', content: 'Acme secret contract terms.' }],
    });
    b = await seedBrainInCompany({
      docs: [{ title: 'OTHER-B', content: 'Unrelated content.' }],
    });
    // a and b MUST have different companyIds.
    expect(a.companyId).not.toBe(b.companyId);
  });

  it('retrieve scoped to company A never returns company B docs', async () => {
    const res = await retrieve({
      companyId: a.companyId,
      brainId: a.brainId,
      query: 'secret OR content OR Acme OR Unrelated',
      mode: 'hybrid',
      tierCeiling: 'extracted',
      limit: 50,
    });
    const slugs = res.map((r) => r.slug);
    expect(slugs).toContain(a.docs[0].slug);
    expect(slugs).not.toContain(b.docs[0].slug);
  });

  it('retrieve with wrong brainId for the company returns nothing', async () => {
    // Pass company A's id with company B's brainId — RLS + predicate
    // gate should both reject.
    const res = await retrieve({
      companyId: a.companyId,
      brainId: b.brainId,
      query: 'content',
      mode: 'scan',
      tierCeiling: 'extracted',
      limit: 50,
    });
    expect(res).toEqual([]);
  });

  it('retrieve scoped to company B never returns company A docs', async () => {
    const res = await retrieve({
      companyId: b.companyId,
      brainId: b.brainId,
      query: 'secret OR content OR Acme OR Unrelated',
      mode: 'hybrid',
      tierCeiling: 'extracted',
      limit: 50,
    });
    const slugs = res.map((r) => r.slug);
    expect(slugs).toContain(b.docs[0].slug);
    expect(slugs).not.toContain(a.docs[0].slug);
  });
});
```

Add a `seedBrainInCompany` helper to `_fixtures.ts` that creates a fresh company + brain + documents and returns IDs.

- [ ] **Step 2: Run → Pass**

Run: `npx vitest run src/lib/memory/__tests__/cross-tenancy.test.ts`
Expected: PASS 3/3. If any of these FAIL, STOP and audit the retrieve() WHERE clause before proceeding — this is the multi-tenancy invariant.

- [ ] **Step 3: Commit**

```bash
git add src/lib/memory/__tests__/cross-tenancy.test.ts src/lib/memory/__tests__/_fixtures.ts
git commit -m "$(cat <<'EOF'
test(memory): cross-tenancy isolation suite for retrieve

Phase 1 Task 21. Correctness-critical — any regression here is a
security regression. Seeds two companies and verifies no cross-leakage
under any query.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 22: Refactor `search_documents` tool to delegate to memory/core

**Files:**
- Modify: `src/lib/tools/implementations/search-documents.ts`
- Create: `src/lib/tools/implementations/__tests__/search-documents.test.ts`

- [ ] **Step 1: Failing test — output carries provenance**

```typescript
// src/lib/tools/implementations/__tests__/search-documents.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { searchDocumentsTool } from '../search-documents';
import { seedBrainInCompany } from '@/lib/memory/__tests__/_fixtures';

describe('search_documents tool', () => {
  let ctx: Awaited<ReturnType<typeof seedBrainInCompany>>;

  beforeAll(async () => {
    ctx = await seedBrainInCompany({
      docs: [{ title: 'A', content: 'Acme pricing terms.' }],
    });
  });

  it('returns provenance in every result', async () => {
    const res = await searchDocumentsTool.call(
      { query: 'Acme' },
      {
        // ToolContext shape per src/lib/tools/types.ts
        actor: {
          type: 'agent_token',
          id: 'test-token-id',
          scopes: ['read'],
        },
        companyId: ctx.companyId,
        brainId: ctx.brainId,
        grantedCapabilities: [],
        webCallsThisTurn: 0,
      },
    );

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.results.length).toBeGreaterThan(0);
    const hit = res.data.results[0];
    expect(hit.provenance).toBeDefined();
    expect(hit.provenance.brainId).toBe(ctx.brainId);
    expect(hit.provenance.confidenceTier).toBe('extracted');
  });
});
```

- [ ] **Step 2: Fail**

Run: `npx vitest run src/lib/tools/implementations/__tests__/search-documents.test.ts`
Expected: FAIL — `hit.provenance` is undefined.

- [ ] **Step 3: Refactor the tool**

Replace the body of `src/lib/tools/implementations/search-documents.ts`:

```typescript
// search_documents — delegates to src/lib/memory/core.retrieve().
//
// Contract: keep the existing output shape compatible for agents that
// were wired to the pre-refactor tool. We add `provenance` as an
// additional field per result; existing fields (path, title, snippet,
// relevance_score, folder) remain.

import { retrieve } from '@/lib/memory/core';
import type { Provenance } from '@/lib/memory/types';
import type { LocusTool, ToolContext, ToolResult } from '../types';

interface SearchDocumentsInput {
  query: string;
  folder?: string;
  max_results?: number;
}

interface SearchResult {
  path: string;
  title: string;
  snippet: string;
  relevance_score: number;
  folder: string | null;
  provenance: Provenance;
}

interface SearchDocumentsOutput {
  query: string;
  results: SearchResult[];
}

export const searchDocumentsTool: LocusTool<
  SearchDocumentsInput,
  SearchDocumentsOutput
> = {
  name: 'search_documents',
  description:
    'Full-text search over the brain. Returns ranked paths + snippets ' +
    'with provenance. Filter by folder slug, cap with max_results.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1 },
      folder: { type: 'string', minLength: 1 },
      max_results: { type: 'integer', minimum: 1, maximum: 50 },
    },
    required: ['query'],
    additionalProperties: false,
  },

  action: 'read' as const,
  resourceType: 'document' as const,

  isReadOnly() {
    return true;
  },

  async call(
    input: SearchDocumentsInput,
    context: ToolContext,
  ): Promise<ToolResult<SearchDocumentsOutput>> {
    const results = await retrieve({
      brainId: context.brainId,
      companyId: context.companyId,
      query: input.query,
      mode: 'hybrid',
      tierCeiling: 'extracted',
      limit: input.max_results ?? 10,
      filters: input.folder ? { folderPath: input.folder } : undefined,
    });

    const shaped: SearchResult[] = results.map((r) => ({
      path: r.provenance.path,
      title: r.title,
      snippet: r.snippet.text,
      relevance_score: r.score,
      folder: extractFolderFromPath(r.provenance.path),
      provenance: r.provenance,
    }));

    return {
      success: true,
      data: { query: input.query, results: shaped },
      metadata: {
        responseTokens: 0,
        executionMs: 0,
        documentsAccessed: results.map((r) => r.documentId),
        details: {
          eventType: 'document.search',
          folder: input.folder ?? null,
          resultCount: shaped.length,
          query: input.query,
        },
      },
    };
  },
};

function extractFolderFromPath(path: string): string | null {
  const i = path.indexOf('/');
  return i >= 0 ? path.slice(0, i) : null;
}
```

**Note:** The `folderPath` filter on `retrieve()` requires Task 17's SQL to add a folder filter clause when the filter is set. Extend `core.ts` to honor `q.filters?.folderPath`:

```typescript
// inside retrieve() SQL:
${q.filters?.folderPath ? sql`AND f.slug = ${q.filters.folderPath}` : sql``}
```

- [ ] **Step 4: Pass**

Run: `npx vitest run src/lib/tools/implementations/__tests__/search-documents.test.ts`
Expected: PASS.

Run: `npx vitest run`
Expected: all tests pass — this is the "all existing agent tool calls work unchanged" exit criterion.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tools/implementations/search-documents.ts src/lib/tools/implementations/__tests__/search-documents.test.ts src/lib/memory/core.ts
git commit -m "$(cat <<'EOF'
refactor: search_documents tool delegates to memory/core

Phase 1 Task 22. Output gains a provenance field per result; existing
fields unchanged. Folder filter honored in the retrieval core.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 23: Overview generator — bottom-up folder rollup

**Files:**
- Create: `src/lib/memory/overview/generate.ts`
- Create: `src/lib/memory/overview/__tests__/generate.test.ts`

- [ ] **Step 1: Failing test**

```typescript
// src/lib/memory/overview/__tests__/generate.test.ts
import { describe, it, expect } from 'vitest';
import { generateFolderOverview } from '../generate';

describe('generateFolderOverview', () => {
  it('rolls up child document titles + key sentences', () => {
    const out = generateFolderOverview({
      folderPath: 'pricing',
      children: [
        {
          path: 'pricing/enterprise',
          title: 'Enterprise Pricing',
          compact_index: {
            entities: [], topics: ['enterprise'], flags: ['POLICY'],
            proper_nouns: [], key_sentence: 'Enterprise tier starts at $50k.',
            date_hints: [], authored_by: 'rule_based',
            computed_at: '2026-04-22T00:00:00.000Z',
          },
        },
      ],
      childFolders: [],
    });

    expect(out).toContain('# Overview: pricing');
    expect(out).toContain('Enterprise Pricing');
    expect(out).toContain('Enterprise tier starts at $50k.');
  });

  it('lists child folders when present', () => {
    const out = generateFolderOverview({
      folderPath: 'root',
      children: [],
      childFolders: ['pricing', 'sales'],
    });
    expect(out).toContain('pricing');
    expect(out).toContain('sales');
  });

  it('returns a minimal header when folder is empty', () => {
    const out = generateFolderOverview({
      folderPath: 'empty',
      children: [],
      childFolders: [],
    });
    expect(out).toContain('# Overview: empty');
  });
});
```

- [ ] **Step 2: Fail → Step 3: Implementation**

```typescript
// src/lib/memory/overview/generate.ts
//
// Bottom-up folder rollup. Produces the markdown body of an auto-
// generated `_OVERVIEW.md` document. Pure function — caller supplies
// the folder contents and this returns a string.

import type { CompactIndex } from '../types';

export interface OverviewChild {
  path: string;
  title: string;
  compact_index: CompactIndex | null;
}

export interface GenerateInput {
  folderPath: string;
  children: OverviewChild[];
  childFolders: string[];
}

export function generateFolderOverview(input: GenerateInput): string {
  const parts: string[] = [];
  parts.push(`# Overview: ${input.folderPath}`);
  parts.push('');
  parts.push(
    '> Auto-generated summary of this folder. Regenerated on document-change events.',
  );
  parts.push('');

  if (input.childFolders.length > 0) {
    parts.push('## Subfolders');
    for (const f of input.childFolders) parts.push(`- ${f}`);
    parts.push('');
  }

  if (input.children.length > 0) {
    parts.push('## Documents');
    for (const c of input.children) {
      const ks = c.compact_index?.key_sentence ?? '';
      parts.push(`- **${c.title}** (\`${c.path}\`)${ks ? ` — ${ks}` : ''}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}
```

- [ ] **Step 4: Pass + Commit**

```bash
npx vitest run src/lib/memory/overview/__tests__/generate.test.ts
git add src/lib/memory/overview/generate.ts src/lib/memory/overview/__tests__/generate.test.ts
git commit -m "feat(memory): generateFolderOverview pure function

Phase 1 Task 23. Renders markdown body from folder contents.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 24: Overview writer — persist as type:overview document

**Files:**
- Create: `src/lib/memory/overview/invalidate.ts`
- Create: `src/lib/memory/overview/__tests__/invalidate.test.ts`

**Conceptual note:** `_OVERVIEW.md` documents need a stable slug so they can be upserted. Convention: the overview for folder path `pricing` lives at slug `_overview-pricing` with `type: 'overview'` and `metadata.auto_generated = true`. The root folder's overview is slug `_overview-root`.

- [ ] **Step 1: Failing integration test**

```typescript
// src/lib/memory/overview/__tests__/invalidate.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { eq, and } from 'drizzle-orm';
import { regenerateFolderOverview } from '../invalidate';
import { seedBrainInCompany } from '@/lib/memory/__tests__/_fixtures';

describe('regenerateFolderOverview', () => {
  it('upserts a type:overview document for the folder', async () => {
    const ctx = await seedBrainInCompany({
      docs: [
        { title: 'Enterprise Pricing', content: 'Enterprise tier $50k.', folderSlug: 'pricing' },
      ],
    });

    await regenerateFolderOverview({
      companyId: ctx.companyId,
      brainId: ctx.brainId,
      folderPath: 'pricing',
    });

    const [row] = await db
      .select({
        id: documents.id,
        type: documents.type,
        content: documents.content,
        metadata: documents.metadata,
      })
      .from(documents)
      .where(
        and(
          eq(documents.brainId, ctx.brainId),
          eq(documents.slug, '_overview-pricing'),
        ),
      );

    expect(row).toBeDefined();
    expect(row.type).toBe('overview');
    expect(row.content).toContain('Enterprise Pricing');
    expect((row.metadata as any).auto_generated).toBe(true);
  });
});
```

- [ ] **Step 2: Fail → Step 3: Implementation**

```typescript
// src/lib/memory/overview/invalidate.ts
//
// Regenerates the `_overview-<folder>` document for a given folder.
// Idempotent: upsert by (brain_id, slug). Content is built from
// generateFolderOverview() over the folder's direct children.

import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { folders } from '@/db/schema/folders';
import { generateFolderOverview, type OverviewChild } from './generate';

export interface RegenerateInput {
  companyId: string;
  brainId: string;
  folderPath: string; // top-level folder slug, or 'root' for brain root
}

export async function regenerateFolderOverview(
  input: RegenerateInput,
): Promise<void> {
  const overviewSlug = `_overview-${input.folderPath || 'root'}`;

  // Find the folder row for this path (null for root).
  const [folderRow] =
    input.folderPath === 'root'
      ? [null]
      : await db
          .select({ id: folders.id })
          .from(folders)
          .where(
            and(
              eq(folders.brainId, input.brainId),
              eq(folders.slug, input.folderPath),
            ),
          )
          .limit(1);

  // Load direct children (documents whose folder_id matches).
  const children = (await db
    .select({
      path: documents.path,
      title: documents.title,
      compactIndex: documents.compactIndex,
    })
    .from(documents)
    .where(
      and(
        eq(documents.brainId, input.brainId),
        folderRow ? eq(documents.folderId, folderRow.id) : isNull(documents.folderId),
        isNull(documents.deletedAt),
        isNull(documents.type), // only user-authored docs, not other overviews
      ),
    )) as unknown as OverviewChild[];

  // Subfolders list (shallow — don't recurse yet).
  const subfolders = folderRow
    ? await db
        .select({ slug: folders.slug })
        .from(folders)
        .where(eq(folders.parentId, folderRow.id))
    : await db
        .select({ slug: folders.slug })
        .from(folders)
        .where(
          and(eq(folders.brainId, input.brainId), isNull(folders.parentId)),
        );

  const body = generateFolderOverview({
    folderPath: input.folderPath,
    children,
    childFolders: subfolders.map((r) => r.slug),
  });

  // Upsert the overview document.
  const existing = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(eq(documents.brainId, input.brainId), eq(documents.slug, overviewSlug)),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(documents)
      .set({
        content: body,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, existing[0].id));
  } else {
    await db.insert(documents).values({
      companyId: input.companyId,
      brainId: input.brainId,
      folderId: folderRow?.id ?? null,
      title: `Overview: ${input.folderPath}`,
      slug: overviewSlug,
      path: `${input.folderPath}/${overviewSlug}`,
      content: body,
      type: 'overview',
      metadata: { auto_generated: true },
    });
  }
}
```

**Important:** The search_documents tool filter `d.type IS NULL` already excludes these. Do NOT loosen that filter.

- [ ] **Step 4: Pass + Commit**

```bash
npx vitest run src/lib/memory/overview/__tests__/invalidate.test.ts
git add src/lib/memory/overview/invalidate.ts src/lib/memory/overview/__tests__/invalidate.test.ts
git commit -m "$(cat <<'EOF'
feat(memory): regenerateFolderOverview upserts type:overview doc

Phase 1 Task 24. Idempotent upsert by (brain_id, slug). Filtered out of
search_documents via existing type IS NULL clause.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 25: Wire overview regeneration into route handlers

**Files:**
- Modify: `src/app/api/brain/documents/route.ts`
- Modify: `src/app/api/brain/documents/[id]/route.ts`
- (Optional) Modify: `src/lib/write-pipeline/ingest.ts` to expose a higher-level helper

**Important:** Same correction as Task 11 — overview regeneration must hook into the route handlers (where the actual writes happen), not into `src/lib/brain/save.ts` (which is frontmatter helpers only).

- [ ] **Step 1: Add overview invalidation call after each successful write**

The POST handler already has access to the resolved `folder` row (queried to validate `folderId`); reuse its `folder.slug`. The PATCH handler has access to `existing` (the prior document row) — derive the old folder's slug from `existing.folderId` if a folder-move is supported, otherwise from the current `folder` row. The `type` value being persisted is already derived upstream (via `extractDocumentTypeFromContent`) — reuse that binding.

**POST — after successful `db.insert`:**

```typescript
import { regenerateFolderOverview } from '@/lib/memory/overview/invalidate';

// `derivedType` and `folder` are existing bindings in the route; the
// guard keeps overview-save-overview loops impossible.
if (derivedType == null) {
  await regenerateFolderOverview({
    companyId,
    brainId,
    folderPath: folder?.slug ?? 'root',
  });
}
```

**PATCH — after successful `db.update`:**

```typescript
if (existing.type == null) {
  // If folder changed, regenerate BOTH the old and new folder overviews.
  const oldFolderSlug = existing.folderId
    ? (await db.select({ slug: folders.slug }).from(folders)
       .where(eq(folders.id, existing.folderId)).limit(1))[0]?.slug
    : undefined;
  const newFolderSlug = folder?.slug ?? oldFolderSlug;

  await regenerateFolderOverview({
    companyId, brainId,
    folderPath: newFolderSlug ?? 'root',
  });
  if (oldFolderSlug && oldFolderSlug !== newFolderSlug) {
    await regenerateFolderOverview({
      companyId, brainId, folderPath: oldFolderSlug,
    });
  }
}
```

For Phase 1, inline `await` is acceptable — overview generation is one read + one upsert, sub-100ms at typical folder sizes. Phase 4 may move this to a queue.

- [ ] **Step 2: Integration test — save a doc, verify overview was regenerated**

Add to `src/app/api/brain/documents/__tests__/compact-index-on-write.test.ts`:

```typescript
it('POST /api/brain/documents regenerates folder overview', async () => {
  // Resolve the pricing folder's id up front so the POST body matches
  // the route's real `folderId: uuid` schema.
  const pricingFolderId = await getFolderIdBySlug(BRAIN_ID, 'pricing');
  const created = await postDocumentViaTestHarness({
    title: 'Pricing test',
    content: 'Enterprise tier $50k.',
    folderId: pricingFolderId,
  });

  const [row] = await db
    .select({ content: documents.content })
    .from(documents)
    .where(
      and(
        eq(documents.brainId, BRAIN_ID),
        eq(documents.slug, '_overview-pricing'),
      ),
    );
  expect(row.content).toContain('Overview: pricing');
  expect(row.content).toContain('Pricing test');
});

it('saving an overview document does NOT recurse', async () => {
  // Direct DB insert of a type:overview doc should not trigger another
  // regeneration — verify by checking that the overview's updatedAt
  // doesn't tick when an overview is upserted programmatically.
  // Implementation: invoke regenerateFolderOverview twice and assert no
  // additional rows are created.
});
```

- [ ] **Step 3: Pass + Commit**

```bash
npx vitest run
git add src/app/api/brain/documents/route.ts src/app/api/brain/documents/[id]/route.ts src/app/api/brain/documents/__tests__/
git commit -m "$(cat <<'EOF'
feat: regenerate folder overview after document save

Phase 1 Task 25. Hooks into both create and update route handlers.
Loop guard via `type IS NULL` check — overview saves never re-trigger.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 26: Benchmark runner scaffold

**Files:**
- Create: `tests/benchmarks/runner.ts`
- Create: `tests/benchmarks/fixtures/sample.json`
- Create: `tests/benchmarks/README.md`

- [ ] **Step 1: Write the sample fixture**

Create `tests/benchmarks/fixtures/sample.json` — a minimal 5-question smoke set:

```json
{
  "name": "smoke",
  "corpus": [
    { "slug": "acme-pricing", "title": "Acme Pricing",
      "content": "Enterprise tier starts at $50k. Standard tier at $5k." },
    { "slug": "acme-owners", "title": "Acme Owners",
      "content": "Jane Smith owns the Acme rollout as of 2026-04-22." }
  ],
  "questions": [
    { "query": "enterprise pricing", "gold_slugs": ["acme-pricing"] },
    { "query": "Jane Smith", "gold_slugs": ["acme-owners"] },
    { "query": "\"Acme rollout\"", "gold_slugs": ["acme-owners"] }
  ]
}
```

- [ ] **Step 2: Write the runner**

```typescript
// tests/benchmarks/runner.ts
//
// Generic retrieval benchmark runner. Seeds a fresh brain from the
// supplied corpus, runs every question through retrieve(), scores R@K
// vs gold slugs, reports aggregates.
//
// Runs as a plain Node script (no Next.js). Depends only on the
// memory subsystem + DB client.

import fs from 'node:fs/promises';
import path from 'node:path';
import { retrieve } from '../../src/lib/memory/core';
// Adapt to the project's seed helper — a CLI-friendly variant of
// src/lib/memory/__tests__/_fixtures.ts's seedBrainInCompany.

interface Benchmark {
  name: string;
  corpus: Array<{ slug: string; title: string; content: string }>;
  questions: Array<{ query: string; gold_slugs: string[] }>;
}

interface Metrics {
  name: string;
  n: number;
  r_at_5: number;
  r_at_10: number;
  mrr: number;
}

async function main(): Promise<void> {
  const fixturePath = process.argv[2] ?? 'tests/benchmarks/fixtures/sample.json';
  const raw = await fs.readFile(path.resolve(fixturePath), 'utf-8');
  const bench: Benchmark = JSON.parse(raw);

  // TODO: seed a fresh benchmark company + brain. Document the helper
  // the project uses; inline is OK for Phase 1.
  throw new Error('Seed helper not wired — fill in from _fixtures.ts');

  /*
  const seeded = await seedBenchmarkBrain(bench.corpus);

  const results: Array<{ question: string; rank: number | null }> = [];
  for (const q of bench.questions) {
    const res = await retrieve({
      companyId: seeded.companyId,
      brainId: seeded.brainId,
      query: q.query,
      mode: 'hybrid',
      tierCeiling: 'extracted',
      limit: 10,
    });
    const slugs = res.map((r) => r.slug);
    let rank: number | null = null;
    for (const gold of q.gold_slugs) {
      const i = slugs.indexOf(gold);
      if (i >= 0 && (rank === null || i < rank)) rank = i;
    }
    results.push({ question: q.query, rank });
  }

  const hits = results.filter((r) => r.rank !== null);
  const rAt5 = results.filter((r) => r.rank !== null && r.rank < 5).length / results.length;
  const rAt10 = results.filter((r) => r.rank !== null && r.rank < 10).length / results.length;
  const mrr = hits.reduce((acc, r) => acc + 1 / (r.rank! + 1), 0) / results.length;

  const metrics: Metrics = { name: bench.name, n: results.length, r_at_5: rAt5, r_at_10: rAt10, mrr };
  console.log(JSON.stringify(metrics, null, 2));
  */
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

The inline `throw` is intentional — this task is scaffold-only. Phase 2 fills in the seed helper path and runs LongMemEval proper.

- [ ] **Step 3: README**

```markdown
# tests/benchmarks/

Benchmark harness for the memory subsystem. Designed to point at
`retrieve()` with different fixtures — smoke (small, in-repo), LongMemEval,
HotpotQA, FanOutQA, RAGAS (external, Phase 2+).

## Run

```bash
DATABASE_URL=... npx tsx tests/benchmarks/runner.ts tests/benchmarks/fixtures/sample.json
```

## Add a benchmark

1. Place fixture JSON in `fixtures/` with shape `{ corpus[], questions[] }`.
2. Run the runner.
3. Report metrics in the benchmark dashboard (Phase 5).
```

- [ ] **Step 4: Commit**

```bash
git add tests/benchmarks/
git commit -m "$(cat <<'EOF'
chore(benchmarks): scaffold retrieval benchmark runner

Phase 1 Task 26. Runner skeleton + sample fixture + README. Seed
integration deferred to Phase 2 when LongMemEval is wired.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 27: Extract `MemoryProvider` interface (end-of-phase)

**Files:**
- Modify: `src/lib/memory/types.ts`
- Create: `src/lib/memory/providers/tatara-hybrid/index.ts`
- Modify: `src/lib/tools/implementations/search-documents.ts` (depend on interface)
- Modify: `src/lib/memory/core.ts` (re-export through provider)

- [ ] **Step 1: Define the interface**

Add to `src/lib/memory/types.ts`:

```typescript
// MemoryProvider — the seam between the agent harness and the specific
// retrieval implementation. Our Phase 1–5 build is the first concrete
// provider (providers/tatara-hybrid). Future alternatives (Letta,
// LightRAG, etc.) ship as sibling provider adapters.
//
// Contract (non-negotiable):
//   - every returned result includes provenance
//   - tierCeiling is enforced by the provider, not the caller
//   - companyId + brainId scoping is enforced by the provider
//   - a provider that cannot respect tenancy does not ship

export interface TraverseQuery {
  brainId: string;
  companyId: string;
  fromSlug: string;
  hops: number;
  predicateFilter?: string[];
  confidenceMin?: number;
}

export interface Subgraph {
  nodes: Array<{ slug: string; title: string }>;
  edges: Array<{ from: string; to: string; predicate: string; tier: ConfidenceTier }>;
}

export interface FactQuery {
  brainId: string;
  companyId: string;
  subject?: string;
  predicate?: string;
  object?: string;
  asOf?: Date;
  tierCeiling: ConfidenceTier;
}

export interface Fact {
  subject: string;
  predicate: string;
  object: string | null;
  objectLiteral: string | null;
  validFrom: string | null;
  validTo: string | null;
  confidenceTier: ConfidenceTier;
  confidenceScore: number | null;
  sourceDocumentId: string | null;
}

export interface Doc {
  id: string;
  slug: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  provenance: Provenance;
}

export interface DocumentWrite {
  // Minimal shape the harness cares about. Concrete providers may
  // accept more in their own extension types.
  companyId: string;
  brainId: string;
  slug: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  authoredBy: AuthoredBy;
}

export interface IngestResult {
  documentId: string;
  overviewsInvalidated: string[];
}

export interface ProviderCapabilities {
  name: string;
  supports: {
    factLookup: boolean;
    graphTraverse: boolean;
    timeline: boolean;
    embeddings: boolean;
  };
}

export interface MemoryProvider {
  retrieve(q: RetrieveQuery, caller?: CallerContext): Promise<RankedResult[]>;
  getDocument(slug: string, companyId: string, brainId: string): Promise<Doc | null>;
  factLookup(q: FactQuery): Promise<Fact[]>;
  timelineFor(
    entitySlug: string,
    companyId: string,
    brainId: string,
  ): Promise<Fact[]>;
  brainOverview(
    companyId: string,
    brainId: string,
    folderPath?: string,
  ): Promise<string>;
  graphTraverse(q: TraverseQuery): Promise<Subgraph>;
  ingestDocument(write: DocumentWrite): Promise<IngestResult>;
  invalidateDocument(
    slug: string,
    companyId: string,
    brainId: string,
  ): Promise<void>;
  describe(): ProviderCapabilities;
}
```

- [ ] **Step 2: Build the `tatara-hybrid` provider**

Create `src/lib/memory/providers/tatara-hybrid/index.ts`:

```typescript
// Tatara's in-house hybrid provider. First implementation of
// MemoryProvider. Wraps the Phase 1 retrieval + compact-index + overview
// implementation. Phase 2+ extend this same module with embeddings,
// KG, etc.

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { documents } from '@/db/schema/documents';
import { retrieve } from '../../core';
import { regenerateFolderOverview } from '../../overview/invalidate';
import type {
  CallerContext,
  Doc,
  DocumentWrite,
  Fact,
  FactQuery,
  IngestResult,
  MemoryProvider,
  ProviderCapabilities,
  RankedResult,
  RetrieveQuery,
  Subgraph,
  TraverseQuery,
} from '../../types';

export const tataraHybridProvider: MemoryProvider = {
  retrieve(q: RetrieveQuery, caller?: CallerContext): Promise<RankedResult[]> {
    return retrieve(q, caller);
  },

  async getDocument(): Promise<Doc | null> {
    throw new Error('getDocument: Phase 1 does not implement this via the provider; use the existing get_document tool.');
  },

  async factLookup(_q: FactQuery): Promise<Fact[]> {
    return []; // No KG in Phase 1; returns empty per contract.
  },

  async timelineFor(): Promise<Fact[]> {
    return [];
  },

  async brainOverview(
    companyId: string,
    brainId: string,
    folderPath = 'root',
  ): Promise<string> {
    // Regenerate-on-read — Phase 1 keeps it simple. Phase 4 caches.
    await regenerateFolderOverview({ companyId, brainId, folderPath });
    const slug = `_overview-${folderPath || 'root'}`;
    const [row] = await db
      .select({ content: documents.content })
      .from(documents)
      .where(
        and(eq(documents.brainId, brainId), eq(documents.slug, slug)),
      )
      .limit(1);
    return row?.content ?? '';
  },

  async graphTraverse(_q: TraverseQuery): Promise<Subgraph> {
    return { nodes: [], edges: [] };
  },

  async ingestDocument(_write: DocumentWrite): Promise<IngestResult> {
    throw new Error(
      'ingestDocument via provider: Phase 1 keeps save logic in src/lib/brain/save.ts. Phase 3 will route through here.',
    );
  },

  async invalidateDocument(): Promise<void> {
    // No-op in Phase 1. Phase 2+ will invalidate embeddings here.
  },

  describe(): ProviderCapabilities {
    return {
      name: 'tatara-hybrid',
      supports: {
        factLookup: false,
        graphTraverse: false,
        timeline: false,
        embeddings: false,
      },
    };
  },
};
```

- [ ] **Step 3: Point the tool layer at the provider**

Update `src/lib/tools/implementations/search-documents.ts` — change the import:

```typescript
// before:
import { retrieve } from '@/lib/memory/core';

// after:
import { tataraHybridProvider } from '@/lib/memory/providers/tatara-hybrid';

// and in call():
const results = await tataraHybridProvider.retrieve({ … });
```

- [ ] **Step 4: Add a capability assertion test**

Create `src/lib/memory/providers/tatara-hybrid/__tests__/capabilities.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { tataraHybridProvider } from '../index';

describe('tataraHybridProvider.describe()', () => {
  it('reports the Phase 1 capability set', () => {
    const c = tataraHybridProvider.describe();
    expect(c.name).toBe('tatara-hybrid');
    expect(c.supports.factLookup).toBe(false);
    expect(c.supports.graphTraverse).toBe(false);
    expect(c.supports.timeline).toBe(false);
    expect(c.supports.embeddings).toBe(false);
  });
});
```

Run: `npx vitest run src/lib/memory/providers/tatara-hybrid/__tests__/capabilities.test.ts`
Expected: PASS.

- [ ] **Step 5: All tests pass**

Run: `npx vitest run`
Expected: all pass.

Run: `npx tsc --noEmit`
Expected: clean.

Run: `bash scripts/check-harness-boundary.sh`
Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add src/lib/memory/types.ts src/lib/memory/providers/tatara-hybrid/index.ts src/lib/tools/implementations/search-documents.ts
git commit -m "$(cat <<'EOF'
refactor(memory): extract MemoryProvider interface + tatara-hybrid adapter

Phase 1 Task 27. Tool layer now depends on the provider, not on
core.ts directly. Phase 2–5 can ship alternative providers without
touching consumers. describe() advertises Phase 1 capability set.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 28: Verify Phase 1 exit criteria

No code in this task — verification only.

- [ ] **Step 1: All existing agent tool calls still work**

Run: `npx vitest run`
Expected: all tests pass including any pre-existing tool tests.

- [ ] **Step 2: `search_documents` emits provenance**

Manual check: inspect output of a real tool call (via dev server or test). Each `results[i]` has `.provenance.{brainId, path, version, updatedAt, confidenceTier}`.

- [ ] **Step 3: compact_index populated for 100% of docs**

```sql
SELECT COUNT(*) AS missing
FROM documents
WHERE deleted_at IS NULL AND compact_index IS NULL;
-- Expected: 0
```

If nonzero: re-run backfill endpoint (Task 12).

- [ ] **Step 4: Cross-tenancy tests pass**

Run: `npx vitest run src/lib/memory/__tests__/cross-tenancy.test.ts`
Expected: PASS all 3 cases.

- [ ] **Step 5: MemoryProvider interface extracted**

```bash
grep -n "export interface MemoryProvider" src/lib/memory/types.ts
grep -n "tataraHybridProvider" src/lib/memory/providers/tatara-hybrid/index.ts
grep -n "tataraHybridProvider\|MemoryProvider" src/lib/tools/implementations/search-documents.ts
```

All three greps return matches — confirms the interface is extracted, the provider exists, and the tool layer consumes via the interface.

- [ ] **Step 6: Harness-boundary clean**

```bash
bash scripts/check-harness-boundary.sh
npm run lint
npx tsc --noEmit
```

All three: clean.

- [ ] **Step 7: Commit a phase-complete marker**

```bash
git commit --allow-empty -m "$(cat <<'EOF'
chore: mark Phase 1 (retrieval contract + compact index) complete

All Phase 1 exit criteria verified per
docs/superpowers/specs/2026-04-22-agent-memory-architecture-design.md §12.
Next: Phase 2 (pgvector + hybrid fusion) gets its own plan.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Post-phase checklist

- [ ] Run full test suite: `npx vitest run` → all pass
- [ ] Run typecheck: `npx tsc --noEmit` → clean
- [ ] Run lint + boundary: `npm run lint` → clean
- [ ] Run smoke benchmark: `npx tsx tests/benchmarks/runner.ts` (once seed helper wired — scaffold for now)
- [ ] Verify `compact_index` populated for every live document
- [ ] Update `locus-brain/implementation/` with a phase-1-completion note if that convention is followed
- [ ] Open follow-up spec/plan for Phase 2 (pgvector + hybrid fusion)

## Known deferred work (NOT in scope here)

- Embedding generation / pgvector / HNSW — Phase 2
- `kg_triples` table + `kg_query` / `kg_timeline` tools — Phase 3
- Maintenance Agent (Vercel Cron, structured-output extraction) — Phase 4
- Research subagent v2 (graph traversal, inferred tier, citation validator) — Phase 5
- Semantic chunking — Phase 2.5, only if recall shows a gap
- Community detection (Leiden) — Phase 5
