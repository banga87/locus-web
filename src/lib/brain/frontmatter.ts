// YAML frontmatter for document responses.
//
// Tools that return document content prepend a small frontmatter block so
// the consuming agent sees owner/status/confidence/is_core up-front without
// an extra metadata fetch. The format is a deliberately narrow subset of
// YAML — we emit it manually and parse it manually, no dependency needed.
//
// Serialization layout (7 controlled keys between the `---` markers):
//
//   ---
//   title: "Brand Voice Guide"
//   path: "brand/brand-voice-guide"
//   status: active
//   owner: "alice@example.com"
//   confidence_level: high
//   is_core: true
//   updated_at: 2026-04-13T12:34:56.000Z
//   version: 3
//   ---
//   <body>
//
// (Emitted order matches the spec in the task plan verbatim.)
//
// Controlled `type` vocabulary (app-level only — `documents.type` is a plain
// text column, not a Postgres enum, so no migration is needed to extend this
// list):
//
//   null               — plain knowledge document (no type set)
//   'agent-scaffolding'
//   'agent-definition'
//   'skill'            — authored instructions for an agent to execute.
//                        Optional `trigger:` block in the frontmatter marks
//                        the skill as triggerable (scheduled / on-demand run).
//                        See SkillTrigger below.

export interface DocumentFrontmatter {
  title: string;
  path: string;
  status: 'draft' | 'active' | 'archived';
  /** User email or null when the document has no owner. */
  owner: string | null;
  confidenceLevel: 'high' | 'medium' | 'low';
  isCore: boolean;
  /** ISO 8601 timestamp. */
  updatedAt: string;
  version: number;
}

/**
 * Render a frontmatter block followed by the document body. The body is
 * appended verbatim (no escaping) — content is already markdown.
 */
export function serializeFrontmatter(
  meta: DocumentFrontmatter,
  body: string,
): string {
  const lines = [
    '---',
    `title: ${JSON.stringify(meta.title)}`,
    `path: ${JSON.stringify(meta.path)}`,
    `status: ${meta.status}`,
    `owner: ${meta.owner ? JSON.stringify(meta.owner) : 'null'}`,
    `confidence_level: ${meta.confidenceLevel}`,
    `is_core: ${meta.isCore}`,
    `updated_at: ${meta.updatedAt}`,
    `version: ${meta.version}`,
    '---',
    '',
  ];
  return lines.join('\n') + body;
}

/**
 * Parse a frontmatter block written by `serializeFrontmatter`. Tolerant
 * of missing keys (returns `Partial<DocumentFrontmatter>`). If the input
 * does not start with a `---\n` marker, returns `{ meta: {}, body: raw }`.
 *
 * This is intentionally minimal — it supports only the exact key/value
 * shapes this codebase emits. Do not point a general YAML parser at it.
 */
export function parseFrontmatter(raw: string): {
  meta: Partial<DocumentFrontmatter>;
  body: string;
} {
  if (!raw.startsWith('---\n')) {
    return { meta: {}, body: raw };
  }

  // Find the closing marker. Must be a line containing exactly `---`.
  const closeIdx = raw.indexOf('\n---\n', 4);
  if (closeIdx === -1) {
    return { meta: {}, body: raw };
  }

  const block = raw.slice(4, closeIdx);
  // Body starts after the closing marker and its trailing blank line (if
  // present). We were written with a blank line after `---`, so strip one.
  let body = raw.slice(closeIdx + 5);
  if (body.startsWith('\n')) body = body.slice(1);

  const meta: Partial<DocumentFrontmatter> = {};
  for (const line of block.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();
    if (!key) continue;

    const value = parseScalar(rawValue);
    switch (key) {
      case 'title':
        if (typeof value === 'string') meta.title = value;
        break;
      case 'path':
        if (typeof value === 'string') meta.path = value;
        break;
      case 'status':
        if (value === 'draft' || value === 'active' || value === 'archived') {
          meta.status = value;
        }
        break;
      case 'owner':
        meta.owner = value === null ? null : typeof value === 'string' ? value : null;
        break;
      case 'confidence_level':
        if (value === 'high' || value === 'medium' || value === 'low') {
          meta.confidenceLevel = value;
        }
        break;
      case 'is_core':
        if (typeof value === 'boolean') meta.isCore = value;
        break;
      case 'updated_at':
        if (typeof value === 'string') meta.updatedAt = value;
        break;
      case 'version':
        if (typeof value === 'number') meta.version = value;
        break;
    }
  }

  return { meta, body };
}

// ---------------------------------------------------------------------------
// Skill trigger frontmatter
// ---------------------------------------------------------------------------
//
// A `type: skill` document becomes triggerable when its frontmatter carries a
// nested `trigger:` block. The block's fields (output, schedule,
// requires_mcps, output_category) are stored under `metadata.trigger` on the
// `documents` row.
//
// Runtime-stamped provenance fields (created_by_workflow, etc.) are written
// exclusively by triggered-skill run code paths and are modelled in
// WorkflowOutputStamp below. The stamp names retain the "workflow" prefix
// because the underlying `workflow_runs` operational table keeps its name —
// it records runs, not doc types.
//
// Storage: the trigger block is mirrored into `documents.metadata.trigger`
// (existing jsonb catch-all). No new DB columns are needed.

