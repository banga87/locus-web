# Tatara Inbox v1

**Date:** 2026-04-25
**Status:** v1 spec — minimum viable surface
**Owner:** Angus
**Companion to:** Tatara Document Standard v1, MCP Tool Surface v1

## Context

The Inbox is the human-in-loop surface for Maintenance Agent decisions that require human judgment. It is the **only UI surface the Agent Director regularly opens during a workday** in v1 — chat is cut, the editor is cut, the graph is cut. Everything else happens silently between agents and the brain.

Scope: minimum viable. One list, one detail panel, three actions. No notifications, no filtering, no bulk operations, no search. This spec defers everything that isn't load-bearing for May 4.

## What goes into the Inbox

The Maintenance Agent's cheap pass routes a write to the Inbox when it produces a non-confident outcome on any of these three v1 behaviors:

| Trigger | What the inbox shows |
|---|---|
| **Near-duplicate detected** | "This new doc looks like an existing doc. Merge, supersede, or accept as new?" |
| **Re-classification suggested** | "This doc was written to `/X` but looks like it belongs in `/Y`. Move?" |
| **Missing inferable field** | "This doc is missing field `X`. The Maintenance Agent suggests `Y` — accept or correct?" |

That's it for v1. Conflict detection between canonical docs, fact extraction, promotion candidates, and other Maintenance Agent behaviors all defer to v1.5+ — when those land, they emit additional inbox item kinds.

## State model

A document goes through the inbox flow when its write returns `status: pending` from the MCP write tool. The doc is **committed immediately** with a `pending_review` flag — it appears in retrieval but with that flag visible. This avoids the "I just wrote that, why can't I find it?" failure mode while still keeping the human in the loop.

| Inbox item state | Meaning |
|---|---|
| `pending` | Awaiting human decision (default on creation) |
| `approved` | Human approved as proposed → Maintenance Agent applies its proposed action; `pending_review` flag clears on the doc |
| `rejected` | Human rejected → Maintenance Agent's proposed action is dropped; the doc remains as originally written, `pending_review` flag clears |
| `modified` | Human edited the proposal and approved → modified action is applied |
| `expired` | No decision after 30 days → `pending_review` flag clears, no action taken |

**Reject ≠ delete.** Rejecting a near-duplicate flag means "yes, accept this as a new doc, don't merge." It doesn't delete the doc. The original write succeeded.

If the user actually wants to delete a doc, that's a separate `archive_document` MCP call, not an Inbox flow.

## UI surface

One route, one component. Minimum chrome.

### `/inbox` (route under `(app)` group)

**Layout:** two-pane. List on the left, detail on the right.

**Empty state:** "Your inbox is clear. The Maintenance Agent will surface anything that needs your eyes here."

**List item (left pane):** single row per pending item. From most recent first.

```
[icon by kind] [Title or "Untitled"]
[1-line context: e.g., "near-duplicate of /company/brand-voice"]
[2 hours ago]
```

Three icons total — one per kind (near-duplicate, re-classification, missing-field).

**Detail panel (right pane):** opens on click of a list item. Shows:

1. **What the Maintenance Agent thinks**, in one sentence ("This document looks like a near-duplicate of `/company/brand-voice` (cosine 0.91, shared topics: `brand`, `voice`).")
2. **The proposed action**, structured ("Merge into existing doc" / "Move to `/operations`" / "Set field `confidence: medium`").
3. **A side-by-side diff** when applicable (new doc on left, existing doc / proposed change on right).
4. **Three buttons:** Approve · Modify · Reject.
   - "Modify" opens an inline editor to adjust the action (e.g., change the target folder, edit the merged-doc body) before approving.
5. **Audit metadata:** who proposed (which agent), when, what other rules fired (cheap-pass result summary).

No chat, no comments, no thread. Decision is a one-click action; the audit log is the record.

## API surface

