# Tatara Document Standard v1

**Date:** 2026-04-25
**Status:** v1 spec — committed for May 4 build
**Owner:** Angus
**Supersedes:** prior implicit conventions across `src/db/seeds/` and skill/workflow frontmatter

## Context

Tatara is repositioned as an opinionated, self-maintaining markdown brain that AI agents read from and write to over MCP. The customer is the **Agent Director** — the person responsible for deploying agents across a company. The Maintenance Agent is the moat.

This document defines the structure those agents must conform to and the Maintenance Agent must enforce. It is the first artifact required before MCP write-tooling, Maintenance Agent loop code, or retrieval contracts can be implemented, because the MCP tool descriptions and the Maintenance Agent's behavior are both derived from it.

## Core principle

**The LLM is the primary reader.** Frontmatter is structured data the agent reads as data. Body is markdown the agent reads as prose. Optimize both for retrieval and unambiguous interpretation, not human aesthetics.

This is the [Karpathy LLM-Wiki thesis](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) operationalized: docs designed for LLM ingestion, with an enforcement agent ensuring the design is followed.

Implication: agents — not humans — author. Humans inspect, audit, and approve via a small UI surface (the inbox). The full WYSIWYG editor, force-directed graph, and chat UI are out of scope.

## Folder taxonomy (7)

| Folder | What lives here |
|---|---|
| `/company` | Brand voice, brand/design, mission, values, internal team, roles, structure |
| `/customers` | CRM-flavored: customer accounts, contacts, conversations, feedback, account-level pricing |
| `/market` | ICPs, competitive landscape, positioning, market research |
| `/product` | Products, pricing, roadmap, technical architecture, product research |
| `/marketing` | Campaigns, email sequences, website copy, social content, events |
| `/operations` | Procedures, policies, tools, vendors |
| `/signals` | Time-stamped raw input: rambles, meeting notes, slack captures, in-flight thoughts |

**Research is not a folder.** It lives in the topical folder it concerns. Customer research → `/customers`. Market research → `/market`. Product research → `/product`. Agents looking for "what do we know about X" search the topical folder, not a separate research silo.

**Industry-specific taxonomy is deferred.** v1 ships horizontal/generic. Industry templates are a v2+ product expansion vector once we have customers asking.

### Lifecycle promotion

The Maintenance Agent (with human-in-loop approval via the inbox) promotes content between folders based on confidence and ratification:

- `/signals` → topical folder when content ratifies (e.g., a CEO ramble in `/signals` becomes a `decision` in `/company` once ratified)
- topical folder → `/signals/archive` (or `status: archived`) when superseded

Promotion is never silent — it always passes through the inbox.

## Document types (7)

| Type | Shape | Examples |
|---|---|---|
| `canonical` | Long-lived authoritative single-source-of-truth | Brand voice doc, ICP definition, pricing structure |
| `decision` | Decision record with provenance | "We're switching to monthly billing" |
| `note` | Informal time-stamped capture | Meeting notes, CEO ramble, research-in-flight |
| `fact` | Atomic attributed statement | "Q4 revenue was $X", "Slack workspace is acme.slack.com" |
| `procedure` | Ordered runbook | "How we handle refund requests" |
| `entity` | Person/company/vendor record | Customer account, team member, vendor profile |
| `artifact` | Operational working doc with lifecycle | Campaign brief, email sequence draft, /pricing page copy |

Each type has a distinct schema and triggers different Maintenance Agent behavior:

- `canonical` → review schedule, ownership tracking
- `decision` → chain integrity, supersede tracking
- `note` → promotion eligibility (signals → canonical)
- `fact` → validity-window tracking, conflict detection
- `procedure` → dependency tracking
- `entity` → state freshness, conversation roll-up
- `artifact` → lifecycle transitions, version tracking

### Note on `procedure`

`procedure` replaces the prior `skill` document type. The skill *runtime* (execution, runs, fork/import/propose, /skills UI routes, /api/skills/runs) is cut from v1. The doc type remains because:

1. Retrieval benefits from the type filter (agent: "is there a procedure for X?")
2. The Maintenance Agent's schema validation differs (procedures need ordered steps; facts don't)
3. Keeping the markdown/YAML representation lets us preserve content without preserving the runtime

If a procedure becomes executable in the future, it can be re-elevated. For v1, agents read procedures as docs and execute steps themselves.

## YAML frontmatter

### Universal (every doc)

```yaml
id: <stable-uuid-or-slug>
title: <human-readable>
type: canonical | decision | note | fact | procedure | entity | artifact
source: agent:<name> | human:<name> | agent:maintenance
topics: [<controlled-vocab>, ...]
confidence: low | medium | high
status: active   # active | archived | superseded | draft
```

`created_at` and `updated_at` are ambient (db/fs); they are surfaced to the agent at retrieval but are not authored in YAML.

### Type-specific additions

