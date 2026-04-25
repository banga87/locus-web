# Tatara Default Topic Vocabulary v1

**Date:** 2026-04-25
**Status:** v1 — universal default seeded into every new workspace
**Owner:** Angus
**Companion to:** Tatara Document Standard v1, Tatara MCP Tool Surface v1

## Context

Topics are tags applied to every document in the brain, validated against a controlled vocabulary. They are the cross-cutting signal that lets an agent retrieve "everything about pricing across all folders," independent of doc type or location.

This document defines the **default vocabulary seeded into every new workspace at provisioning time**. v1 ships one universal list, deliberately industry-agnostic, broad enough that an arbitrary B2B/B2C/services/SaaS business landing on Tatara via a public POC would find it useful without first needing to author their own.

The vocabulary includes a software/engineering cluster because the founder's own workspace and most early POC users will be working with software products. Non-software businesses can ignore those terms; agents will simply not reach for them when the content is non-engineering.

Per-industry templates (e.g., e-commerce, healthcare, services) and per-workspace customization beyond the default are deferred to v2+.

## Design rules

1. **Universally business-oriented.** Terms every commercial entity recognizes — not industry- or stack-specific. Cut: `inventory`, `fulfillment`, `infra`, `deploy`, `compliance`, `incident`. Keep: `customer`, `pricing`, `team`, `vendor`.
2. **Distinct enough for retrieval.** Every term must, when used as a search filter, return a meaningfully different result set than its neighbors. If two terms collapse on real content, drop one.
3. **Don't duplicate the type/folder axis.** Topics describe *what content is about*; types describe *what shape the content has*; folders describe *which functional area it belongs to*. Avoid topics that re-encode types (no `decision`, since `type: decision` exists) or folders (no `customers` topic — folder is `/customers`).
4. **Small.** 33 terms. Memorable. An agent can ingest the full vocabulary in one cache.
5. **Stable.** New terms are added only via admin path; agents proposing out-of-vocabulary topics get rejected at write time. This is the price of retrieval cleanliness.

## The vocabulary (33)

Organized into clusters for human comprehension. The clusters are documentation-only — agents see a flat list.

### Brand & identity (4)
- `brand` — overall brand
- `voice` — brand voice, tone of voice, copy style
- `design` — visual identity, design system, brand assets
- `positioning` — how the company positions itself in the market

### Market (3)
- `market` — market analysis, market sizing, trends
- `competitor` — competitive landscape, individual competitors
- `icp` — ideal customer profile, target audience definitions

### Customer (3)
- `customer` — customer accounts, customer-specific context
- `feedback` — feedback, complaints, requests, testimonials
- `support` — support workflows, ticket patterns, customer service

### Product (4)
- `product` — products, product strategy
- `pricing` — pricing structure, plans, discounts, billing
- `feature` — specific features, feature requests
- `roadmap` — roadmap items, planned work, sequencing

### Marketing (3)
- `campaign` — marketing campaigns
- `content` — content marketing, blog, copy assets, social posts
- `event` — events, conferences, webinars, trade shows

### Sales (2)
- `sales` — sales process, deals, pipeline
- `partnership` — partner relationships, channel deals

### People & operations (5)
- `team` — internal team, roles, responsibilities
- `hiring` — open roles, recruiting, candidate pipeline
- `finance` — finance, budgeting, cash flow, expenses
- `legal` — legal matters, contracts, IP, regulation
- `vendor` — third-party vendors, tools, services

### Strategy (1)
- `strategy` — company strategy, OKRs, goals, planning

### Engineering & software (8)
- `engineering` — engineering team, culture, process, practices
- `architecture` — system architecture, ADRs, technical design decisions
- `bug` — defects, regressions, customer-reported issues
- `incident` — outages, postmortems, near-misses, on-call events
- `infra` — infrastructure, hosting, platform, cloud, devops
- `security` — vulnerabilities, audits, security policies
- `release` — versioned shipping events, release notes (distinct from `campaign` which is GTM)
- `api` — API contracts, integrations, webhooks, third-party APIs

**Total: 33**

## Tagging guidance (for agents)

The MCP tool descriptions reference this guidance — it's what teaches external agents to tag well.

1. **Apply 1–5 topics per document.** One is fine for a tightly-scoped fact. 2–3 is typical. More than 5 is a sign the doc should be split.
2. **Prefer specific over generic.** If `pricing` and `product` both apply, `pricing` is more discriminating; lead with the specific. Use the generic only when the doc is genuinely cross-cutting.
3. **Tag what the content is *about*, not where it lives.** A note in `/signals` about a customer complaint tags `customer` and `feedback` (and maybe the product area), not the folder it's in.
4. **Use only the controlled vocabulary.** Out-of-vocabulary tags will be rejected at write time. If you find yourself reaching for a missing term repeatedly, surface that to the human via `propose_document` with `confidence: low` — they can add the term via admin.

## Synonym handling (agent-side normalization)

Agents commonly reach for synonyms. The MCP `get_taxonomy` response includes a synonym map so agents can normalize before submitting. v1 default synonyms:

