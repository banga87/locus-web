/**
 * Seed a burst of audit_events for the Neurons dogfood pass.
 *
 * Generates a realistic mix:
 *   - 25× document_access (document.read) from 3 distinct actor_ids
 *   - 10× mcp_invocation invoke->complete pairs (shared invocation_id, random duration_ms)
 *   - 3× document_mutation (create)
 *   - 2× document_mutation (delete)
 *
 * Events are paced via setTimeout so an open /neurons tab sees them
 * arrive live one-by-one. Targets are picked randomly from documents
 * in the given brain.
 *
 * Usage:
 *   npx tsx scripts/seed-neurons-burst.ts --brain-id <uuid> [--count 40] [--interval-ms 100]
 */

import 'dotenv/config';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';

interface Args { brainId: string; count: number; intervalMs: number }

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let brainId = '';
  let count = 40;
  let intervalMs = 100;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--brain-id') brainId = argv[++i] ?? '';
    else if (argv[i] === '--count') count = Number(argv[++i] ?? '40');
    else if (argv[i] === '--interval-ms') intervalMs = Number(argv[++i] ?? '100');
  }
  if (!brainId) {
    console.error('Usage: npx tsx scripts/seed-neurons-burst.ts --brain-id <uuid> [--count N] [--interval-ms N]');
    process.exit(1);
  }
  return { brainId, count, intervalMs };
}

const ACTORS = [
  { type: 'agent_token' as const, id: 'tok-marketing-burst', name: 'Marketing' },
  { type: 'agent_token' as const, id: 'tok-support-burst',   name: 'Support' },
  { type: 'agent_token' as const, id: 'tok-engineer-burst',  name: 'Engineering' },
];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

// postgres sql.json() expects JSONValue; cast via unknown to satisfy strict typing.
type JsonRecord = Record<string, unknown>;

interface Plan {
  category: 'document_access' | 'document_mutation' | 'mcp_invocation';
  eventType: string;
  details: JsonRecord;
  targetType: string | null;
  targetId: string | null;
  invocationPair?: 'invoke' | 'complete';
  pairId?: string;
  delayBefore?: number;
}

