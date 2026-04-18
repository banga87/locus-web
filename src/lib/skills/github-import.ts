export interface ParsedSkillUrl {
  owner: string;
  repo: string;
  skillName: string | null;
}

export function parseSkillUrl(url: string, explicitSkillName?: string): ParsedSkillUrl {
  const u = new URL(url);
  if (u.hostname === 'skills.sh') {
    const m = u.pathname.match(/^\/([^/]+)\/skills\/([^/]+)\/?$/);
    if (!m) throw new Error(`unrecognised URL: ${url}`);
    return { owner: m[1], repo: 'skills', skillName: m[2] };
    // NOTE: skills.sh always points at the 'skills' repo by convention.
  }
  if (u.hostname === 'github.com') {
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
    if (!m) throw new Error(`unrecognised URL: ${url}`);
    return { owner: m[1], repo: m[2], skillName: explicitSkillName ?? null };
  }
  throw new Error(`unrecognised URL: ${url}`);
}
