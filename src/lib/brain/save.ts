// Brain-document write-path helpers.
//
// This module sits between the brain-document route handlers
// (`src/app/api/brain/documents/route.ts`, and the `[id]/route.ts`
// counterpart) and the storage layer. It exposes:
//
//   - Pure frontmatter helpers (`parseFrontmatterRaw`,
//     `extractDocumentTypeFromFrontmatter`, `extractDocumentTypeFromContent`)
//     for deriving the denormalised `documents.type` column from a doc's
//     YAML preamble.
//   - A legacy no-op helper (`maybeScheduleSkillManifestRebuild`). It
//     used to forward skill-doc edits to a debounced manifest rebuild
//     scheduler; progressive-disclosure skills (see
//     `src/lib/skills/README.md`) surface skills through the system
//     prompt at turn time, so no per-write rebuild is needed. The
//     helper remains as a no-op purely to avoid touching every call
//     site (brain routes + tool implementations) in this refactor —
//     follow-up work can delete the call sites entirely.
//
// Why a separate, generic frontmatter parser here — `parseFrontmatter`
// in `./frontmatter.ts` is narrowly typed to the 8 keys the document
// *serialiser* emits; unknown keys like `type` are dropped. We need a
// raw Record<string, unknown> view to pick out arbitrary vocabulary
// fields. This helper is a tiny superset — same on-disk format, no
// key allowlist.

/**
 * Parse a frontmatter block from raw document content into a generic
 * key/value record. Values use the same narrow scalar grammar as
 * `parseFrontmatter` (quoted strings via JSON.parse, bare numbers,
 * `null`/`true`/`false`, otherwise raw string).
 *
 * Returns an empty object when the input has no `---\n` frontmatter
 * preamble or no closing `---` marker.
 */
export function parseFrontmatterRaw(
  raw: string,
): Record<string, string | number | boolean | null> {
  if (!raw.startsWith('---\n')) return {};
  const closeIdx = raw.indexOf('\n---\n', 4);
  // Also tolerate a frontmatter block with no trailing newline after
  // the closing `---` (e.g. when content ends immediately after it).
  const closeIdxEof =
    closeIdx === -1 && raw.endsWith('\n---') ? raw.length - 4 : closeIdx;
  if (closeIdxEof === -1) return {};

  const block = raw.slice(4, closeIdxEof);

  const out: Record<string, string | number | boolean | null> = {};
  for (const line of block.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();
    if (!key) continue;
    out[key] = parseScalar(rawValue);
  }
  return out;
}

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
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
    return Number(raw);
  }
  return raw;
}

/**
 * Pull the `type` value out of parsed YAML frontmatter.
 *
 * Returns the string value as-is when present and non-empty; returns
 * `null` for missing keys, non-string values, or empty strings. The
 * caller writes the result straight to `documents.type`, which is
 * nullable by design — an absent frontmatter type yields a NULL column
 * rather than a sentinel string.
 *
 * The three reserved values (`agent-scaffolding`, `agent-definition`,
 * `skill`) are NOT validated here. Validation is the job of the
 * frontmatter-schema layer (Task 4 — Zod/AJV schemas per doc type).
 * This helper is deliberately permissive so arbitrary vocabulary types
 * (e.g. `pricing-model`, `icp`) flow through unchanged.
 */
export function extractDocumentTypeFromFrontmatter(
  frontmatter: Record<string, unknown> | null | undefined,
): string | null {
  if (!frontmatter) return null;
  const t = frontmatter.type;
  return typeof t === 'string' && t.length > 0 ? t : null;
}

/**
 * Convenience wrapper: parse raw document content and return the
 * `type` frontmatter value in one call. Returns null when there is no
 * frontmatter block or no non-empty `type` key.
 */
export function extractDocumentTypeFromContent(
  content: string,
): string | null {
  return extractDocumentTypeFromFrontmatter(parseFrontmatterRaw(content));
}

/**
 * Legacy no-op — the compiled skill-manifest mechanism has been
 * replaced by progressive-disclosure skills. This helper is retained
 * so brain routes + tool implementations still import a valid symbol;
 * follow-up work can remove the call sites entirely.
 *
 * Parameters are ignored; the function name stays so existing tests
 * that spy on it via `vi.mock` continue to match.
 */
export function maybeScheduleSkillManifestRebuild(
  _companyId: string,
  _docType: string | null,
): void {
  // Intentionally empty — see module header.
}
