// Shared skill types used by the API route and UI components.

export type SkillOrigin =
  | { kind: 'installed'; owner: string; repo: string; skill: string | null }
  | { kind: 'forked'; from: string }
  | { kind: 'authored' };