| Agent might write | Use instead |
|---|---|
| `users`, `clients`, `accounts` | `customer` |
| `prospect`, `lead` | `sales` |
| `competition`, `competitive` | `competitor` |
| `target audience`, `personas`, `audience` | `icp` |
| `ux`, `ui`, `visual` | `design` |
| `tone`, `copy-style` | `voice` |
| `okr`, `kpi`, `goals`, `objectives` | `strategy` |
| `messaging` | `voice` (when about how to say it) or `positioning` (when about what to say) |
| `partner`, `affiliate`, `reseller` | `partnership` |
| `subscription`, `plans`, `billing` | `pricing` |
| `bug`, `defect`, `issue`, `regression` | `bug` |
| `outage`, `postmortem`, `incident-report`, `on-call` | `incident` |
| `infrastructure`, `cloud`, `hosting`, `devops`, `platform` | `infra` |
| `system-design`, `adr`, `technical-design` | `architecture` |
| `vulnerability`, `cve`, `pentest`, `audit` | `security` |
| `endpoint`, `webhook`, `integration`, `third-party` | `api` |
| `version`, `release-notes`, `ship`, `deploy` | `release` (the event) — but use `campaign` for go-to-market and `feature` for the thing being shipped |
| `launch`, `update` | depends on context: `release` for the shipping event, `campaign` for go-to-market, `feature` for the thing itself |
| `meeting` | (no topic — meeting context lives in `captured_from: meeting` field on `note` type) |
| `decision` | (no topic — decisions are `type: decision`, not a topic) |

## Examples

| Doc title | Type | Folder | Suggested topics |
|---|---|---|---|
| "Tatara brand voice" | canonical | /company | `brand`, `voice` |
| "Acme Corp account" | entity | /customers | `customer` |
| "Q3 pricing experiment results" | note | /signals | `pricing`, `product` |
| "Series A pitch deck v3" | artifact | /marketing | `pricing`, `positioning`, `strategy` |
| "Refund handling procedure" | procedure | /operations | `support`, `customer` |
| "Switching from Mailgun to Resend" | decision | /operations | `vendor`, `finance` |
| "Competitor X launched feature Y" | note | /signals | `competitor`, `feature` |
| "Email sequence: welcome 5-day drip" | artifact | /marketing | `content`, `campaign` |
| "Senior engineer JD" | artifact | /operations | `hiring`, `team` |
| "Q4 OKRs" | canonical | /company | `strategy` |
| "Customer feedback: requesting bulk export" | note | /signals | `customer`, `feedback`, `feature` |
| "Brand color palette" | canonical | /company | `brand`, `design` |
| "Stripe vendor info" | entity | /operations | `vendor`, `finance` |
| "ADR: switch from text-search to pgvector" | decision | /operations | `architecture`, `infra` |
| "Postmortem: 2026-03-15 checkout outage" | note | /signals | `incident`, `customer` |
| "API rate-limit policy" | canonical | /operations | `api`, `security` |
| "v2.4 release notes" | artifact | /marketing | `release`, `feature` |
| "Bug: PDF export drops trailing pages" | note | /signals | `bug`, `feature` |
| "Quarterly security audit checklist" | procedure | /operations | `security`, `engineering` |

## Vocabulary growth path

- **v1:** Fixed 25-term default. Workspaces can extend via admin UI (out-of-scope here). Agents cannot add terms — proposals with new topics are rejected.
- **v1.5:** Workspace-level synonym configuration. Workspace owners can define their own synonyms (e.g., a healthcare company might map `members` → `customer`).
- **v2:** Industry templates. Tatara provisions a workspace with a template (`saas-b2b`, `ecommerce`, `agency`, `services`) that overlays additional terms (e.g., `ecommerce` adds `inventory`, `shipping`, `returns`).
- **v2+:** Term lifecycle (deprecation, rename) — agents notified via `get_taxonomy` of vocabulary changes.

## What this vocabulary does NOT cover

By design, the v1 default omits:

- **Industry-specific** (`inventory`, `fulfillment`, `claim`, `policy-renewal`, `patient`, `subscriber`) — per-industry templates are v2+.
- **Niche engineering** (`migration`, `tech-debt`, `monitoring`, `observability`, `performance`, `testing`, `qa`) — common in some teams but redundant with the included engineering terms for v1. Workspaces extend via admin if needed.
- **Geographic / segment** (`emea`, `enterprise`, `smb`) — these are dimensions, not topics. Better handled in `/customers` entity records as fields.
- **Time-bounded** (`q1`, `2026`, `holiday-season`) — temporal data lives in dates and `valid_from`/`valid_to`, not topics.

## v1 acceptance criteria

This vocabulary is implemented when:

- Every new Tatara workspace is seeded with the 33-term default at provisioning.
- The `get_taxonomy` MCP tool returns this list (terms + synonyms map) on first call.
- The MCP write tools reject proposals with out-of-vocabulary topics, returning a clear `reason` indicating the synonym or closest term to use.
- The user (Angus) on May 4 can dump email summaries via Claude Code MCP, and Claude Code reliably picks topics from this vocabulary without prompting (the `get_taxonomy` + descriptions are sufficient instruction).
