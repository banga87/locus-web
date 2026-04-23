// Regex-based proper-noun extraction with a stopword list of sentence-
// initial words that commonly begin sentences without being proper nouns.
// Deterministic, zero-cost; runs on every document save.

const SENTENCE_INITIAL_STOPWORDS = new Set([
  'The', 'A', 'An', 'This', 'That', 'These', 'Those',
  'It', 'We', 'You', 'They', 'He', 'She', 'I',
  'Today', 'Yesterday', 'Tomorrow', 'Now', 'Then',
  'However', 'Therefore', 'But', 'And', 'Or', 'So',
  'After', 'Before', 'When', 'While', 'Since',
]);

const MAX_ENTRIES = 20;

// Matches one or more consecutive Capitalized words (exactly one
// uppercase letter followed by lowercase letters). This excludes
// ALLCAPS acronyms like API / HTTP / GET.
const PROPER_NOUN_RE = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;

export function extractProperNouns(content: string): string[] {
  if (!content) return [];

  const sentences = content.split(/(?<=[.!?])\s+/);
  const seen = new Set<string>();
  const out: string[] = [];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    // Collect candidates with their position in the sentence so we can
    // drop sentence-initial stopwords (position 0).
    let match: RegExpExecArray | null;
    PROPER_NOUN_RE.lastIndex = 0;
    while ((match = PROPER_NOUN_RE.exec(trimmed)) !== null) {
      const phrase = match[1];
      const startsAtZero = match.index === 0;
      const firstWord = phrase.split(/\s+/)[0];

      if (startsAtZero && SENTENCE_INITIAL_STOPWORDS.has(firstWord)) {
        continue;
      }
      if (seen.has(phrase)) continue;

      seen.add(phrase);
      out.push(phrase);
      if (out.length >= MAX_ENTRIES) return out;
    }
  }

  return out;
}
