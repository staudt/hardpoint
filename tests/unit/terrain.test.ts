import { describe, expect, it } from 'vitest';
import { DesertTerrain, cellFlipped, plateaus, triangleHeight } from '../../src/sim/terrain';
import { Rng } from '../../src/sim/rng';

/** Reference: barycentric interpolation over the exact triangles the mesh builder emits. */
function meshHeight(h: [number, number, number, number], fx: number, fz: number, flipped: boolean): number {
  const [h00, h10, h01, h11] = h;
  const P = { a: [0, 0, h00], b: [1, 0, h10], c: [0, 1, h01], d: [1, 1, h11] } as const;
  const tris = flipped
    ? [[P.a, P.b, P.c], [P.d, P.c, P.b]]
    : [[P.a, P.b, P.d], [P.a, P.d, P.c]];
  for (const [p, q, r] of tris) {
    const det = (q[1] - r[1]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[1] - r[1]);
    const l1 = ((q[1] - r[1]) * (fx - r[0]) + (r[0] - q[0]) * (fz - r[1])) / det;
    const l2 = ((r[1] - p[1]) * (fx - r[0]) + (p[0] - r[0]) * (fz - r[1])) / det;
    const l3 = 1 - l1 - l2;
    if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) return l1 * p[2] + l2 * q[2] + l3 * r[2];
  }
  throw new Error('point outside cell');
}

describe('triangleHeight', () => {
  it('matches mesh triangulation for both diagonals', () => {
    const rng = new Rng(3);
    for (let k = 0; k < 2000; k++) {
      const h: [number, number, number, number] = [rng.range(-20, 20), rng.range(-20, 20), rng.range(-20, 20), rng.range(-20, 20)];
      const fx = rng.next();
      const fz = rng.next();
      for (const flipped of [false, true]) {
        expect(triangleHeight(...h, fx, fz, flipped)).toBeCloseTo(meshHeight(h, fx, fz, flipped), 6);
      }
    }
  });

  it('alternates diagonals in a checkerboard', () => {
    expect(cellFlipped(0, 0)).toBe(false);
    expect(cellFlipped(1, 0)).toBe(true);
    expect(cellFlipped(-1, 0)).toBe(true);
    expect(cellFlipped(-1, -1)).toBe(false);
  });
});

describe('plateaus', () => {
  it('is flat between thresholds and monotonic', () => {
    const levels = [[0.2, 0.05, 0.5], [0.6, 0.05, 0.5]] as const;
    expect(plateaus(0.1, levels)).toBe(0);
    expect(plateaus(0.3, levels)).toBeCloseTo(0.5);
    expect(plateaus(0.5, levels)).toBeCloseTo(0.5);
    expect(plateaus(0.9, levels)).toBeCloseTo(1);
    let prev = -1;
    for (let v = 0; v <= 1; v += 0.01) {
      const p = plateaus(v, levels);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
});

describe('DesertTerrain', () => {
  const t = new DesertTerrain({ seed: 1 });

  it('is deterministic per seed and varies across seeds', () => {
    const t2 = new DesertTerrain({ seed: 1 });
    const t3 = new DesertTerrain({ seed: 2 });
    expect(t.rawHeight(123.4, -567.8)).toBe(t2.rawHeight(123.4, -567.8));
    expect(t.rawHeight(123.4, -567.8)).not.toBe(t3.rawHeight(123.4, -567.8));
  });

  it('heightAt equals rawHeight on grid vertices', () => {
    for (const [i, j] of [[0, 0], [5, -3], [-40, 17], [100, 100]] as const) {
      expect(t.heightAt(i * t.cell, j * t.cell)).toBeCloseTo(t.rawHeight(i * t.cell, j * t.cell), 5);
    }
  });

  it('heightAt is continuous across cell edges', () => {
    const rng = new Rng(11);
    for (let k = 0; k < 300; k++) {
      const x = Math.round(rng.range(-900, 900) / t.cell) * t.cell;
      const z = rng.range(-900, 900);
      expect(Math.abs(t.heightAt(x - 1e-6, z) - t.heightAt(x + 1e-6, z))).toBeLessThan(1e-3);
    }
  });

  it('keeps the spawn area open and gentle', () => {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      for (const r of [0, 40, 80]) {
        expect(Math.abs(t.heightAt(Math.cos(a) * r, Math.sin(a) * r))).toBeLessThan(18);
        expect(t.flatness(Math.cos(a) * r, Math.sin(a) * r)).toBeGreaterThan(0.85);
      }
    }
  });

  it('rises into canyon walls beyond the basin', () => {
    const edge = t.basinRadius + 600;
    let high = 0;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) if (t.rawHeight(Math.cos(a) * edge, Math.sin(a) * edge) > 100) high++;
    expect(high).toBeGreaterThan(26); // most of the ring (32 samples)
  });
});
