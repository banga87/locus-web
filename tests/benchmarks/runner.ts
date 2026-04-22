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
  const fixturePath =
    process.argv[2] ?? 'tests/benchmarks/fixtures/sample.json';
  const raw = await fs.readFile(path.resolve(fixturePath), 'utf-8');
  const bench: Benchmark = JSON.parse(raw);

  // TODO(Phase 2): seed a fresh benchmark company + brain from bench.corpus.
  // The seed helper lives at src/lib/memory/__tests__/_fixtures.ts as
  // seedBrainInCompany — but that's a test-only export. A CLI-friendly
  // variant without Vitest dependencies is the Phase 2 deliverable.
  throw new Error(
    `Benchmark runner is Phase 1 scaffold only. Fixture "${bench.name}" with ` +
      `${bench.corpus.length} docs and ${bench.questions.length} questions ` +
      `will be wired up in Phase 2 when LongMemEval is adopted.`,
  );

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

  const rAt5 =
    results.filter((r) => r.rank !== null && r.rank < 5).length / results.length;
  const rAt10 =
    results.filter((r) => r.rank !== null && r.rank < 10).length / results.length;
  const mrr =
    results
      .filter((r) => r.rank !== null)
      .reduce((acc, r) => acc + 1 / (r.rank! + 1), 0) / results.length;

  const metrics: Metrics = {
    name: bench.name,
    n: results.length,
    r_at_5: rAt5,
    r_at_10: rAt10,
    mrr,
  };
  console.log(JSON.stringify(metrics, null, 2));
  */
}

// Re-export types for external tools that want to introspect the contract.
export type { Benchmark, Metrics };

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
