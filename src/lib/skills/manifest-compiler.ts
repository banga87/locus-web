// Skill manifest compiler — pure function from skill-doc inputs to the
// per-company manifest cached in `skill_manifests.manifest`.
//
// Authoritative storage for skills is the `documents` rows where
// `type = 'skill'`. Re-parsing every skill doc's YAML on every chat turn
// would be wasteful, so we compile once into a small per-company JSON
// blob; the matcher reads that blob and only loads body content for
// skills that actually match the user prompt.
//
// Inputs:
//   - id, companyId, title, content (the doc's full Markdown including
//     the `---` frontmatter block).
// Outputs:
//   - manifest with version, builtAt, skills[], diagnostics[].
//   - skills: matcher-ready entries with id/slug/title/description/
//     priority/triggers/bodyDocId/bodyBytes.
//   - diagnostics: one per doc that failed to parse or lacked a usable
//     `triggers` block. Lets the dashboard surface ingestion problems
//     without breaking the manifest write — a bad skill never breaks a
//     good one's discoverability.
//
// This module is intentionally pure (no DB, no network). The DB-backed
// rebuild + cache is in `./loader.ts`.

import yaml from 'js-yaml';

export interface SkillDocInput {
  id: string;
  companyId: string;
  title: string;
  content: string;
}

export interface SkillTriggers {
  phrases: string[];
  allOf: string[][];
  anyOf: string[];
  minScore: number;
}

export interface ManifestSkill {
  id: string;
  slug: string;
  title: string;
  description: string;
  priority: number;
  triggers: SkillTriggers;
  bodyDocId: string;
  bodyBytes: number;
}

export interface CompileDiagnostic {
  docId: string;
  reason: string;
}

export interface SkillManifest {
  version: 1;
  builtAt: string;
  skills: ManifestSkill[];
  diagnostics: CompileDiagnostic[];
}

/**
 * Pull the YAML frontmatter block off a Markdown document.
 *
 * Returns null when the input has no `---\n...\n---` preamble or the
 * YAML inside fails to parse. The matched body is everything after the
 * closing `---` marker.
 */
function parseFrontmatter(
  md: string,
): { fm: Record<string, unknown>; body: string } | null {
  const match = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  try {
    const fm = yaml.load(match[1]) as Record<string, unknown> | null;
    if (!fm || typeof fm !== 'object') return null;
    return { fm, body: match[2] };
  } catch {
    return null;
  }
}

/**
 * Compile a list of skill-doc inputs into a per-company manifest.
 *
 * Docs that fail to parse, or whose frontmatter has no usable `triggers`
 * block, are appended to `diagnostics` and skipped — they do not appear
 * in `skills`. The manifest write itself never throws on a single bad
 * doc; one broken skill never hides the rest.
 */
export function compileSkillDocs(docs: SkillDocInput[]): SkillManifest {
  const skills: ManifestSkill[] = [];
  const diagnostics: CompileDiagnostic[] = [];

  for (const doc of docs) {
    const parsed = parseFrontmatter(doc.content);
    if (!parsed) {
      diagnostics.push({
        docId: doc.id,
        reason: 'missing or invalid frontmatter',
      });
      continue;
    }
    const fm = parsed.fm;
    const triggers = fm.triggers as Partial<SkillTriggers> | undefined;
    if (
      !triggers ||
      (!triggers.phrases && !triggers.allOf && !triggers.anyOf)
    ) {
      diagnostics.push({
        docId: doc.id,
        reason: 'skill missing triggers block',
      });
      continue;
    }

    skills.push({
      id: doc.id,
      slug: typeof fm.slug === 'string' ? fm.slug : doc.id,
      title: typeof fm.title === 'string' ? fm.title : doc.title,
      description: typeof fm.description === 'string' ? fm.description : '',
      priority: typeof fm.priority === 'number' ? fm.priority : 5,
      triggers: {
        phrases: triggers.phrases ?? [],
        allOf: triggers.allOf ?? [],
        anyOf: triggers.anyOf ?? [],
        minScore: typeof triggers.minScore === 'number' ? triggers.minScore : 1,
      },
      bodyDocId: doc.id,
      bodyBytes: Buffer.byteLength(parsed.body, 'utf8'),
    });
  }

  return {
    version: 1,
    builtAt: new Date().toISOString(),
    skills,
    diagnostics,
  };
}
