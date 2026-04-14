export type ContextBlockKind =
  | 'scaffolding'
  | 'baseline'
  | 'skill'
  | 'attachment-inline'
  | 'attachment-pointer'
  | 'ingestion-filing'
  | 'agent-prompt-snippet';

export interface ContextBlock {
  kind: ContextBlockKind;
  title: string;
  body: string;
  /** Doc id for traceability when the block came from a brain doc. */
  sourceDocId?: string;
  /** For skill blocks. */
  skillId?: string;
  /** For attachment blocks. */
  attachmentId?: string;
}

export interface InjectedContext {
  blocks: ContextBlock[];
}
