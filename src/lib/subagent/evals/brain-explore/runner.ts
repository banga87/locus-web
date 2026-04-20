// BrainExplore eval runner — pilot scaffolding.
//
// This file ships the metrics helpers (pure functions, unit-tested) and
// a CLI stub. The CLI does NOT actually call the Gateway or runSubagent
// in the pilot — real runs require a seeded brain fixture and
// VERCEL_OIDC_TOKEN, and are gated behind Phase 2. See README.md.

export interface EvalResult {
  id: string;
  /** Fraction of expectedSlugs present in the returned Sources block. 0..1. */
  sourceCompleteness: number;
  /** 1 if the output-contract validator passed, 0 otherwise. */
  formatValid: 0 | 1;
  /** Number of tool calls the subagent made. Stubbed to 0 in pilot. */
  toolCallCount: number;
  /** Wall-clock latency in milliseconds. Stubbed to 0 in pilot. */
  latencyMs: number;
}

export interface EvalAggregate {
  count: number;
  avgSourceCompleteness: number;
  formatValidRate: number;
  avgToolCalls: number;
  avgLatencyMs: number;
}

/**
 * Fraction of `expected` slugs that are present in `returned`. Returns 1
 * when `expected` is empty (trivially complete — nothing was required).
 */
export function computeSourceCompleteness(
  expected: string[],
  returned: string[],
): number {
  if (expected.length === 0) return 1;
  const set = new Set(returned);
  const hit = expected.filter((s) => set.has(s)).length;
  return hit / expected.length;
}

/**
 * Parse every `slug: \`<slug>\`` occurrence out of the subagent's final
 * text. Matches the pattern emitted by `BRAIN_EXPLORE_AGENT`'s required
 * output format — keep in sync with the validator in
 * `src/lib/subagent/built-in/brainExploreAgent.ts`.
 */
export function extractSlugsFromText(text: string): string[] {
  const re = /slug:\s*`([^`]+)`/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

/**
 * Aggregate per-query results into summary stats. Returns a zeroed
 * object for empty input so callers can serialise the output
 * unconditionally.
 */
export function aggregate(results: EvalResult[]): EvalAggregate {
  const n = results.length;
  if (n === 0) {
    return {
      count: 0,
      avgSourceCompleteness: 0,
      formatValidRate: 0,
      avgToolCalls: 0,
      avgLatencyMs: 0,
    };
  }
  return {
    count: n,
    avgSourceCompleteness:
      results.reduce((a, r) => a + r.sourceCompleteness, 0) / n,
    formatValidRate: results.reduce((a, r) => a + r.formatValid, 0) / n,
    avgToolCalls: results.reduce((a, r) => a + r.toolCallCount, 0) / n,
    avgLatencyMs: results.reduce((a, r) => a + r.latencyMs, 0) / n,
  };
}

// Very simple argv parser — one recognised flag.
const modelArg = process.argv
  .find((a) => a.startsWith('--model='))
  ?.split('=')[1];

async function main() {
  console.log(`[eval] BrainExplore (model=${modelArg ?? 'default'})`);
  // NOTE: pilot scaffolding only — real runner requires seeded brain
  // + VERCEL_OIDC_TOKEN. See README.md.
  console.log('[eval] pilot scaffolding — real runs land in Phase 2');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
