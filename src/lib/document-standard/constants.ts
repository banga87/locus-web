// The seven folders, seven document types, and source-format prefixes
// defined by the Tatara Document Standard v1 spec
// (docs/superpowers/specs/refined-focus/2026-04-25-tatara-document-standard.md).
//
// The constants are the single source of truth. Anything that needs to
// know "is this a real folder?" or "is this a real type?" imports from
// here. Don't inline string literals elsewhere.

/**
 * The seven folders. Order is the spec's; agents may rely on it for
 * deterministic display.
 */
export const FOLDERS = [
  'company',
  'customers',
  'market',
  'product',
  'marketing',
  'operations',
  'signals',
] as const;

export type Folder = (typeof FOLDERS)[number];

export const FOLDER_DESCRIPTIONS: Record<Folder, string> = {
  company:
    'Brand voice, brand/design, mission, values, internal team, roles, structure.',
  customers:
    'CRM-flavored: customer accounts, contacts, conversations, feedback, account-level pricing.',
  market: 'ICPs, competitive landscape, positioning, market research.',
  product:
    'Products, pricing, roadmap, technical architecture, product research.',
  marketing:
    'Campaigns, email sequences, website copy, social content, events.',
  operations: 'Procedures, policies, tools, vendors.',
  signals:
    'Time-stamped raw input: rambles, meeting notes, slack captures, in-flight thoughts.',
};

/**
 * The seven document types. Order is the spec's.
 */
export const DOCUMENT_TYPES = [
  'canonical',
  'decision',
  'note',
  'fact',
  'procedure',
  'entity',
  'artifact',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_DESCRIPTIONS: Record<DocumentType, string> = {
  canonical:
    'Long-lived authoritative single-source-of-truth (e.g., brand voice, ICP definition, pricing structure).',
  decision: 'Decision record with provenance.',
  note:
    'Informal time-stamped capture (meeting notes, ramble, research-in-flight).',
  fact:
    'Atomic attributed statement with validity window (e.g., "Q4 revenue was $X").',
  procedure: 'Ordered runbook (e.g., "How we handle refund requests").',
  entity: 'Person/company/vendor record.',
  artifact:
    'Operational working doc with lifecycle (e.g., campaign brief, email sequence draft).',
};

/**
 * Existing system types that predate the standard. Documents with
 * these types skip the per-type frontmatter validators — their schemas
 * are owned by the agent / skill subsystems, not the document
 * standard. Listed here so the master validator can short-circuit
 * cleanly instead of failing them as "unknown type".
 */
export const RESERVED_TYPES = [
  'agent-scaffolding',
  'agent-definition',
  'skill',
] as const;

export type ReservedType = (typeof RESERVED_TYPES)[number];

export function isStandardType(value: unknown): value is DocumentType {
  return (
    typeof value === 'string' &&
    (DOCUMENT_TYPES as readonly string[]).includes(value)
  );
}

export function isReservedType(value: unknown): value is ReservedType {
  return (
    typeof value === 'string' &&
    (RESERVED_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Allowed `source` prefixes. The full source string is
 * `<prefix><identifier>` — e.g., `agent:claude-code`, `human:angus`,
 * `agent:maintenance`. Validation is just "starts with one of these".
 */
export const SOURCE_PREFIXES = ['agent:', 'human:'] as const;
