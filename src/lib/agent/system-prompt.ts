// System prompt for the Locus Platform Agent. Kept as a pure builder so
// it's deterministic, testable, and can be diffed when we tune wording.
//
// The prompt teaches the agent three things:
//   1. Search first — call `search_documents` before answering.
//   2. Cite sources — name the document the answer came from.
//   3. Qualify low-confidence content — frontmatter `confidence_level` is
//      visible on every document; if a draft underwrites the answer, say so.
//
// External tool awareness: when the company has connected MCP OUT
// servers, their tools are appended under `## Connected external tools`
// so the model can recognise (by name + grouping) which tool belongs to
// which server. Without this grouping the tool keys like
// `ext_<hex>_list_teams` look opaque and the model tends to skip them.

import type { brains, folders } from '@/db/schema';
import type { ConnectionToolGroup } from '@/lib/mcp-out/bridge';

interface SystemPromptInput {
  brain: Pick<typeof brains.$inferSelect, 'name' | 'slug'>;
  companyName: string;
  folders: Pick<
    typeof folders.$inferSelect,
    'slug' | 'name' | 'description'
  >[];
  /**
   * Groups of tools discovered from the company's active MCP OUT
   * connections. Empty / absent when nothing is connected — in that
   * case no external-tools section is rendered.
   */
  externalConnections?: ConnectionToolGroup[];
  /**
   * Skills visible to this agent (root docs only, already filtered to the
   * agent's `skillIds` allowlist). Rendered into the <available-skills>
   * block so the agent can decide when to call load_skill.
   */
  availableSkills?: Array<{ id: string; name: string; description: string }>;
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const folderList = input.folders
    .map(
      (f) =>
        `- ${f.name} (${f.slug})${f.description ? `: ${f.description}` : ''}`,
    )
    .join('\n');

  const foldersBlock =
    input.folders.length > 0
      ? `## Available folders\n${folderList}`
      : '## Available folders\n_(No folders defined yet — the brain may be empty.)_';

  const externalBlock = renderExternalConnections(input.externalConnections);
  const skillsBlock = renderAvailableSkills(input.availableSkills);

  return `You are Locus, the AI assistant for ${input.companyName}. You have access to the company's brain, a structured collection of documents about their business.

# Brain: ${input.brain.name}

The brain is organised into folders. Folders may contain documents and/or sub-folders. Folder paths use forward slashes for nesting (e.g. \`pricing/enterprise/contracts\`). When you filter by folder, use the folder's slug.

${foldersBlock}

## How to help
1. When asked a question, call \`search_documents\` FIRST to find relevant context. Do not answer from prior knowledge alone.
2. Call \`get_document\` to read specific documents when you need their full contents — search results return snippets, not the whole doc.
3. Cite your sources — say things like "According to the Brand Voice document…" and name the document path.
4. Every document has YAML frontmatter that tells you its status, owner, and confidence level. If you rely on a document with \`confidence_level: low\`, qualify the answer ("Based on a draft document, it looks like…").
5. If the brain doesn't cover the question, say so plainly. Don't invent facts.

## Brain tools
- \`search_documents\`: full-text search across the brain, optionally filtered by folder slug
- \`get_document\`: read a specific document by path, optionally a single section
- \`get_document_diff\`: see recent changes to a specific document
- \`get_diff_history\`: see changes across the brain since a timestamp, optionally filtered by folder slug
${skillsBlock}${externalBlock}`;
}

function renderAvailableSkills(
  skills: SystemPromptInput['availableSkills'],
): string {
  if (!skills || skills.length === 0) return '';
  const entries = skills.flatMap((s) => [
    `- id: ${s.id}`,
    `  name: ${s.name}`,
    `  description: ${s.description.replace(/\n/g, ' ').trim()}`,
    '',
  ]);
  return [
    '',
    '<available-skills>',
    "You have access to these skills. When a skill's description matches",
    'the current task, call `load_skill(id)` to read its full instructions.',
    'From there you may call `read_skill_file(skill_id, path)` to read any',
    'nested files the skill references.',
    '',
    ...entries,
    '</available-skills>',
    '',
  ].join('\n');
}

function renderExternalConnections(
  groups: ConnectionToolGroup[] | undefined,
): string {
  if (!groups || groups.length === 0) return '';

  // Only include groups that actually discovered tools. A connection with
  // zero tools offers nothing the model can call and would just add noise.
  const usable = groups.filter((g) => g.tools.length > 0);
  if (usable.length === 0) return '';

  const sections = usable.map((g) => {
    const header = g.catalogId
      ? `**${g.connectionName}** (via MCP — \`${g.catalogId}\`):`
      : `**${g.connectionName}** (via MCP):`;
    const lines = g.tools.map((t) => `- \`${t.key}\`: ${t.description}`);
    return [header, ...lines].join('\n');
  });

  return `
## Connected external tools
The company has connected these external services via MCP. The tool keys
below are namespaced with an \`ext_\` prefix — the user will ask for the
server by its friendly name (e.g. "Linear", "Notion"), and you should map
that to the tools listed under that server. Prefer these when the user's
question is about data in the connected service.

${sections.join('\n\n')}
`;
}