Four endpoints. All authenticated as the workspace owner / approver role.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/inbox` | List inbox items (filter: `status`, default `pending`; `limit`, `offset`) |
| `GET` | `/api/inbox/[id]` | Get a single inbox item with full detail (proposal, diff data, doc content) |
| `POST` | `/api/inbox/[id]/decide` | Body: `{ decision: "approve" \| "reject" \| "modify", modification?: <action-shape> }` |
| `GET` | `/api/inbox/stats` | Returns `{ pending_count }` for header badge / proposal-status MCP tool |

`POST /decide` is the all-purpose decision endpoint. Body validates per decision type. Idempotent on repeated calls with the same body (returns same outcome).

## Database

One new table.

```
inbox_items
  id              uuid pk
  workspace_id    uuid fk
  document_id     uuid fk    -- the committed-but-flagged doc
  kind            text       -- 'near_duplicate' | 'reclassification' | 'missing_field'
  proposed_action jsonb      -- structured action the agent proposes
  context         jsonb      -- e.g., { existing_doc_id, cosine, shared_topics }
  status          text       -- 'pending' | 'approved' | 'rejected' | 'modified' | 'expired'
  decided_at      timestamp  -- null until a decision
  decided_by      text       -- 'human:<name>' on resolution
  created_at      timestamp
  expires_at      timestamp  -- 30d from created_at
```

A nightly cron flips `status: pending` → `expired` on items past `expires_at`. Same cron clears the `pending_review` flag on associated docs.

Existing migrations infrastructure handles the table + index on `(workspace_id, status, created_at desc)`.

## Integration points

- **MCP write tools** (`propose_document`, `update_document`, `supersede_document`): when the cheap pass produces a non-confident result, write the inbox item and return `status: pending` + `inbox_id` to the caller. The doc is also written to the brain with a `pending_review` flag.
- **MCP `get_proposal_status`**: reads from `inbox_items` by `inbox_id`, returns the current state.
- **Document retrieval**: `pending_review` is a field on the document record; surfaced in `search_documents` results so consuming agents know the human hasn't reviewed yet. Agents can choose to filter it out.
- **Audit log** (`src/lib/audit/`): every Inbox decision emits an audit event. The decision panel reads from this audit log to display the trail.

## What v1 deliberately does NOT include

- **Notifications.** No email, no push, no in-app toast. The user (canary on May 4) checks the Inbox actively. v1.5+: email digest on a daily cadence; in-app badge on `/inbox` route.
- **Filters / search.** Single chronological list. v1.5+ when item volume requires.
- **Bulk operations.** One decision at a time. v1.5+: bulk approve/reject for low-stakes kinds (e.g., missing-field).
- **Inline document editing.** "Modify" lets the human adjust *the proposed action* (target folder, merge target). Editing the document content itself is a separate flow — for v1, if the user wants to rewrite the doc, they reject the inbox item and re-write via MCP from their agent. v1.5+: inline doc edit from the Inbox.
- **Multi-approver workflows.** Single approver per workspace in v1. v1.5+: roles + delegation.
- **Conflict resolution UI.** When the Maintenance Agent detects a conflict between two canonical docs (deferred behavior — not v1), this would surface here. Not in v1.

## v1 acceptance criteria

This Inbox is implemented when:

- The `/inbox` route renders the list + detail two-pane UI with the three action buttons.
- The four API endpoints (`list`, `get`, `decide`, `stats`) are implemented and tested.
- The Maintenance Agent's cheap pass writes an `inbox_items` row when any of the three v1 triggers fires.
- A decision (approve / reject / modify) correctly applies or skips the proposed Maintenance Agent action and clears the document's `pending_review` flag.
- The nightly cron expires items older than 30 days.
- The user (Angus) on May 4 can dump messy notes via Claude Code MCP, see flagged near-duplicates appear in the Inbox within a minute, decide them in one click, and see the brain reflect the decision.

## Open questions

1. **Pending-review badge on documents.** When a doc has `pending_review: true`, does it appear in default search results, or only when a flag is explicitly set on the search? Lean: include by default but mark visibly in results — the calling agent can filter.
2. **Reject reason capture.** Should the human be required to enter a reason when rejecting? Lean: optional in v1; required in v1.5 if rejection patterns reveal a Maintenance Agent calibration issue.
3. **Modify-action UI for near-duplicate kind.** When approving a merge, should the human be able to choose *which* doc is the canonical (the new or the existing)? Lean: yes — surface that choice in the modify panel.
