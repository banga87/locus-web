// Deterministic per-agent colors.
//
// Distinct from --accent / --accent-2 (reserved for brand/UI chrome, not
// data encoding). Hand-tuned hex values over the --paper-2 dark canvas.

export const AGENT_PALETTE: ReadonlyArray<{ css: string; canvas: string }> = [
  { css: 'var(--agent-1, #7aa7ff)', canvas: '#7aa7ff' },
  { css: 'var(--agent-2, #f6a06a)', canvas: '#f6a06a' },
  { css: 'var(--agent-3, #8fd694)', canvas: '#8fd694' },
  { css: 'var(--agent-4, #e28ac7)', canvas: '#e28ac7' },
  { css: 'var(--agent-5, #f0d070)', canvas: '#f0d070' },
  { css: 'var(--agent-6, #9ecdd2)', canvas: '#9ecdd2' },
];

const UNKNOWN_COLOR = { css: 'var(--ink-muted, #8a8a8a)', canvas: '#8a8a8a' };

// FNV-1a 32-bit: stable bucket index, no crypto dep, good distribution.
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function resolveAgentColor(actorId: string | null | undefined): { css: string; canvas: string } {
  if (!actorId || actorId === 'unknown') return UNKNOWN_COLOR;
  const idx = hash32(actorId) % AGENT_PALETTE.length;
  return AGENT_PALETTE[idx];
}
