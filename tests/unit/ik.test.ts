import { describe, expect, it } from 'vitest';
import { chainEnd, solveTwoBone } from '../../src/core/ik';
import { Rng } from '../../src/sim/rng';

describe('solveTwoBone', () => {
  it('reaches reachable targets exactly', () => {
    const rng = new Rng(1);
    for (let i = 0; i < 1000; i++) {
      const a = rng.range(1, 4);
      const b = rng.range(1, 4);
      const r = rng.range(Math.abs(a - b) + 0.1, a + b - 0.1);
      const ang = rng.range(-1.2, 1.2);
      const f = Math.sin(ang) * r;
      const d = Math.cos(ang) * r;
      const s = solveTwoBone(f, d, a, b);
      expect(s.reached).toBe(true);
      const end = chainEnd(s.upper, s.lower, a, b);
      expect(end.f).toBeCloseTo(f, 6);
      expect(end.d).toBeCloseTo(d, 6);
    }
  });

  it('bends the knee forward', () => {
    const s = solveTwoBone(0, 5, 3, 3);
    expect(s.upper).toBeGreaterThan(0); // thigh swings forward
    expect(s.lower).toBeLessThan(0); // shin swings back
    const kneeF = Math.sin(s.upper) * 3;
    expect(kneeF).toBeGreaterThan(0);
  });

  it('stretches toward unreachable targets', () => {
    const s = solveTwoBone(0, 10, 3, 3);
    expect(s.reached).toBe(false);
    // Nearly straight (a tiny bend is kept to avoid the singular pose).
    expect(Math.abs(s.upper)).toBeLessThan(0.05);
    expect(Math.abs(s.lower)).toBeLessThan(0.05);
  });
});
