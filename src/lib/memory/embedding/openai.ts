// OpenAI Embedder, routed through the Vercel AI Gateway. Uses
// text-embedding-3-small (1536 dim). Wraps embed/embedMany so call
// sites remain provider-agnostic via the Embedder interface.
//
// Auth path: Gateway uses Vercel's OIDC token (VERCEL_OIDC_TOKEN env
// var, populated by `vercel env pull .env.local`). No raw OpenAI API
// key is held by this code — provider routing, failover, and cost
// telemetry happen in the Gateway control plane.
//
// Harness-pure — only imports `ai` and `@ai-sdk/gateway`. Both are
// platform-agnostic (no Next.js / @vercel/functions coupling).

import { embed, embedMany } from 'ai';
import { gateway } from '@ai-sdk/gateway';
import {
  EMBEDDING_MODEL_ID,
  EMBEDDING_DIMENSION,
  type Embedder,
  type EmbedResult,
} from './types';

// Gateway model id is `<provider>/<model>`; provider prefix is required.
const model = gateway.textEmbeddingModel(`openai/${EMBEDDING_MODEL_ID}`);

export const openaiEmbedder: Embedder = {
  async embed(text: string): Promise<EmbedResult> {
    const { embedding, usage } = await embed({ model, value: text });
    return {
      vector: embedding,
      promptTokens: usage?.tokens ?? 0,
    };
  },

  async embedMany(texts: string[]): Promise<EmbedResult[]> {
    const { embeddings, usage } = await embedMany({ model, values: texts });
    // OpenAI returns a single aggregate token count for the batch. Divide
    // pro-rata across inputs so per-doc usage_records sum to the actual
    // billed total. Imperfect (per-doc accuracy isn't load-bearing) but
    // billing-faithful in aggregate.
    const total = usage?.tokens ?? 0;
    const perDoc = embeddings.length > 0 ? Math.floor(total / embeddings.length) : 0;
    const remainder = total - perDoc * embeddings.length;
    return embeddings.map((vector, i) => ({
      vector,
      promptTokens: i === 0 ? perDoc + remainder : perDoc,
    }));
  },

  describe() {
    return { model: EMBEDDING_MODEL_ID, dimension: EMBEDDING_DIMENSION };
  },
};
