// Skill matcher — pure function from (manifest, prompt) to scored matches.
//
// The agent's UserPromptSubmit hook calls this on every chat turn to
// decide which skill bodies to inline as additional system context.
// Both manifest and prompt arrive already-loaded; this module never
// touches the database.
//
// Scoring (claude-code's reference scorer adapted for our triggers shape):
//   - Each phrase hit:           +2  (phrases are weighted higher)
//   - Each allOf group with hit: +1  (any term in the group counts once)
//   - Each anyOf hit:            +1
//   Skills whose total score is below `triggers.minScore` are dropped.
//   Survivors sort by score desc, then by `priority` desc as the tie-break.
//
// Why phrases get 2x: phrases are user-authored exact text — they were
// chosen specifically because they signal the skill. Single tokens in
// allOf/anyOf are noisier, so they're worth less per hit.
//
// `MatchOptions.candidateIds` lets the caller pre-filter the pool to a
// specific subset (e.g., agent-allowlisted skills). When unset, the
// entire manifest is scored.

import type { ManifestSkill, SkillManifest } from './manifest-compiler';

export interface SkillMatch {
  id: string;
  skill: ManifestSkill;
  score: number;
}

export interface MatchOptions {
  /** If set, only skills with id in this list are considered. */
  candidateIds?: string[];
}

function countMatches(haystackLower: string, terms: string[]): number {
  let hits = 0;
  for (const t of terms) {
    if (haystackLower.includes(t.toLowerCase())) hits++;
  }
  return hits;
}

function scoreSkill(skill: ManifestSkill, promptLower: string): number {
  const phraseHits = countMatches(promptLower, skill.triggers.phrases) * 2;
  let allOfHits = 0;
  for (const group of skill.triggers.allOf) {
    if (group.some((term) => promptLower.includes(term.toLowerCase()))) {
      allOfHits++;
    }
  }
  const anyOfHits = countMatches(promptLower, skill.triggers.anyOf);
  const total = phraseHits + allOfHits + anyOfHits;
  return total >= skill.triggers.minScore ? total : 0;
}

export function matchSkills(
  manifest: SkillManifest,
  prompt: string,
  options: MatchOptions = {},
): SkillMatch[] {
  const promptLower = prompt.toLowerCase();
  const pool = options.candidateIds
    ? manifest.skills.filter((s) => options.candidateIds!.includes(s.id))
    : manifest.skills;

  const matches: SkillMatch[] = [];
  for (const skill of pool) {
    const score = scoreSkill(skill, promptLower);
    if (score > 0) matches.push({ id: skill.id, skill, score });
  }

  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.skill.priority - a.skill.priority;
  });

  return matches;
}
