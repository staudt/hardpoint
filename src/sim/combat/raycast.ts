import type { HitLocation } from '../../data/chassis';
import type { HeightField } from '../terrain';
import type { Vec3 } from '../vec';

/** Ray vs axis-aligned box (centre c, half-extents h). Returns entry distance in [0, maxT] or null. */
export function rayBox(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  c: readonly [number, number, number], h: readonly [number, number, number], maxT: number,
): number | null {
  let tmin = 0;
  let tmax = maxT;
  const o = [ox - c[0], oy - c[1], oz - c[2]];
  const d = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    const oi = o[i]!;
    const di = d[i]!;
    const hi = h[i]!;
    if (Math.abs(di) < 1e-12) {
      if (oi < -hi || oi > hi) return null;
      continue;
    }
    let t1 = (-hi - oi) / di;
    let t2 = (hi - oi) / di;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin;
}

/** Anything with a position, headings and hit boxes (a Mech satisfies this). */
export interface Hittable {
  readonly id: number;
  readonly state: { x: number; y: number; z: number; legYaw: number; torsoYaw: number };
  readonly def: { hitBoxes: readonly { loc: HitLocation; frame: 'torso' | 'legs'; c: readonly [number, number, number]; h: readonly [number, number, number] }[] };
}

export interface MechHit {
  t: number;
  loc: HitLocation;
}

/** Ray vs a mech's hit boxes (each box in its frame: legs or torso yaw). Nearest hit within maxT. */
export function rayMech(m: Hittable, o: Vec3, d: Vec3, maxT: number): MechHit | null {
  const s = m.state;
  // Cheap bounding-sphere reject (mechs are < 16 m across).
  const px = o.x - s.x;
  const py = o.y - (s.y + 6);
  const pz = o.z - s.z;
  const b = px * d.x + py * d.y + pz * d.z;
  const cc = px * px + py * py + pz * pz - 100;
  if (cc > 0 && (b > 0 || b * b - cc < 0)) return null;

  let best: MechHit | null = null;
  for (const frame of ['torso', 'legs'] as const) {
    const yaw = frame === 'torso' ? s.torsoYaw : s.legYaw;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    // World → local: translate, then rotate by −yaw.
    const lx = px * cos - pz * sin;
    const lz = px * sin + pz * cos;
    const ldx = d.x * cos - d.z * sin;
    const ldz = d.x * sin + d.z * cos;
    for (const box of m.def.hitBoxes) {
      if (box.frame !== frame) continue;
      const t = rayBox(lx, o.y - s.y, lz, ldx, d.y, ldz, box.c, box.h, best ? best.t : maxT);
      if (t !== null && (!best || t < best.t)) best = { t, loc: box.loc };
    }
  }
  return best;
}

/** March a ray over the height field; returns the first ground intersection distance or null. */
export function raycastTerrain(terrain: HeightField, o: Vec3, d: Vec3, maxT: number, step = 4): number | null {
  let prevT = 0;
  if (o.y < terrain.heightAt(o.x, o.z)) return 0;
  for (let t = step; t <= maxT + step; t += step) {
    const tt = Math.min(t, maxT);
    const above = o.y + d.y * tt - terrain.heightAt(o.x + d.x * tt, o.z + d.z * tt);
    if (above < 0) {
      // Bisect between prevT and tt.
      let lo = prevT;
      let hi = tt;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        const a = o.y + d.y * mid - terrain.heightAt(o.x + d.x * mid, o.z + d.z * mid);
        if (a < 0) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    prevT = tt;
    if (tt === maxT) break;
  }
  return null;
}
