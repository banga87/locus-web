// TS types for universal + per-type frontmatter blocks. These mirror
// the Zod schemas one-for-one (the schemas in `./universal-schema.ts`
// and `./type-schemas/*.ts` are the runtime source of truth — these
// are the typeck shape callers consume).

import type { DocumentType } from './constants';

export type ConfidenceLevel = 'low' | 'medium' | 'high';
export type DocumentStatus = 'active' | 'archived' | 'superseded' | 'draft';

export interface UniversalFrontmatter {
  id: string;
  title: string;
  type: DocumentType | (string & {}); // reserved types pass through
  source: string;
  topics: string[];
  confidence: ConfidenceLevel;
  status: DocumentStatus;
}

export interface CanonicalFields {
  owner: string;
  last_reviewed_at: string; // ISO date
}

export interface DecisionFields {
  decided_by: string[];
  decided_on: string; // ISO date
  supersedes?: string;
  superseded_by?: string;
}

export interface NoteFields {
  captured_from: 'meeting' | 'slack' | 'call' | 'email' | 'other';
  participants?: string[];
  promotes_to?: string;
}

export interface FactFields {
  evidence: string;
  valid_from: string; // ISO date
  valid_to?: string;
}

export interface ProcedureFields {
  applies_to: string[];
  prerequisites?: string[];
}

export interface EntityFields {
  kind: 'person' | 'company' | 'vendor';
  relationship: 'customer' | 'prospect' | 'partner' | 'team' | 'other';
  contact_points?: string[];
  current_state: string;
  last_interaction?: string;
}

export interface ArtifactFields {
  lifecycle: 'draft' | 'live' | 'archived';
  version: number;
  owner: string;
  launched_at?: string;
  retired_at?: string;
  channel?: 'email' | 'web' | 'social' | 'event' | 'other';
}
