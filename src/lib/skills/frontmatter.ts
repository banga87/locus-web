// Shared frontmatter parsing helpers for skill documents.
//
// Used by both the GET /api/skills route and the /skills page (Server Component).

import yaml from 'js-yaml';
import type { SkillOrigin } from './types';

export function extractYamlFrontmatter(content: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match || !match[1]) return {};
  try {
    const parsed = yaml.load(match[1]);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed frontmatter — treat as no frontmatter.
  }
  return {};
}

export function parseOrigin(content: string): SkillOrigin {
  const fm = extractYamlFrontmatter(content);
  const source = fm['source'];

  if (source && typeof source === 'object') {
    const src = source as Record<string, unknown>;

    // Forked origin check first (Task 24 will write this field).
    if (src['forked_from'] && typeof src['forked_from'] === 'string') {
      return { kind: 'forked', from: src['forked_from'] };
    }

    // Installed from GitHub.
    const github = src['github'];
    if (github && typeof github === 'object') {
      const gh = github as Record<string, unknown>;
      const owner = typeof gh['owner'] === 'string' ? gh['owner'] : '';
      const repo = typeof gh['repo'] === 'string' ? gh['repo'] : '';
      const skill = typeof gh['skill'] === 'string' ? gh['skill'] : null;
      if (owner && repo) {
        return { kind: 'installed', owner, repo, skill };
      }
    }
  }

  return { kind: 'authored' };
}

export function parseSkillsFromAgentContent(content: string): string[] {
  const fm = extractYamlFrontmatter(content);
  const skills = fm['skills'];
  if (Array.isArray(skills)) {
    return skills.filter((s): s is string => typeof s === 'string');
  }
  return [];
}