/**
 * The four authored fields of a skill's `trigger:` block (user-editable via
 * the Tiptap editor / frontmatter panel).
 *
 * `output_category` and `schedule` are always present in the validated value
 * (`validateSkillTrigger` normalises absent → null), so callers never need to
 * distinguish `undefined` vs `null`.
 */
export interface SkillTrigger {
  /** Cron string (reserved — nothing reads it yet) or null. */
  schedule: string | null;
  /** What the triggered skill produces when it runs. */
  output: 'document' | 'message' | 'both';
  /** Slug of the folder/category where output docs get filed. */
  output_category: string | null;
  /** MCP slugs that must be connected before the run can start. */
  requires_mcps: string[];
}

/**
 * Runtime-stamped provenance fields written on documents that were created or
 * last touched by a triggered-skill run. NOT user-editable — stamped by
 * triggered-skill run code paths and excluded from user-facing input schemas.
 *
 * Discriminated union: a stamp is either the "created" pair (immutable once
 * set, written exactly once when a run creates a doc) OR the "last-touched"
 * pair (overwritten on every run update of an existing doc). The stamp
 * middleware constructs one variant per operation type — never both in a
 * single write, never neither, never mixed.
 *
 * Field names keep the "workflow" prefix because they name columns produced
 * by the `workflow_runs` table, which keeps its name.
 */
export type WorkflowOutputStamp =
  | {
      /** Ref of the skill doc that created this document (immutable). */
      created_by_workflow: string;
      /** UUID of the run that created this document (immutable). */
      created_by_workflow_run_id: string;
    }
  | {
      /** Ref of the skill doc that last touched this document. */
      last_touched_by_workflow: string;
      /** UUID of the run that last touched this document. */
      last_touched_by_workflow_run_id: string;
    };

/** Validation error shape — one entry per failing field. */
export interface ValidationError {
  field: string;
  message: string;
}

const SKILL_TRIGGER_OUTPUT_VALUES: SkillTrigger['output'][] = [
  'document',
  'message',
  'both',
];

/**
 * Validate a raw trigger-block object as `SkillTrigger`. Accepts any `unknown`
 * input (the nested block — NOT the whole frontmatter, so there is no
 * top-level `type` field to check) and returns a tagged-union result so
 * callers can branch without throwing.
 *
 * Rules:
 *   - `output` is required and must be `'document' | 'message' | 'both'`
 *   - `requires_mcps` must be an array of strings; missing → invalid
 *   - `output_category` may be string, null, or absent (absent → null)
 *   - `schedule` may be string, null, or absent (absent → null)
 *
 * On success, `output_category` and `schedule` are always present in the
 * returned `value` — absence in the input is normalised to `null`.
 */
export function validateSkillTrigger(
  input: unknown,
):
  | { ok: true; value: SkillTrigger }
  | { ok: false; errors: ValidationError[] } {
  const errors: ValidationError[] = [];

  if (typeof input !== 'object' || input === null) {
    return {
      ok: false,
      errors: [{ field: 'input', message: 'must be an object' }],
    };
  }

  const fm = input as Record<string, unknown>;

  // output — required
  if (!('output' in fm) || fm['output'] === undefined || fm['output'] === null) {
    errors.push({ field: 'output', message: 'is required' });
  } else if (
    !SKILL_TRIGGER_OUTPUT_VALUES.includes(fm['output'] as SkillTrigger['output'])
  ) {
    errors.push({
      field: 'output',
      message: `must be one of: ${SKILL_TRIGGER_OUTPUT_VALUES.join(', ')}`,
    });
  }

  // requires_mcps — must be present and an array of strings
  if (!('requires_mcps' in fm)) {
    errors.push({ field: 'requires_mcps', message: 'is required' });
  } else if (!Array.isArray(fm['requires_mcps'])) {
    errors.push({ field: 'requires_mcps', message: 'must be an array' });
  } else if (fm['requires_mcps'].some((v) => typeof v !== 'string')) {
    errors.push({ field: 'requires_mcps', message: 'must be an array of strings' });
  }

  // output_category — optional string or null
  if (
    'output_category' in fm &&
    fm['output_category'] !== null &&
    typeof fm['output_category'] !== 'string'
  ) {
    errors.push({ field: 'output_category', message: 'must be a string or null' });
  }

  // schedule — optional string or null
  if (
    'schedule' in fm &&
    fm['schedule'] !== null &&
    typeof fm['schedule'] !== 'string'
  ) {
    errors.push({ field: 'schedule', message: 'must be a string or null' });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      output: fm['output'] as SkillTrigger['output'],
      output_category:
        'output_category' in fm
          ? (fm['output_category'] as string | null)
          : null,
      requires_mcps: fm['requires_mcps'] as string[],
      schedule:
        'schedule' in fm ? (fm['schedule'] as string | null) : null,
    },
  };
}

// ---------------------------------------------------------------------------

/**
 * Parse a single frontmatter scalar. Quoted strings use JSON.parse; `null`
 * / `true` / `false` map to their JS counterparts; bare numbers parse as
 * numbers; anything else is returned as a raw string.
 */
function parseScalar(raw: string): string | number | boolean | null {
  if (raw === 'null') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try {
      return JSON.parse(raw) as string;
    } catch {
      return raw;
    }
  }
  // Bare numeric literal? Let Number() decide; fall back to the raw string.
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
    return Number(raw);
  }
  return raw;
}
