// Deterministic per-agent colors — hand-tuned glow palette against the
// neurons `--void` canvas (#0a0b10). All ≥4.5:1 contrast, chosen to sit
// well under additive blending for pulse overlays.

export const AGENT_PALETTE: ReadonlyArray<{ css: string; canvas: string }> = [
  { css: 'var(--agent-1, #7aa7ff)', canvas: '#7aa7ff' }, // azure
  { css: 'var(--agent-2, #ff6ba1)', canvas: '#ff6ba1' }, // magenta
  { css: 'var(--agent-3, #ffc857)', canvas: '#ffc857' }, // amber
  { css: 'var(--agent-4, #5ef0c8)', canvas: '#5ef0c8' }, // mint
  { css: 'var(--agent-5, #c490ff)', canvas: '#c490ff' }, // lavender
  { css: 'var(--agent-6, #ff8a5a)', canvas: '#ff8a5a' }, // ember
];

const UNKNOWN_COLOR = { css: 'var(--neurons-text-dim, #76725f)', canvas: '#8a8574' };

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
