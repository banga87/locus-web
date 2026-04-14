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
//   - One dispatch helper (`maybeScheduleSkillManifestRebuild`) that
//     forwards skill-doc edits to the manifest loader's debounced
//     rebuild scheduler. Pure dispatch — no DB calls itself, just a
//     conditional re-export.
//
// Why these live together: route handlers need both on every write
// (extract → write to `type` column → schedule rebuild). Co-locating
// them keeps the call sites small and gives Task 3 a single import
// surface to add the rebuild trigger to.
//
// Why a separate, generic frontmatter parser here — `parseFrontmatter`
// in `./frontmatter.ts` is narrowly typed to the 8 keys the document
// *serialiser* emits; unknown keys like `type` are dropped. We need a
// raw Record<string, unknown> view to pick out arbitrary vocabulary
// fields. This helper is a tiny superset — same on-disk format, no
// key allowlist.

import { scheduleManifestRebuild } from '@/lib/skills/loader';

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
 * Dispatch a skill-manifest rebuild when a brain-doc write touches a
 * skill doc. Routes call this on POST/PATCH/DELETE — the helper is a
 * thin guard that forwards to the loader's debouncer when the doc type
 * is `'skill'` and no-ops otherwise.
 *
 * Why dispatch sits in the brain layer (and not the loader): the
 * manifest loader is generic — it doesn't know which write paths exist.
 * The brain save path is the one that knows when a write happens. Pure
 * dispatch (no DB calls) keeps this helper unit-testable without
 * touching the loader's debounce timer.
 *
 * `docType` may be the new type (writes), the old type (deletes), or
 * either side of a re-typing (PATCH that flips skill -> knowledge);
 * the route handler is responsible for calling this with both old and
 * new on a re-type so the manifest can drop the orphaned entry.
 */
export function maybeScheduleSkillManifestRebuild(
  companyId: string,
  docType: string | null,
): void {
  if (docType === 'skill') {
    scheduleManifestRebuild(companyId);
  }
}
