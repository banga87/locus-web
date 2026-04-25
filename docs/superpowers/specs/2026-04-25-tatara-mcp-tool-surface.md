# Tatara MCP Tool Surface v1

**Date:** 2026-04-25
**Status:** v1 spec — derived from `2026-04-25-tatara-document-standard.md`
**Owner:** Angus
**Companion to:** Tatara Document Standard v1

## Context

The MCP-IN tools at `/api/mcp` are how external agents (Claude Code, Codex, GPT, Gemini, custom agents) read from and write to Tatara. The tool descriptions exposed to those agents are **product surface, not boilerplate** — they are the primary mechanism by which Tatara teaches the world's agents to write Tatara-shaped docs without their owners running custom training.

Today the MCP server exposes **four read-only tools** (`search_documents`, `get_document`, `get_document_diff`, `get_diff_history`). For the v1 product to function, write and discovery tools must be added. This document specifies the full v1 surface.

## Design principles for tool descriptions

1. **Action-oriented.** Lead with "Use when…" so the agent knows when to reach for the tool.
2. **Composable.** Reference companion tools by name ("call `get_taxonomy` first if…"). Teach the agent to chain.
3. **Encourage writing.** Default agent posture is timid; descriptions explicitly nudge toward submission ("submit aggressively; the Maintenance Agent handles cleanup").
4. **Schema bounded, not detailed.** Tool descriptions name the constraint ("type must be one of: canonical, decision, …"). Detail lives in `get_type_schema` so descriptions stay short.
5. **Outcome-explicit.** Return shape includes status semantics so the agent can report meaningfully back to its user ("3 committed, 2 pending your inbox review").

## Tool inventory (v1)

Eleven tools total. Four exist; one needs an extension; six are net-new.

| Tool | Status | Purpose |
|---|---|---|
| `search_documents` | EXISTS — extend filters | Find docs by content/topic/type |
| `get_document` | EXISTS — keep as-is | Read a single doc by id or path |
| `get_document_diff` | EXISTS — keep as-is | Version history for one doc |
| `get_diff_history` | EXISTS — keep as-is | Brain-wide delta sync |
| `get_taxonomy` | NEW | Discover valid folders, types, topic vocabulary |
| `get_type_schema` | NEW | Frontmatter schema for a given doc type |
| `propose_document` | NEW | Submit a new doc — primary write entry |
| `update_document` | NEW | Modify an existing doc |
| `supersede_document` | NEW | Replace doc X with new content (explicit intent) |
| `archive_document` | NEW | Soft-delete / status change |
| `get_proposal_status` | NEW | Check whether a prior proposal committed, is pending, or was rejected |