async function main() {
  const { brainId, count, intervalMs } = parseArgs();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');

  const sql = postgres(url, { max: 1 });

  try {
    // Resolve company + a sample of doc ids in the brain.
    const [brain] = await sql<{ id: string; company_id: string }[]>`
      SELECT id, company_id FROM brains WHERE id = ${brainId} LIMIT 1
    `;
    if (!brain) throw new Error(`No brain found with id ${brainId}`);

    const docs = await sql<{ id: string; path: string }[]>`
      SELECT id, path FROM documents
      WHERE brain_id = ${brainId} AND deleted_at IS NULL
      LIMIT 50
    `;
    if (docs.length === 0) throw new Error('Brain has no documents — cannot seed burst');

    // Resolve at least one mcp_connection_id to use for invocations.
    const mcps = await sql<{ id: string; name: string }[]>`
      SELECT id, name FROM mcp_connections
      WHERE company_id = ${brain.company_id} AND status = 'active'
      LIMIT 5
    `;

    // Build the event plan based on the count budget.
    // We scale the prescribed mix proportionally if count != 40.
    const baseMix = { read: 25, mcpPair: 10, create: 3, delete: 2 };
    const total = baseMix.read + baseMix.mcpPair * 2 + baseMix.create + baseMix.delete;
    const scale = count / total;
    const reads = Math.max(1, Math.round(baseMix.read * scale));
    const mcpPairs = mcps.length > 0 ? Math.max(1, Math.round(baseMix.mcpPair * scale)) : 0;
    const creates = Math.max(0, Math.round(baseMix.create * scale));
    const deletes = Math.max(0, Math.round(baseMix.delete * scale));

    const plan: Plan[] = [];
    for (let i = 0; i < reads; i++) {
      const doc = pick(docs);
      plan.push({
        category: 'document_access', eventType: 'document.read',
        details: { path: doc.path },
        targetType: 'document', targetId: doc.id,
      });
    }
    for (let i = 0; i < mcpPairs; i++) {
      const mcp = pick(mcps);
      const originDoc = pick(docs);
      const invocationId = randomUUID();
      const durationMs = 200 + Math.floor(Math.random() * 1300);
      plan.push({
        category: 'mcp_invocation', eventType: 'invoke',
        details: { invocation_id: invocationId, mcp_connection_id: mcp.id, mcp_name: mcp.name, origin_doc_id: originDoc.id, origin_doc_path: originDoc.path },
        targetType: null, targetId: null,
        invocationPair: 'invoke', pairId: invocationId,
      });
      plan.push({
        category: 'mcp_invocation', eventType: 'complete',
        details: { invocation_id: invocationId, mcp_connection_id: mcp.id, mcp_name: mcp.name, duration_ms: durationMs },
        targetType: null, targetId: null,
        invocationPair: 'complete', pairId: invocationId,
        delayBefore: durationMs, // emit complete after the simulated tool latency
      });
    }
    for (let i = 0; i < creates; i++) {
      // Synthesize a fake target_id that won't resolve in the graph yet —
      // hooks orphan-queue logic + SWR revalidation will reconcile.
      const fakeId = randomUUID();
      plan.push({
        category: 'document_mutation', eventType: 'create',
        details: { path: `/synthetic/burst-${i}-${fakeId.slice(0, 8)}` },
        targetType: 'document', targetId: fakeId,
      });
    }
    for (let i = 0; i < deletes; i++) {
      const doc = pick(docs);
      plan.push({
        category: 'document_mutation', eventType: 'delete',
        details: { path: doc.path },
        targetType: 'document', targetId: doc.id,
      });
    }

    // Shuffle reads + creates + deletes among the mcp pairs (but keep
    // invoke/complete order — invoke must come before its complete).
    const invokes = plan.filter((p) => p.invocationPair === 'invoke');
    const completes = plan.filter((p) => p.invocationPair === 'complete');
    const others = plan.filter((p) => !p.invocationPair);
    const shuffled: Plan[] = [];
    let oi = 0; let ii = 0;
    while (oi < others.length || ii < invokes.length) {
      // Interleave roughly: 2 others : 1 invoke
      if (Math.random() < 0.7 && oi < others.length) shuffled.push(others[oi++]);
      else if (ii < invokes.length) shuffled.push(invokes[ii++]);
      else if (oi < others.length) shuffled.push(others[oi++]);
    }

    console.log(`Seeding ${shuffled.length + completes.length} events to brain ${brainId} at ~${intervalMs}ms intervals...`);

    let i = 0;
    for (const evt of shuffled) {
      const actor = pick(ACTORS);
      await sql`
        INSERT INTO audit_events (
          company_id, brain_id, actor_type, actor_id, actor_name,
          target_type, target_id, category, event_type, details
        ) VALUES (
          ${brain.company_id}, ${brainId}, ${actor.type}, ${actor.id}, ${actor.name},
          ${evt.targetType}, ${evt.targetId}, ${evt.category}, ${evt.eventType}, ${sql.json(evt.details as unknown as import('postgres').JSONValue)}
        )
      `;
      i++;
      if (i % 10 === 0) console.log(`  -> ${i} events sent`);
      await sleep(intervalMs);

      // After each invoke, schedule its paired complete to fire after
      // the simulated tool latency (in addition to the regular interval).
      if (evt.invocationPair === 'invoke') {
        const complete = completes.find((c) => c.pairId === evt.pairId);
        if (complete) {
          await sleep(complete.delayBefore ?? 0);
          await sql`
            INSERT INTO audit_events (
              company_id, brain_id, actor_type, actor_id, actor_name,
              target_type, target_id, category, event_type, details
            ) VALUES (
              ${brain.company_id}, ${brainId}, ${actor.type}, ${actor.id}, ${actor.name},
              ${complete.targetType}, ${complete.targetId}, ${complete.category}, ${complete.eventType}, ${sql.json(complete.details as unknown as import('postgres').JSONValue)}
            )
          `;
          i++;
        }
      }
    }

    console.log(`Done. Seeded ${i} events total.`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('Burst seed failed:', err);
  process.exit(1);
});
