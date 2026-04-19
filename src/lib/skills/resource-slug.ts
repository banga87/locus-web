// Synthetic slug + path generators for skill-resource rows.
//
// `documents.slug` must be unique per brain for live rows, and `documents.path`
// is required non-null. Skill-resource rows are platform-internal (excluded
// from brain views by type) so these values never surface to users — they
// only need to satisfy the column constraints. Deriving from the row's own
// UUID guarantees uniqueness without another unique-index.

const MAX_PATH = 512;

export function deriveResourceSlug(resourceId: string): string {
  const stripped = resourceId.replace(/-/g, '');
  return `_r-${stripped.slice(0, 12)}`;
}

export function deriveResourcePath(
  parentSlug: string,
  relativePath: string,
): string {
  const full = `_skill-resource/${parentSlug}/${relativePath}`;
  return full.length <= MAX_PATH ? full : full.slice(0, MAX_PATH);
}
