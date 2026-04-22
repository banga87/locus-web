//
// Controlled-vocab flag extraction. Looks for:
//   (a) ## FLAG_NAME headings (capital words)
//   (b) !flag_name hints anywhere in content

const CONTROLLED_FLAGS = new Set([
  'DECISION',
  'POLICY',
  'CORE',
  'PIVOT',
  'ORIGIN',
  'SENSITIVE',
  'TECHNICAL',
]);

export function extractFlags(content: string): string[] {
  if (!content) return [];

  const found = new Set<string>();

  // (a) ## HEADING form.
  const headingRe = /^#{1,6}\s+([A-Z][A-Z_]*)\b/gm;
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(content)) !== null) {
    const name = m[1];
    if (CONTROLLED_FLAGS.has(name)) found.add(name);
  }

  // (b) !flag_name form (case-insensitive).
  const hintRe = /(?:^|\s)!([a-z_]+)\b/g;
  while ((m = hintRe.exec(content)) !== null) {
    const name = m[1].toUpperCase();
    if (CONTROLLED_FLAGS.has(name)) found.add(name);
  }

  return Array.from(found).sort();
}
