// Deterministic per-agent colors — brass/ember family glow palette, tuned for
// warm-on-void contrast against the neurons `--void` canvas (#0a0b10). Chosen
// to sit well under additive blending for pulse overlays.

export const AGENT_PALETTE: ReadonlyArray<{ css: string; canvas: string }> = [
  { css: 'var(--agent-1, #D7B96E)', canvas: '#D7B96E' }, // brass-soft
  { css: 'var(--agent-2, #E8813A)', canvas: '#E8813A' }, // ember-warm
  { css: 'var(--agent-3, #D4A660)', canvas: '#D4A660' }, // honey-gold
  { css: 'var(--agent-4, #F2A870)', canvas: '#F2A870' }, // ember-glow
  { css: 'var(--agent-5, #B8863A)', canvas: '#B8863A' }, // brass
  { css: 'var(--agent-6, #8B6425)', canvas: '#8B6425' }, // brass-deep
];

const UNKNOWN_COLOR = { css: 'var(--neurons-text-dim, rgba(242, 234, 216, 0.4))', canvas: '#8a8574' };

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
