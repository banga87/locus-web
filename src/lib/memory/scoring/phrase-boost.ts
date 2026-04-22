//
// Multiplicative boost applied to a document's score when the query
// contains one or more quoted phrases AND the document verbatim
// contains that phrase. Case-insensitive match. Per spec §7 hybrid
// scoring.

const BOOST = 1.6;

export function phraseBoost(query: string, content: string): number {
  const phrases = extractQuotedPhrases(query);
  if (phrases.length === 0) return 1.0;

  const lowerContent = content.toLowerCase();
  let multiplier = 1.0;
  for (const p of phrases) {
    if (lowerContent.includes(p.toLowerCase())) multiplier *= BOOST;
  }
  return multiplier;
}

function extractQuotedPhrases(query: string): string[] {
  const out: string[] = [];
  const re = /"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query)) !== null) {
    const trimmed = m[1].trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}
