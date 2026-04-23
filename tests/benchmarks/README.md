# tests/benchmarks/

Benchmark harness for the memory subsystem.

## Status (Phase 2)

- Smoke fixture (in-repo): `fixtures/sample.json`
- LongMemEval (downloaded on demand): `fixtures/longmemeval.json` (gitignored)

## Run

Smoke (lexical-only baseline):
```bash
cross-env MEMORY_WEIGHT_VEC=0 BENCH_OUTPUT=results/smoke-baseline.json \
  npx tsx tests/benchmarks/runner.ts tests/benchmarks/fixtures/sample.json
```

Smoke (hybrid):
```bash
cross-env BENCH_OUTPUT=results/smoke-hybrid.json \
  npx tsx tests/benchmarks/runner.ts tests/benchmarks/fixtures/sample.json
```

LongMemEval (download once):
```bash
npx tsx tests/benchmarks/load-longmemeval.ts \
  --max-questions 100 \
  --out tests/benchmarks/fixtures/longmemeval.json
```

LongMemEval baseline + hybrid:
```bash
cross-env MEMORY_WEIGHT_VEC=0 BENCH_OUTPUT=results/lme-baseline.json \
  npx tsx tests/benchmarks/runner.ts tests/benchmarks/fixtures/longmemeval.json

cross-env BENCH_OUTPUT=results/lme-hybrid.json \
  npx tsx tests/benchmarks/runner.ts tests/benchmarks/fixtures/longmemeval.json
```

## CI smoke gate

`npm run benchmark:smoke` runs the smoke fixture in hybrid mode and exits non-zero
if R@5 drops by more than 5% vs the captured baseline (results/baseline.json).
See package.json scripts.

## Add a benchmark
1. Place fixture JSON in `fixtures/` with shape `{ name, corpus[], questions[] }`.
2. Run the runner.
3. Archive metrics in `results/`.
