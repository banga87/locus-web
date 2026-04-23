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
import {
  seedBenchmarkBrain,
  teardownBenchmarkSeed,
  waitForEmbeddings,
} from './seed';

interface Benchmark {
  name: string;
  corpus: Array<{ slug: string; title: string; content: string }>;
  questions: Array<{ query: string; gold_slugs: string[] }>;
}

interface Metrics {
  name: string;
  mode: string;
  n: number;
  r_at_5: number;
  r_at_10: number;
  mrr: number;
}

async function main(): Promise<void> {
  const fixturePath =
    process.argv[2] ?? 'tests/benchmarks/fixtures/sample.json';
  const weightVec = Number(process.env.MEMORY_WEIGHT_VEC ?? '0.6');
  const outputPath = process.env.BENCH_OUTPUT;     // optional, write metrics JSON

  const raw = await fs.readFile(path.resolve(fixturePath), 'utf-8');
  const bench: Benchmark = JSON.parse(raw);

  console.log(`[bench] seeding "${bench.name}" (${bench.corpus.length} docs)`);
  const seeded = await seedBenchmarkBrain(bench.corpus);
  console.log(`[bench] waiting for embeddings...`);
  await waitForEmbeddings(seeded.brainId, bench.corpus.length);

  console.log(`[bench] running ${bench.questions.length} questions, weight_vec=${weightVec}`);
  const ranks: Array<number | null> = [];

  // The MEMORY_WEIGHT_VEC env var is read at module load by
  // src/lib/memory/scoring/compose.ts (Task 21). When unset, defaults to
  // 0.6 (hybrid). When set to 0, retrieve() runs lexical-only — used to
  // capture the Phase 1 baseline against the Phase 2 SQL.
  for (const q of bench.questions) {
    const results = await retrieve(
      {
        brainId: seeded.brainId,
        companyId: seeded.companyId,
        query: q.query,
        mode: 'hybrid',
        tierCeiling: 'extracted',
        limit: 10,
      },
      { role: 'customer_facing' },
    );
    const slugs = results.map((r) => r.slug);
    let rank: number | null = null;
    for (const gold of q.gold_slugs) {
      const i = slugs.indexOf(gold);
      if (i >= 0 && (rank === null || i < rank)) rank = i;
    }
    ranks.push(rank);
  }

  const rAt5 = ranks.filter((r) => r !== null && r < 5).length / ranks.length;
  const rAt10 = ranks.filter((r) => r !== null && r < 10).length / ranks.length;
  const mrr =
    ranks
      .filter((r): r is number => r !== null)
      .reduce((acc, r) => acc + 1 / (r + 1), 0) / ranks.length;

  const metrics: Metrics = {
    name: bench.name,
    mode: weightVec === 0 ? 'lexical-only' : `hybrid (vec=${weightVec})`,
    n: ranks.length,
    r_at_5: rAt5,
    r_at_10: rAt10,
    mrr,
  };
  console.log(JSON.stringify(metrics, null, 2));

  if (outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(metrics, null, 2));
    console.log(`[bench] metrics written to ${outputPath}`);
  }

  console.log(`[bench] tearing down seed`);
  await teardownBenchmarkSeed(seeded);
}

// Re-export types for external tools that want to introspect the contract.
export type { Benchmark, Metrics };

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
