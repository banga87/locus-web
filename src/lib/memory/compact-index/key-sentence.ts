//
// Picks one short verbatim sentence to represent the document in
// retrieval results. Priority: sentences with decision words, then
// substantial-length sentences (>=12 tokens), then nothing.

const DECISION_WORDS = [
  'decided', 'chose', 'agreed', 'committed', 'launched',
  'shipped', 'rejected', 'approved', 'selected', 'picked',
  'will', 'must', 'require', 'mandate', 'policy',
];

const MAX_CHARS = 200;
const MIN_TOKENS = 12;

function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')
    .trim();
}

function truncate(s: string): string {
  if (s.length <= MAX_CHARS) return s;
  return s.slice(0, MAX_CHARS - 1).trimEnd() + '…';
}

export function extractKeySentence(content: string): string {
  if (!content) return '';

  const sentences = content
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((s) => stripMarkdown(s.trim()))
    .filter((s) => s.length > 0);

  // Priority 1: first sentence with a decision word.
  for (const s of sentences) {
    const lower = s.toLowerCase();
    if (DECISION_WORDS.some((w) => lower.includes(w))) {
      return truncate(s);
    }
  }

  // Priority 2: first sentence with >= MIN_TOKENS tokens.
  for (const s of sentences) {
    const tokenCount = s.split(/\s+/).length;
    if (tokenCount >= MIN_TOKENS) return truncate(s);
  }

  return '';
}