```yaml
# canonical
owner: <who keeps it current>
last_reviewed_at: <ISO date>

# decision
decided_by: [<actor>, ...]
decided_on: <ISO date>
supersedes: <doc-id>          # optional
superseded_by: <doc-id>       # optional

# note
captured_from: meeting | slack | call | email | other
participants: [<actor>, ...]  # optional
promotes_to: <doc-id>         # optional, set by Maintenance Agent on promotion

# fact
evidence: <url-or-doc-id>     # where this fact came from
valid_from: <ISO date>
valid_to: <ISO date>          # optional, when it stopped being true

# procedure
applies_to: [<trigger context>, ...]
prerequisites: [<doc-id>, ...]   # optional

# entity
kind: person | company | vendor
relationship: customer | prospect | partner | team | other
contact_points: [email, slack, ...]   # optional
current_state: <one-line summary maintained by agent>
last_interaction: <ISO date>          # optional

# artifact
lifecycle: draft | live | archived
version: <int>
owner: <actor>
launched_at: <ISO date>       # optional
retired_at: <ISO date>        # optional
channel: email | web | social | event | other   # for marketing artifacts
```

## Confidence model

**Unified three-step scale across all types:** `low | medium | high`.

- `low` — raw capture, unverified. Default for `note`.
- `medium` — corroborated, not yet ratified. Default for proposed `decision`, in-flight research.
- `high` — ratified, authoritative. Default for `canonical`, ratified `decision`.

Retrieval applies confidence as a single dial across all types — e.g., a scoping query for "high-confidence material when designing this feature" returns `canonical` + ratified `decision` + corroborated `fact`, regardless of type.

Confidence is set on write (by the authoring agent or human) and adjusted by the Maintenance Agent during reconciliation (e.g., a `note` corroborated by independent later capture is promoted to `medium`).

## Topics — controlled vocabulary

Topics are tags **validated against a workspace-defined list**, not free text. The Maintenance Agent rejects (or flags via inbox) writes that introduce new topics outside the vocabulary.

Starting vocabulary per workspace is small (10–30 terms) and grows only with explicit human approval. This is what stops topic-tag sprawl, which kills retrieval.

The vocabulary is workspace-scoped (each Tatara tenant has its own) but seeded from a default list at provision time.

## Maintenance Agent v1 behaviors (derived from this spec)

The Maintenance Agent's v1 loop is now specifiable against this standard. Three behaviors ship in v1; the rest defer.

**v1 (ship for May 4):**

1. **Frontmatter validate + infer.** On every write: required-field check per type; infer missing fields where possible (e.g., infer `topics` from body via classification); flag the rest to the inbox.
2. **Near-duplicate detection.** Cosine similarity + topic overlap on docs of the same type. Threshold (e.g., cosine > 0.85 with ≥1 overlapping topic) routes to inbox for human-approved merge.
3. **Re-classification.** If a doc lands in the wrong folder for its type/topic, flag for relocation. Notes in `/company` lacking ratification → suggest move to `/signals`. Canonical content in `/signals` → suggest promotion.

**Deferred (v1.5 / v2):**

- Conflict detection between canonical docs
- Atomic-fact extraction from canonical docs
- Backlink / cross-reference maintenance
- Compaction / retrieval rewriting
- Auto-resolution (vs flag-to-inbox) for high-confidence near-duplicates

### Cost model

The Maintenance Agent uses a tiered model approach to keep cost defensible:

- **Cheap pass (Haiku or equivalent):** every write — frontmatter validation, classification, topic inference, similarity hashing.
- **Escalation (Opus 4.7 or equivalent):** triggered only when the cheap pass flags ambiguity — near-duplicate adjudication, conflict resolution, complex reclassification.

This tiering is also the v1 pricing-tier shape: free/cheap = Haiku-only; premium = Opus on escalation.

### Reversibility

Every Maintenance Agent action produces a versioned diff with audit trail. Auto-applied actions are limited to the cheap pass (frontmatter inference, status updates). Anything that touches content (merge, relocate, supersede) routes to the **inbox** for human approval — at v1 this is the only UI surface the Agent Director regularly opens.

## What this spec does NOT define (deferred)

- **Retrieval contract details** — covered by existing pgvector/hybrid fusion work; this spec defines what data the retrieval operates on, not how retrieval ranks.
- **Default topic vocabulary** — needs to be authored separately (proposed: 20–30 terms covering the seven folders).
- **Inbox UI surface** — out of scope for this document; covered in a separate design.
- **MCP tool descriptions** — derived directly from this spec but specified in a separate document so the spec evolves at most once per quarter while tool descriptions evolve continuously.
- **Industry-specific taxonomy templates** — v2+.
- **Rich-text editor / WYSIWYG** — explicitly out of scope. Humans inspect via the inbox, not by editing markdown directly.

## Open questions

1. **"Other contextual but not canonical" content.** Tentatively handled by `note` (low/medium confidence) with promotion eligibility. If real examples emerge that don't fit, revisit.
2. **Default topic vocabulary content.** Needs authoring before first agent writes anything via MCP.
3. **`procedure` re-elevation criteria.** When does a procedure get a runtime back? Defer until a paying customer asks.
4. **Inbox approval granularity.** All Maintenance Agent edits, or only the destructive subset (merge, supersede, relocate)? Default to "all" for v1 since the user is the canary.

## v1 acceptance criteria

This spec is implemented when:

- Every document in the brain conforms to the universal + type-specific frontmatter schema.
- The MCP write tools enforce type/folder/topic validity at write time, with descriptions derived from this spec.
- The Maintenance Agent runs the three v1 behaviors on every write, using the cheap/escalation tier model.
- The inbox surfaces every flagged Maintenance Agent action with a versioned diff and approve/reject affordance.
- The user (Angus) can on May 4 dump messy notes via Claude Code MCP and have other agents reliably retrieve current, well-classified context an hour, day, and week later.
