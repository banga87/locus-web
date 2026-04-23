// tests/benchmarks/check-regression.ts
//
// Compares results/hybrid.json (this run) against results/baseline.json
// (Phase 1 lexical-only baseline). Exits non-zero if hybrid R@5 drops
// by more than 5 percentage points vs baseline.
//
// Floor gate per spec §8.3 step 5. NOT the target gate (which compares
// hybrid > lexical-only at the same Phase 2 SQL).

import fs from 'node:fs/promises';

async function main() {
  const baseline = JSON.parse(
    await fs.readFile('tests/benchmarks/results/baseline.json', 'utf-8'),
  );
  const hybrid = JSON.parse(
    await fs.readFile('tests/benchmarks/results/hybrid.json', 'utf-8'),
  );

  const drop = baseline.r_at_5 - hybrid.r_at_5;
  console.log(
    `[regression] baseline R@5=${baseline.r_at_5.toFixed(3)}, ` +
      `hybrid R@5=${hybrid.r_at_5.toFixed(3)}, drop=${drop.toFixed(3)}`,
  );

  if (drop > 0.05) {
    console.error(`[regression] FAIL — hybrid R@5 dropped by more than 5% vs baseline`);
    process.exit(1);
  }
  console.log(`[regression] PASS`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
