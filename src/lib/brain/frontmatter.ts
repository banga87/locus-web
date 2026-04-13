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
