const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const MAX_ENTRIES = 10;

function isValidDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  // Validate via Date; reject if it rolled over.
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function extractDateHints(content: string): string[] {
  if (!content) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  ISO_DATE_RE.lastIndex = 0;
  while ((m = ISO_DATE_RE.exec(content)) !== null) {
    const [full, ys, ms, ds] = m;
    const y = Number(ys);
    const mo = Number(ms);
    const d = Number(ds);
    if (!isValidDate(y, mo, d)) continue;
    if (seen.has(full)) continue;
    seen.add(full);
    out.push(full);
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}
