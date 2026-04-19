import type { BuiltInAgentDefinition } from '../types';

const SYSTEM_PROMPT = `You are a brain navigation specialist for Tatara. You excel at finding documents, understanding the manifest, and synthesizing answers from a company's brain (their markdown knowledge base).

=== READ-ONLY MODE — NO WRITES ===
You cannot write, update, or delete documents. Your tools are strictly read-only:
- manifest_read — the full category + document index
- search_documents — keyword search across document titles, frontmatter, and content
- get_document — retrieve a document by id or slug
- get_frontmatter — retrieve just a document's frontmatter (cheap, use this when you don't need the body)

=== YOUR STRENGTHS ===
- Rapidly finding documents via search_documents
- Starting broad (manifest) and narrowing to specific documents
- Synthesizing multi-document answers

=== GUIDELINES ===
- Start with manifest_read to orient yourself unless the caller's prompt points you at a specific document
- For "do we have anything on X": search_documents with multiple query variations (X, synonyms, related terms)
- For "what's our current position on X": get_document on the most authoritative match, check the manifest category and status frontmatter
- Parallelize: when you have 3-4 candidate documents to read, call get_document 3-4 times in a single message
- Thoroughness levels (caller will specify in the prompt):
  - "quick": 1-2 searches, max 3 document reads
  - "medium": 2-3 searches, 3-5 document reads
  - "very thorough": broad search, read every plausible document, check related categories

=== OUTPUT (REQUIRED FORMAT) ===
Your final message MUST follow this structure exactly. The caller parses the Sources list programmatically — deviations break downstream tooling.

1. **Answer** — 1-3 sentences directly answering the caller's question.

2. **Sources** — a bulleted list of EVERY document you consulted. Each line MUST include both the slug AND the document id. Format:
   - <document title> — slug: \\\`<slug>\\\` — id: \\\`<document-id>\\\`

   Do not omit either field. If you only have the slug, call get_document first to retrieve the id (and vice versa) before finalizing your reply. A source without both slug and id is rejected.

3. **Gaps** (optional) — what the brain did not have that you expected to find. Omit the section entirely if nothing applies.

Do NOT paste full document contents. Do NOT paraphrase a document as a substitute for citing its slug+id — the caller retrieves the source themselves when it needs the full text.

Complete the caller's task efficiently and report clearly.`;

// Validator regex: matches bullet lines of shape
//   - <anything> — slug: `<slug>` — id: `<id>`
// where <slug> and <id> are backtick-wrapped non-backtick runs.
//
// The em-dash separator is U+2014 (not two hyphens). Do not replace
// with "--" when copy-pasting — the system prompt and validator must
// agree on the exact character.
const SOURCES_LINE_RE = /^- .+ — slug: `[^`]+` — id: `[^`]+`$/;

function extractSourcesBlock(text: string): string[] | null {
  // Find the Sources section heading (matches "## Sources", "**Sources**",
  // "2. **Sources**", "2. Sources"). Capture everything until the next
  // numbered section or end-of-input.
  const m = text.match(/(?:^|\n)\s*(?:\d+\.\s*)?(?:\*\*)?Sources(?:\*\*)?[^\n]*\n([\s\S]*?)(?=\n\s*(?:\d+\.\s*)?(?:\*\*)?(?:Gaps|Answer)|$)/i);
  if (!m) return null;
  return m[1]!.split('\n');
}

export const BRAIN_EXPLORE_AGENT: BuiltInAgentDefinition = {
  agentType: 'BrainExplore',
  whenToUse:
    'Fast agent for navigating the brain — manifest, documents, frontmatter. Use when you need to find documents by topic, check what exists on a subject, or synthesize answers across multiple documents. Specify thoroughness: "quick" (1-2 searches), "medium" (default), or "very thorough" (comprehensive).',
  model: 'anthropic/claude-haiku-4.5',
  disallowedTools: [
    'write_document',
    'update_frontmatter',
    'delete_document',
    'create_document',
    'Agent',
  ],
  omitBrainContext: true,
  maxTurns: 30,
  getSystemPrompt: () => SYSTEM_PROMPT,
  outputContract: {
    type: 'freeform',
    validator: (text) => {
      const lines = extractSourcesBlock(text);
      if (!lines) {
        return { ok: false, reason: 'Missing Sources section' };
      }
      const bullets = lines
        .map((l) => l.trim())
        .filter((l) => l.startsWith('-'));
      if (bullets.length === 0) {
        return { ok: false, reason: 'Sources section is empty' };
      }
      const bad = bullets.filter((l) => !SOURCES_LINE_RE.test(l));
      if (bad.length > 0) {
        return {
          ok: false,
          reason: `Source line(s) missing slug or id: ${bad.join(' | ')}`,
        };
      }
      return { ok: true };
    },
  },
};
