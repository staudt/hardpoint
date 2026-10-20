import { describe, expect, it } from 'vitest';
import { Gait } from '../../src/render/mechs/gait';
import type { GaitTuning } from '../../src/render/mechs/rig';

const TUNE: GaitTuning = { spread: 2, forward: 0.3, reach: 3.3, stepHeight: 1, minStepTime: 0.36, maxStepTime: 0.72, bob: 0.3, sway: 0.03 };
const flat = (): number => 0;
const DT = 1 / 60;

/** Walk straight along −Z at `speed` for `seconds`, calling `each` after every frame. */
function walk(g: Gait, speed: number, seconds: number, each?: (z: number) => void, z0 = 0): number {
  let z = z0;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    z -= speed * DT;
    g.update(DT, 0, z, 0, 0, -speed, 18, flat);
    each?.(z);
  }
  return z;
}

describe('Gait', () => {
  it('planted feet never slide', () => {
    const g = new Gait(TUNE);
    const z0 = walk(g, 17, 2); // reach steady state
    const prev = g.feet.map((f) => ({ planted: f.t < 0, x: f.pos.x, z: f.pos.z }));
    walk(g, 17, 3, () => {
      g.feet.forEach((f, i) => {
        const p = prev[i]!;
        if (p.planted && f.t < 0) {
          expect(Math.abs(f.pos.x - p.x)).toBeLessThan(1e-9);
          expect(Math.abs(f.pos.z - p.z)).toBeLessThan(1e-9);
        }
        prev[i] = { planted: f.t < 0, x: f.pos.x, z: f.pos.z };
      });
    }, z0);
  });

  it('alternates feet and keeps them within reach of the body', () => {
    const g = new Gait(TUNE);
    const order: number[] = [];
    g.onFootfall = (i) => order.push(i);
    const z0 = walk(g, 17, 1);
    walk(g, 17, 4, (z) => {
      for (const f of g.feet) expect(Math.abs(f.pos.z - (z - TUNE.forward))).toBeLessThan(TUNE.reach * 1.25);
    }, z0);
    expect(order.length).toBeGreaterThan(8);
    for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1]);
  });

  it('settles to a neutral stance when stopped', () => {
    const g = new Gait(TUNE);
    const z = walk(g, 10, 2);
    walk(g, 0, 3, undefined, z);
    expect(g.feet.every((f) => f.t < 0)).toBe(true);
    const [l, r] = g.feet;
    expect(l.pos.x).toBeCloseTo(-TUNE.spread, 1);
    expect(r.pos.x).toBeCloseTo(TUNE.spread, 1);
    expect(Math.abs(l.pos.z - r.pos.z)).toBeLessThan(0.8);
  });
});
