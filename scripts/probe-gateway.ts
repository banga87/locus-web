// Usage:
//   npx tsx scripts/probe-gateway.ts
//
// Hits the Vercel AI Gateway with every model in APPROVED_MODELS using a tiny
// `generateText` call and prints per-model pass/fail + raw error. Zero Next.js
// dependencies — isolates the Gateway layer so we can tell auth errors from
// model-slug errors from network errors.

import { config } from 'dotenv';
import { generateText } from 'ai';
import { gateway } from '@ai-sdk/gateway';

import { APPROVED_MODELS } from '../src/lib/models/approved-models';

config({ path: '.env.local' });
config({ path: '.env' });

async function probe(modelId: string): Promise<void> {
  process.stdout.write(`  ${modelId.padEnd(50)} `);
  try {
    const { text, usage } = await generateText({
      model: gateway(modelId),
      prompt: 'Reply with the single word: pong',
    });
    process.stdout.write(
      `OK  (${usage.totalTokens} tok) -> ${JSON.stringify(text.slice(0, 40))}\n`,
    );
  } catch (err) {
    const name = err instanceof Error ? err.name : typeof err;
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(`FAIL  [${name}] ${message}\n`);
  }
}

async function main(): Promise<void> {
  const oidc = process.env.VERCEL_OIDC_TOKEN;
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  console.log(
    `Auth:  VERCEL_OIDC_TOKEN=${oidc ? `present (${oidc.length} chars)` : 'MISSING'}  AI_GATEWAY_API_KEY=${apiKey ? 'present' : 'missing'}`,
  );
  console.log('');
  for (const id of APPROVED_MODELS) {
    await probe(id);
  }
}

main().catch((err) => {
  console.error('Probe crashed:', err);
  process.exit(1);
});
