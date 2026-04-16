import { describe, expect, it } from 'vitest';
import { resolveAgentColor, AGENT_PALETTE } from '../agent-palette';

describe('resolveAgentColor', () => {
  it('returns the same color for the same actor id across calls', () => {
    const a = resolveAgentColor('agent-marketing');
    const b = resolveAgentColor('agent-marketing');
    expect(a).toEqual(b);
  });

  it('returns a color from AGENT_PALETTE', () => {
    const c = resolveAgentColor('agent-support');
    expect(AGENT_PALETTE.map((p) => p.css)).toContain(c.css);
  });

  it('distributes across the palette for many distinct ids', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `agent-${i}`);
    const colors = new Set(ids.map((id) => resolveAgentColor(id).css));
    expect(colors.size).toBeGreaterThanOrEqual(Math.min(6, AGENT_PALETTE.length));
  });

  it('returns a stable color for the unknown-agent sentinel id', () => {
    const a = resolveAgentColor('unknown');
    const b = resolveAgentColor('unknown');
    expect(a).toEqual(b);
  });
});
