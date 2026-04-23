//
// Word-frequency topic extraction with stopword filter. Normalized to
// lowercase, length >= 3. Ordered by descending frequency.

const STOPWORDS = new Set([
  'the', 'and', 'but', 'for', 'nor', 'yet', 'so',
  'a', 'an', 'in', 'on', 'at', 'to', 'of', 'with',
  'is', 'was', 'are', 'were', 'be', 'been', 'being',
  'this', 'that', 'these', 'those', 'it', 'its',
  'we', 'you', 'they', 'he', 'she', 'i',
  'not', 'no', 'yes', 'or', 'if', 'then', 'than',
  'by', 'from', 'as', 'into', 'about', 'will', 'would',
  'can', 'could', 'should', 'may', 'might', 'must',
  'have', 'has', 'had', 'do', 'does', 'did',
  'all', 'any', 'some', 'each', 'every',
  'more', 'most', 'less', 'least', 'very',
]);

const MIN_LEN = 3;
const MAX_ENTRIES = 8;

export function extractTopics(content: string): string[] {
  if (!content) return [];

  const counts = new Map<string, number>();
  const tokens = content
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= MIN_LEN && !STOPWORDS.has(t));

  for (const t of tokens) {
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_ENTRIES)
    .map(([w]) => w);
}
