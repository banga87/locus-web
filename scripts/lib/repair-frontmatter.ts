// scripts/lib/repair-frontmatter.ts
//
// Pure helpers for the migrate-repair-frontmatter script. No DB imports
// here — this module is safe to import from tests without spinning up
// postgres. The CLI entrypoint (../migrate-repair-frontmatter.ts)
// composes these with the DB layer.

import yaml from 'js-yaml';
import { splitFrontmatter } from '../../src/lib/frontmatter/markdown';
import { validateWorkflowFrontmatter } from '../../src/lib/brain/frontmatter';

export interface DocRow {
  type: string | null;
  metadata: Record<string, unknown> | null;
}

/** A doc is "corrupted" when its type is null but metadata still carries workflow fields. */
export function isCorruptedWorkflowDoc(row: DocRow): boolean {
  if (row.type !== null) return false;
  const meta = row.metadata ?? {};
  return Object.prototype.hasOwnProperty.call(meta, 'requires_mcps');
}

/** Compare two bodies with whitespace flattened, so migration doesn't block on formatting drift. */
export function bodiesEquivalent(a: string, b: string): boolean {
  return normalise(a) === normalise(b);
}

function normalise(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export interface V1Workflow {
  type: 'workflow';
  content: string; // full file, unchanged — safe to write back verbatim
  body: string;
  metadata: {
    output: 'document' | 'message' | 'both';
    output_category: string | null;
    requires_mcps: string[];
    schedule: string | null;
  };
}

/**
 * Strip the Tiptap-round-trip corruption preamble. The bug produces:
 *   "* * *\n\n## type: workflow output: document output\\_category: null
 *    requires\\_mcps: \\[\\] schedule: null\n\n<user body>"
 * That's Turndown's literal rendering of `<hr>` + `<h2>` after marked
 * treated the YAML fences as a thematic break and flattened the fields
 * into a heading. Backslash-escapes on `_` / `[` / `]` come from Turndown's
 * markdown-escape pass.
 *
 * The regex is intentionally strict — it matches only the exact shape the
 * corruption produces — so a user-authored `* * *` + `## …` combination
 * can never be mis-identified as corrupt.
 *
 * Returns the body with the preamble stripped when the pattern matches;
 * returns null when it doesn't (caller should skip — this doc doesn't
 * match the known corruption).
 */
export function stripCorruptionPreamble(content: string): string | null {
  const match = content.match(/^\* \* \*\n+## type: workflow [^\n]*\n+/);
  if (!match) return null;
  return content.slice(match[0].length);
}

/** Extract a validated workflow shape from a document_versions v1 content snapshot. */
export function extractWorkflowFromVersion1(content: string): V1Workflow | null {
  const { frontmatterText, body } = splitFrontmatter(content);
  if (frontmatterText == null) return null;

  let parsed: unknown;
  try {
    parsed = yaml.load(frontmatterText);
  } catch {
    return null;
  }
  const r = validateWorkflowFrontmatter(parsed);
  if (!r.ok) return null;
  return {
    type: 'workflow',
    content,
    body,
    metadata: {
      output: r.value.output,
      output_category: r.value.output_category,
      requires_mcps: r.value.requires_mcps,
      schedule: r.value.schedule,
    },
  };
}
