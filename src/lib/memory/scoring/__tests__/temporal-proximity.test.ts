import { describe, it, expect } from 'vitest';
import { temporalProximity } from '../temporal-proximity';

describe('temporalProximity', () => {
  it('returns 1.0 when query has no date', () => {
    expect(temporalProximity('plain query', new Date('2026-04-22'))).toBe(1.0);
  });

  it('returns max boost 1.4 when query date matches doc updated_at exactly', () => {
    const d = new Date('2026-04-22');
    expect(temporalProximity('updated on 2026-04-22', d)).toBeCloseTo(1.4);
  });

  it('decays with distance', () => {
    const d = new Date('2026-04-22');
    const boost30 = temporalProximity('updated on 2026-03-23', d);
    const boost365 = temporalProximity('updated on 2025-04-22', d);
    expect(boost30).toBeLessThan(1.4);
    expect(boost30).toBeGreaterThan(1.0);
    expect(boost365).toBeLessThan(boost30);
    expect(boost365).toBeGreaterThanOrEqual(1.0);
  });

  it('returns 1.0 when query date is invalid', () => {
    expect(temporalProximity('not a date', new Date())).toBe(1.0);
  });
});