Cut from v1: `link_documents` (cross-references — Maintenance Agent handles automatically in v1.5), `merge_documents` (humans approve via inbox; agents don't merge directly).

## Tool descriptions

The wording below is what external agents will see. It is the literal product copy — review it as carefully as you'd review a landing page.

---

### `search_documents` *(existing — extend)*

```
Full-text and semantic search across the Tatara brain. Returns ranked
results with snippets, document ids, types, and confidence levels.

Use when you need to locate information by content rather than by known
path. Always run a search before proposing a new document — duplicates
are common and the Maintenance Agent will flag them.

Filters (all optional, combinable):
  query           : free-text query (required)
  type            : canonical | decision | note | fact | procedure |
                    entity | artifact
  folder          : /company | /customers | /market | /product |
                    /marketing | /operations | /signals
  topics          : array of topic tags
  confidence_min  : low | medium | high  (default: low — return all)
  max_results     : 1..50 (default: 10)

Returns: array of { id, title, type, folder, topics, confidence,
  snippet, score }
```

**Extensions needed vs current implementation:** add `type`, `folder`, `topics`, `confidence_min` filters; replace `category` with `folder`.

---

### `get_document` *(existing — keep)*

```
Read a document by id or path. Returns YAML frontmatter + markdown body
by default.

Use after `search_documents` to read full content when a snippet is
not enough. Use the `section` parameter to fetch a single H2 section
and save tokens when only one part is relevant.
```

(No changes from current.)

---

### `get_document_diff` *(existing — keep)*

```
View recent version history for one document. Returns an ordered list of
versions with author (agent or human), timestamp, and change summary.

Use to understand how a document has evolved — useful when content seems
inconsistent or a fact has been recently revised.
```

(No changes from current.)

---

### `get_diff_history` *(existing — keep)*

```
View brain-wide changes since a given timestamp. Pass the `brain_version`
from your last interaction as `since` to get only new changes.

Use at the start of a session to catch up on what changed since you
last connected — this is how an agent maintains context continuity
across sessions without re-reading the entire brain.
```

(No changes from current.)

---

### `get_taxonomy` *(new)*

```
Returns the workspace's allowed folders, document types, and topic
vocabulary. Cache the result for the duration of your session — taxonomy
changes infrequently.

Call once at the start of any session that may write to the brain.
Without taxonomy, you cannot construct valid documents.

Returns:
  folders        : list of folder paths and their descriptions
  types          : list of document types and one-line descriptions
  topics         : list of allowed topic tags (controlled vocabulary)
  source_format  : how to format the `source` field (e.g.,
                   "agent:<your-name>" or "human:<username>")
```

---

### `get_type_schema` *(new)*

```
Returns the YAML frontmatter schema for a given document type — required
fields, optional fields, and their value constraints.

Call before writing a document of a type you have not written before in
this session. Use the schema to validate your frontmatter locally before
calling `propose_document`.

Required input:
  type : canonical | decision | note | fact | procedure | entity | artifact

Returns:
  required_fields : map of field-name to { description, value-constraint }
  optional_fields : map of field-name to { description, value-constraint }
  examples        : 1–2 minimal valid examples
```

---

### `propose_document` *(new — primary write entry)*

```
Submit a new document to the Tatara brain. The Maintenance Agent reviews
every proposal: it validates frontmatter, checks for near-duplicates,
and either:
  - commits the document immediately (clean proposal)
  - routes it to the human inbox for approval (ambiguity detected)
  - rejects it (violates the document standard)

Before calling:
  1. Call `get_taxonomy` if you don't know the valid folders/types/topics
  2. Call `search_documents` to check for existing similar content. If
     a similar doc exists, prefer `update_document` or
     `supersede_document` instead of creating a new one.
  3. Call `get_type_schema(type)` to see required fields for your type

Required input:
  type        : one of the seven document types
  folder      : one of the seven folders
  title       : short human-readable title
  body        : markdown content
  frontmatter : object containing the type-specific fields per
                get_type_schema
  topics      : 1–5 tags from the workspace topic vocabulary
  confidence  : low | medium | high — your confidence in this content

Returns:
  status         : "committed" | "pending" | "rejected"
  document_id    : string (when status=committed or pending)
  inbox_id       : string (when status=pending)
  reason         : human-readable explanation (when status=rejected
                   or pending)

Use this tool aggressively. The Maintenance Agent handles cleanup,
deduplication, and reclassification. Your job is to capture and
submit; the system curates.
```

---

### `update_document` *(new)*

```
Modify an existing document. Use for corrections, extensions, or
incremental updates to content that remains broadly the same. The
Maintenance Agent reviews the diff: if the change is small and
unambiguous, it commits; if substantial or content-altering, it
routes to the inbox for human approval.

If you are *replacing* the document's meaning (the old content is now
incorrect), use `supersede_document` instead — it preserves the audit
trail with proper supersedes/superseded_by linking.

Required input:
  document_id   : the doc you are updating
  body          : new full markdown body (no patches; send the
                  complete new body)
  frontmatter   : optional, only fields you are changing
  change_summary: 1-line description of what you changed and why

Returns:
  status         : "committed" | "pending" | "rejected"
  document_id    : echo of input
  inbox_id       : when status=pending
  version        : new version number on success
```

---

### `supersede_document` *(new)*

```
Replace an existing document with new content. Use when the prior
document is no longer correct or has been ratified into a different
form. The old document is marked status=superseded and linked to the
new document; both remain queryable.

Examples of when to use:
  - A `decision` was reversed and a new decision exists
  - A `canonical` brand-voice doc was rewritten after a rebrand
  - A `note` was promoted to a `canonical` doc (the canonical doc
    supersedes the note)

Required input:
  superseded_id    : the doc being replaced
  new_document     : same shape as `propose_document` input

Returns:
  status           : "committed" | "pending" | "rejected"
  new_document_id  : id of the replacement
  superseded_id    : echo of input
  inbox_id         : when status=pending
```

---

### `archive_document` *(new)*

```
Mark a document as archived (status=archived). Archived docs do not
appear in default search results but remain queryable via
search_documents with explicit status filter.

Use when content is genuinely obsolete (e.g., an `artifact` for a
campaign that ended; a `note` superseded by a canonical doc). Do NOT
use to silence content that's merely outdated — for that, supersede.

Required input:
  document_id : doc to archive
  reason      : 1-line explanation

Returns:
  status      : "archived" | "rejected"
  reason      : when status=rejected
```

---

### `get_proposal_status` *(new)*

```
Check the current status of a prior proposal that returned status=pending.
Use to surface inbox-pending state to your user, e.g.,
"I dumped 5 notes from your email; 2 are awaiting your review at the
Tatara inbox."

Required input:
  inbox_id : id returned by propose/update/supersede when status=pending

Returns:
  status   : "pending" | "approved" | "rejected" | "expired"
  resolution: { document_id, decision_at, decision_by } when resolved
```

---

## Auth model alignment

All write tools require an authenticated agent identity. The `source` frontmatter field is **derived from the auth context, not from agent input** — the system stamps `source: agent:<auth-identity>` on every write. This prevents agents from spoofing provenance and gives the Maintenance Agent a reliable signal for confidence/conflict resolution (writes from a known agent vs. an ad-hoc PAT, etc.).

`human:<name>` source is reserved for in-app writes (the inbox approving a Maintenance Agent suggestion is the only v1 case).

## Maintenance Agent integration

Every write tool (`propose_document`, `update_document`, `supersede_document`) flows through the Maintenance Agent's cheap pass synchronously before returning to the caller:

1. **Frontmatter validate + infer** — required fields per type; infer missing topics/confidence where possible
2. **Near-duplicate detection** — cosine + topic overlap against existing docs of the same type
3. **Re-classification** — does the proposed folder/type fit the content?

Outcomes:

- **Clean** → commit immediately, return `status: committed`
- **Ambiguous** (near-dup, possible misclassification, missing inferable fields) → route to inbox, return `status: pending` + `inbox_id`
- **Invalid** (unknown type/folder/topic, schema violations) → return `status: rejected` + `reason`

The cheap pass uses Haiku-tier models. Escalation to Opus happens for the inbox queue (asynchronous, so the calling agent doesn't wait).

## What this changes in the codebase

- **Extend** `src/lib/mcp/tools.ts` to register the new tools and update `search_documents` filter set.
- **Extend** `src/lib/mcp/handler.ts` `MCP_ALLOWED_TOOLS` to include the new tools.
- **Add** new tool implementations under `src/lib/tools/implementations/` (write tools) — these must invoke the Maintenance Agent's cheap pass synchronously.
- **Add** the cheap-pass entry point under `src/lib/agent/` (must remain platform-agnostic per harness boundary rules in `AGENTS.md`).
- **Add** inbox table + status APIs (separate spec — Inbox UI).

## Deferred to v1.5+

- `link_documents` — explicit cross-reference creation
- `merge_documents` — agents don't merge directly; humans approve via inbox
- Streaming tool responses (the MCP server is currently configured `enableJsonResponse: true`; flip when long-running tools land)
- Subscriptions / change-feed — agents can poll `get_diff_history`; push-based subscription is v2

## Open questions

1. **Synchronous vs async cheap pass.** Current spec says synchronous (block the write until classification + dup-check completes). Latency budget needs a real number — likely 200-800ms with Haiku. If too slow, fall back to async-with-pending status.
2. **`source` for in-app human edits.** Should the Maintenance Agent's own writes use `agent:maintenance` (clear) or `human:<approver>` (when applied via inbox approval)? Lean toward `agent:maintenance` with an `approved_by: human:<name>` audit field.
3. **Topic vocabulary write path.** When an agent proposes a new topic, does that route to inbox or just reject? Default v1: reject; humans add topics via a separate (non-MCP) admin path.

## v1 acceptance criteria

This spec is implemented when:

- All eleven tools are registered and reachable on the MCP-IN endpoint.
- An external agent (Claude Code) can run a complete write loop: `get_taxonomy` → `search_documents` → `propose_document` → receive committed/pending status.
- The Maintenance Agent's cheap pass executes synchronously on every write and returns under 1 second p95.
- The user (Angus) on May 4 can dump customer email summaries via Claude Code MCP and have them stored as `entity` docs in `/customers` with valid frontmatter, retrievable by other agents within seconds.
