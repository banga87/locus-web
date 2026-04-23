// Embedder interface + dimension constant. Phase 2 ships a single
// concrete implementation (OpenAI via AI SDK) but the interface lives
// so Phase 2.5 (chunking) and Phase 5 (alternative providers) can swap
// implementations without touching call sites.
//
// Harness-pure — no imports from next/*, @vercel/functions, or src/lib/agent.

export const EMBEDDING_MODEL_ID = 'text-embedding-3-small';
export const EMBEDDING_DIMENSION = 1536;

export interface EmbedResult {
  vector: number[];        // length === EMBEDDING_DIMENSION
  promptTokens: number;    // for usage_records billing
}

export interface Embedder {
  embed(text: string): Promise<EmbedResult>;
  embedMany(texts: string[]): Promise<EmbedResult[]>;
  describe(): { model: string; dimension: number };
}

// Args passed through every step of the embedDocumentWorkflow. The
// tenant tuple is included so the workflow loads + persists with
// (id, companyId, brainId) defense-in-depth scoping. See spec §5.3.
export interface EmbedJobArgs {
  documentId: string;
  companyId: string;
  brainId: string;
}
