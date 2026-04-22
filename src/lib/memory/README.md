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
