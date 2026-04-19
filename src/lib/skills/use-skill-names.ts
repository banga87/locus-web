// Client-side SWR hook that resolves skill ids → display names.
//
// The skills index page already hits /api/skills, so SWR de-dupes the
// request — no extra network call is made when both pages are mounted.
//
// Returns a stable `Map<id, name>` that is empty while loading and
// populated once the fetch resolves. Components that consume this hook
// should gracefully fall back when the map is empty (e.g. show the
// truncated id instead of the name).

'use client';

import useSWR from 'swr';

interface SkillListItem {
  id: string;
  title: string;
}

// /api/skills returns the standard envelope: { success: true, data: { skills: [...] } }
interface SkillsApiEnvelope {
  success: boolean;
  data?: { skills: SkillListItem[] };
}

async function fetchSkillNames(url: string): Promise<Map<string, string>> {
  const res = await fetch(url);
  if (!res.ok) return new Map();
  const envelope = (await res.json()) as SkillsApiEnvelope;
  const skills = envelope.data?.skills;
  if (!Array.isArray(skills)) return new Map();
  return new Map(skills.map((s) => [s.id, s.title]));
}

/**
 * Returns a `Map<skill_id, title>` populated from `/api/skills`.
 * Returns an empty map while loading or on error — callers should
 * fall back to the truncated id in those cases.
 */
export function useSkillNames(): Map<string, string> {
  const { data } = useSWR<Map<string, string>>('/api/skills', fetchSkillNames, {
    // Refresh every 60s — skill names rarely change and we don't need
    // instant consistency for display labels.
    refreshInterval: 60_000,
    // Keep showing the previous data while revalidating.
    keepPreviousData: true,
  });
  return data ?? new Map();
}
