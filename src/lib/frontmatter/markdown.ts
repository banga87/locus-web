// src/lib/frontmatter/markdown.ts
//
// Pure helpers for splitting and reassembling a markdown document whose
// head is a YAML frontmatter block. Tiptap/marked/turndown never see the
// frontmatter — callers strip it before load and glue it back at save.
//
// The YAML emitter is hand-rolled against a declared schema rather than
// using js-yaml.dump because we need:
//   - stable key order (matches `schema.fields`)
//   - `null` emitted as the literal 'null' (not the empty scalar)
//   - empty arrays inline as `[]`
//   - no fancy anchors, tags, or multi-line scalar styles
// These match the existing canonical shape of WORKFLOW_FRONTMATTER so a
// no-op save is byte-identical on disk.

import type { FrontmatterSchema } from './schemas/types';

export interface SplitResult {
  /** YAML payload with the --- fences stripped, or null if none. */
  frontmatterText: string | null;
  /** Everything after the closing fence (blank-line after it trimmed). */
  body: string;
}

/**
 * Recognise a document that begins with a `---\n` frontmatter fence and
 * split it from the body. Strict: the document must start with the fence
 * on the very first line; an interior `---` is not treated as frontmatter.
 *
 * CRLF-safe — the fence regex tolerates `\r\n` line endings the same way
 * the PATCH route's frontmatter-sync regex does.
 */
export function splitFrontmatter(content: string): SplitResult {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n)?/);
  if (!match) return { frontmatterText: null, body: content };

  const frontmatterText = match[1];
  let body = content.slice(match[0].length);
  // If the closing fence is followed by a blank separator line, strip one
  // so the reassembled file doesn't accumulate leading blank lines.
  if (body.startsWith('\r\n')) body = body.slice(2);
  else if (body.startsWith('\n')) body = body.slice(1);
  return { frontmatterText, body };
}

/**
 * Emit the schema-ordered YAML body (no fences). Deterministic for a
 * given value+schema pair.
 */
export function emitSchemaYaml(
  value: Record<string, unknown>,
  schema: FrontmatterSchema,
): string {
  const lines: string[] = [`type: ${schema.type}`];
  for (const field of schema.fields) {
    const v = value[field.name];
    switch (field.kind) {
      case 'enum':
      case 'string': {
        lines.push(`${field.name}: ${v == null ? '' : String(v)}`);
        break;
      }
      case 'nullable-string': {
        lines.push(`${field.name}: ${v == null ? 'null' : String(v)}`);
        break;
      }
      case 'string-array': {
        if (!Array.isArray(v) || v.length === 0) {
          lines.push(`${field.name}: []`);
        } else {
          lines.push(`${field.name}:`);
          for (const item of v) lines.push(`  - ${String(item)}`);
        }
        break;
      }
    }
  }
  return lines.join('\n');
}

/**
 * Reassemble a canonical markdown file: `---\n<yaml>\n---\n\n<body>`.
 * When `schema` is null the body is returned unchanged (document type has
 * no registered schema — no frontmatter is emitted, caller has already
 * decided the panel is inapplicable).
 */
export function joinFrontmatter(
  value: Record<string, unknown> | null,
  body: string,
  schema: FrontmatterSchema | null,
): string {
  if (!schema || !value) return body;
  const yaml = emitSchemaYaml(value, schema);
  return `---\n${yaml}\n---\n\n${body}`;
}
