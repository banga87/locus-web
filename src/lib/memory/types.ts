// Core types for the memory subsystem. Harness-pure: no imports from
// next/*, @vercel/functions, src/lib/agent, or src/lib/subagent.
//
// The MemoryProvider interface is intentionally NOT declared here yet —
// it will be extracted in Task 27 once the concrete implementation has
// settled. See docs/superpowers/specs/2026-04-22-agent-memory-architecture-design.md §5.3.

export type AuthoredBy =
  | 'human'
  | 'generating_agent'
  | 'maintenance_agent'
  | 'rule_based';

export type ConfidenceTier = 'authored' | 'extracted' | 'inferred';

// The structured summary persisted in documents.compact_index.
// Target ~40 tokens when JSON-serialized.
export interface CompactIndex {
  entities: string[];          // slugs referencing type=entity docs
  topics: string[];            // normalized lowercase
  flags: string[];             // controlled vocab (DECISION, POLICY, CORE, …)
  proper_nouns: string[];      // verbatim capitalized sequences from content
  key_sentence: string;        // <=200 chars verbatim
  date_hints: string[];        // ISO-8601 strings
  authored_by: AuthoredBy;
  computed_at: string;         // ISO-8601
}

// Input to retrieve(). brainId + companyId are REQUIRED — every query
// is tenant-scoped.
export interface RetrieveQuery {
  brainId: string;
  companyId: string;
  query: string;
  mode: 'scan' | 'expand' | 'hybrid';
  tierCeiling: ConfidenceTier;
  filters?: {
    folderPath?: string;
    docTypes?: string[];
    dateRange?: { from?: Date; to?: Date };
    flags?: string[];
    confidenceMin?: number;
  };
  limit?: number;
  tokenBudget?: number;
}

// Provenance attached to every retrieval result.
// Strict-tier callers receive only 'authored' | 'extracted' in
// confidenceTier — never 'inferred'. This is enforced inside the
// retrieval core by refusing to load inferred-tier content.
export interface Provenance {
  brainId: string;
  path: string;
  updatedAt: string;
  version: number;
  confidenceTier: 'authored' | 'extracted';
}

export interface Snippet {
  mode: 'compact' | 'headline' | 'full';
  text: string;
  anchor?: string;
}

export interface Excerpt {
  before: string;
  match: string;
  after: string;
}

export interface RankedResult {
  documentId: string;
  slug: string;
  title: string;
  score: number;
  provenance: Provenance;
  snippet: Snippet;
  compactIndex?: CompactIndex;
  excerpt?: Excerpt;
}

// Caller role gate for tierCeiling enforcement. Strict-tier callers
// (customer_facing, maintenance_agent) cannot request 'inferred'; only
// the research_subagent role may. See spec §5 on the tier model.
export type CallerRole = 'customer_facing' | 'research_subagent' | 'maintenance_agent';

export interface CallerContext {
  role: CallerRole;
}
