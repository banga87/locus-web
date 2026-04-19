# BrainExplore eval harness

Offline, model-in-the-loop evaluation harness for the `BrainExplore`
built-in subagent. Pilot scaffolding only — real runs against a seeded
brain fixture land in Phase 2.

## What this measures

Per golden-set query, the runner records:

- **source-slug completeness** — fraction of `expectedSlugs` present in the
  subagent's Sources block, parsed via the `slug: \`<slug>\`` pattern.
- **format-validator pass rate** — 1 if `BRAIN_EXPLORE_AGENT.outputContract.validator`
  returns `{ ok: true }` on the final text, 0 otherwise.
- **avg tool calls** — mean number of tool invocations per run (stubbed
  to 0 in the scaffolding; wired in Phase 2).
- **avg latency ms** — mean wall-clock time per run (stubbed to 0 in the
  scaffolding; wired in Phase 2).

Aggregates are computed across the full golden set and written to disk.

## How to run

```bash
tsx src/lib/subagent/evals/brain-explore/runner.ts --model=anthropic/claude-haiku-4.5
```

The `--model=<id>` flag accepts any `ApprovedModelId`. Omit it to fall
back to `BRAIN_EXPLORE_AGENT.model`.

**Note**: the pilot scaffolding does not actually call the Gateway or
`runSubagent` — it prints a placeholder message and exits. Running the
real eval requires `VERCEL_OIDC_TOKEN` plus a local brain fixture, and
is therefore **not run in CI**. See Phase 2 for the full harness.

## Where results are written

```
src/lib/subagent/evals/brain-explore/results/<ISO-date>.json
```

One file per run, named by the UTC timestamp at start. The file contains
per-query `EvalResult` entries plus the aggregate summary.

## Maintaining the golden set

Target size is **15–20** queries, split roughly:

- 5 `quick` — single-doc lookups, narrow questions
- 7 `medium` — multi-doc synthesis, cross-category
- 5 `very thorough` — comprehensive sweeps, design/ADR chains

Each entry in `golden-set.ts` is:

```ts
{
  id: string;              // unique slug, stable across revisions
  prompt: string;          // user-facing query the subagent receives
  expectedSlugs: string[]; // docs that MUST appear in the Sources block
  thoroughness?: 'quick' | 'medium' | 'very thorough';
  notes?: string;          // optional rationale / edge case being tested
}
```

The scaffolding ships with 3 queries; expand to the full 15–20 before
running the first real eval. Treat `expectedSlugs` as a tight contract —
queries that overspecify generate false negatives; queries that
underspecify generate false positives.
