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

// Match individual capitalized words (at least one lowercase/digit char)
const CAPITALIZED_WORD_RE = /\b[A-Z][a-z0-9]*\b/g;

export function extractProperNouns(content: string): string[] {
  if (!content) return [];

  // Split on sentence boundaries
  const sentences = content.split(/[.!?]+/).filter(s => s.trim());
  const seen = new Set<string>();
  const out: string[] = [];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    // Find all capitalized words with their positions
    const words: Array<{ word: string; index: number }> = [];
    let match: RegExpExecArray | null;
    CAPITALIZED_WORD_RE.lastIndex = 0;
    while ((match = CAPITALIZED_WORD_RE.exec(trimmed)) !== null) {
      words.push({ word: match[0], index: match.index });
    }

    // Process words, trying to form two-word compounds
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const isFirstWord = i === 0;

      // Skip sentence-initial stopwords
      if (isFirstWord && SENTENCE_INITIAL_STOPWORDS.has(w.word)) {
        continue;
      }

      let phrase = w.word;

      // Try to form a two-word phrase if the next word is immediately adjacent,
      // different from current word, and neither contains digits (to avoid pairing auto-generated names)
      if (i + 1 < words.length) {
        const nextW = words[i + 1];
        // Adjacent means next word starts where current ends (plus space)
        const isAdjacent = nextW.index === w.index + w.word.length + 1;
        const hasDigits = /\d/.test(w.word) || /\d/.test(nextW.word);
        if (isAdjacent && nextW.word !== w.word && !hasDigits) {
          phrase = `${w.word} ${nextW.word}`;
          i++; // Skip the next word
        }
      }

      // Skip duplicates
      if (seen.has(phrase)) continue;

      seen.add(phrase);
      out.push(phrase);
      if (out.length >= MAX_ENTRIES) return out;
    }
  }

  return out;
}
