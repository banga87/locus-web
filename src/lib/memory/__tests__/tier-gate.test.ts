import { describe, it, expect } from 'vitest';
import { assertTierAllowed } from '../core';

describe('tier ceiling enforcement', () => {
  it('throws when a strict-role context requests inferred tier', () => {
    expect(() =>
      assertTierAllowed({ role: 'customer_facing' }, 'inferred'),
    ).toThrow(/tier/i);
  });

  it('allows research_subagent role to request inferred', () => {
    expect(() =>
      assertTierAllowed({ role: 'research_subagent' }, 'inferred'),
    ).not.toThrow();
  });

  it('allows strict roles to request authored or extracted', () => {
    expect(() =>
      assertTierAllowed({ role: 'customer_facing' }, 'extracted'),
    ).not.toThrow();
    expect(() =>
      assertTierAllowed({ role: 'customer_facing' }, 'authored'),
    ).not.toThrow();
  });
});
