// Agent-definition service layer.
//
// Owns the rule that an agent-definition doc is a plain brain document
// whose content is YAML frontmatter wrapping the wizard's inputs plus
// an empty body. The route handlers (`src/app/api/agents/*`) call
// `buildAgentDefinitionDoc` to assemble the markdown before writing to
// the `documents` table — they never construct frontmatter inline.
//
// Keeping assembly isolated here means:
//   - The wizard UI only knows form fields, not YAML.
//   - Frontmatter key ordering + snake_case conventions live in one
//     place (see `baseline_docs`, `tool_allowlist`, etc.).
//   - A future "edit raw markdown" escape-hatch can round-trip through
//     this module + `parseFrontmatterRaw` from `@/lib/brain/save`.

import yaml from 'js-yaml';

import type { AgentWizardInput } from './wizard-schema';

export interface BuiltAgentDoc {
  frontmatter: Record<string, unknown>;
  content: string;
}

/**
 * Serialise a wizard input into an agent-definition brain document.
 *
 * Returns the parsed frontmatter object (so callers can e.g. store
 * individual keys in future) and the full markdown payload ready for
 * insertion into `documents.content`. The content is a frontmatter
 * block only — agent-definitions have no body (the design spec flags
 * "optional freeform notes" as non-injected; MVP skips them entirely).
 *
 * The `type` key is always `'agent-definition'` — the same string the
 * brain-doc save path mirrors into the denormalised `documents.type`
 * column via `extractDocumentTypeFromContent`.
 */
export function buildAgentDefinitionDoc(
  input: AgentWizardInput,
): BuiltAgentDoc {
  const frontmatter: Record<string, unknown> = {
    type: 'agent-definition',
    title: input.title,
    slug: input.slug,
    model: input.model,
    tool_allowlist: input.toolAllowlist ?? null,
    baseline_docs: input.baselineDocIds,
    skills: input.skillIds,
    system_prompt_snippet: input.systemPromptSnippet,
  };
  const yamlStr = yaml.dump(frontmatter, { lineWidth: 120 }).trimEnd();
  const content = `---\n${yamlStr}\n---\n`;
  return { frontmatter, content };
}
