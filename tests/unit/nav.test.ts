import { describe, expect, it } from 'vitest';
import { NavGrid } from '../../src/sim/nav/navGrid';
import type { HeightField } from '../../src/sim/terrain';
import { DesertTerrain } from '../../src/sim/terrain';

/** Flat field with a 60 m tall square plateau in the middle. */
const plateau: HeightField = {
  cell: 6,
  halfSize: 1000,
  rawHeight: (x, z) => (Math.abs(x) < 100 && Math.abs(z) < 100 ? 60 : 0),
  heightAt: (x, z) => (Math.abs(x) < 100 && Math.abs(z) < 100 ? 60 : 0),
};

describe('NavGrid', () => {
  const nav = new NavGrid(plateau, 400);

  it('routes around an impassable plateau', () => {
    const from = { x: 0, z: 250 };
    const to = { x: 0, z: -250 };
    expect(nav.clearLine(from, to, 0.7)).toBe(false);
    const path = nav.findPath(from, to, 0.7);
    expect(path.length).toBeGreaterThan(1);
    expect(path.at(-1)).toEqual(to);
    // Every leg of the smoothed path is walkable.
    let prev = from;
    for (const p of path) {
      expect(nav.clearLine(prev, p, 0.7)).toBe(true);
      prev = p;
    }
  });

  it('goes straight when the way is clear', () => {
    const path = nav.findPath({ x: -300, z: 300 }, { x: 300, z: 300 }, 0.7);
    expect(path).toEqual([{ x: 300, z: 300 }]);
  });

  it('builds the desert grid quickly and finds cross-basin routes', () => {
    const t0 = performance.now();
    const terrain = new DesertTerrain({ seed: 1 });
    const grid = new NavGrid(terrain, terrain.basinRadius + 350);
    expect(performance.now() - t0).toBeLessThan(1500);
    const t1 = performance.now();
    const path = grid.findPath({ x: -700, z: 200 }, { x: 650, z: -300 }, 0.72);
    expect(performance.now() - t1).toBeLessThan(150);
    expect(path.length).toBeGreaterThan(0);
  });
});
