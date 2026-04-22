# tests/benchmarks/

Benchmark harness for the memory subsystem. Designed to point at
`retrieve()` with different fixtures — smoke (small, in-repo),
LongMemEval, HotpotQA, FanOutQA, RAGAS (external, Phase 2+).

## Status

Phase 1: scaffold only. The runner's seed step throws; Phase 2 wires
in a CLI-friendly variant of `seedBrainInCompany` from the memory test
fixtures.

## Run (once Phase 2 wires it)

```bash
DATABASE_URL=... npx tsx tests/benchmarks/runner.ts tests/benchmarks/fixtures/sample.json
```

## Add a benchmark

1. Place fixture JSON in `fixtures/` with shape `{ corpus[], questions[] }`.
2. Run the runner.
3. Report metrics in the benchmark dashboard (Phase 5).

## Metrics

- `r_at_5`, `r_at_10`: recall at K across all questions.
- `mrr`: mean reciprocal rank.
- `n`: question count.
