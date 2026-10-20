import { Simplex2, smoothstep } from './noise';
import { hash2 } from './rng';

/** Height queries shared by sim (movement, AI, ballistics) and render (meshes). */
export interface HeightField {
  /** Size of one base grid cell (m). The LOD0 terrain mesh uses exactly this grid. */
  readonly cell: number;
  /** The field spans [-halfSize, halfSize] on X and Z. */
  readonly halfSize: number;
  /** Analytic height (m) — used to build meshes. */
  rawHeight(x: number, z: number): number;
  /** Height on the triangulated base grid — matches the LOD0 mesh exactly. Use for gameplay. */
  heightAt(x: number, z: number): number;
}

/** Diagonal used for grid cell (i, j). Shared by mesh builders so triangles match `heightAt`. */
export function cellFlipped(i: number, j: number): boolean {
  return ((i + j) & 1) === 1;
}

/**
 * Height inside one grid cell from its corner heights, using the same split
 * as the mesh. fx, fz ∈ [0,1]. Corners: h00=(i,j) h10=(i+1,j) h01=(i,j+1) h11=(i+1,j+1).
 */
export function triangleHeight(
  h00: number, h10: number, h01: number, h11: number,
  fx: number, fz: number, flipped: boolean,
): number {
  if (!flipped) {
    // Diagonal (0,0)–(1,1)
    return fx >= fz ? h00 + (h10 - h00) * fx + (h11 - h10) * fz : h00 + (h11 - h01) * fx + (h01 - h00) * fz;
  }
  // Diagonal (1,0)–(0,1)
  return fx + fz <= 1 ? h00 + (h10 - h00) * fx + (h01 - h00) * fz : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
}

/** Discrete plateau levels: [threshold, riser width, height share]. Shares sum to 1. */
type Levels = readonly (readonly [number, number, number])[];
const MESA_LEVELS: Levels = [[0.27, 0.03, 0.45], [0.41, 0.03, 0.33], [0.54, 0.03, 0.22]];
// Wall risers are wider than mesa risers so coarse distant LODs don't alias into spikes.
const WALL_LEVELS: Levels = [[0.04, 0.11, 0.25], [0.3, 0.1, 0.3], [0.55, 0.1, 0.25], [0.8, 0.09, 0.2]];

/** Sum of steep steps — flat tops wherever the input sits between thresholds. */
export function plateaus(v: number, levels: Levels): number {
  let h = 0;
  for (const [t, w, share] of levels) h += share * smoothstep(t, t + w, v);
  return h;
}

export interface DesertOptions {
  seed: number;
  cell?: number;
  chunkCells?: number;
  chunksPerSide?: number;
  /** Radius of the open basin floor before the canyon walls rise (m). */
  basinRadius?: number;
  /** Radius around spawn kept clear of buttes (m). */
  spawnClear?: number;
}

/**
 * Desert canyon basin: sandy floor with dunes and dry washes, stacked-plateau buttes,
 * and a ring of tall stepped canyon walls bounding the battlefield.
 */
export class DesertTerrain implements HeightField {
  readonly cell: number;
  readonly chunkCells: number;
  readonly chunksPerSide: number;
  readonly halfSize: number;
  readonly basinRadius: number;
  readonly spawnClear: number;
  readonly seed: number;
  private readonly n1: Simplex2;
  private readonly n2: Simplex2;

  constructor(opts: DesertOptions) {
    this.seed = opts.seed;
    this.cell = opts.cell ?? 6;
    this.chunkCells = opts.chunkCells ?? 32;
    this.chunksPerSide = opts.chunksPerSide ?? 22;
    this.halfSize = (this.cell * this.chunkCells * this.chunksPerSide) / 2;
    this.basinRadius = opts.basinRadius ?? 1050;
    this.spawnClear = opts.spawnClear ?? 200;
    this.n1 = new Simplex2(hash2(opts.seed, 1));
    this.n2 = new Simplex2(hash2(opts.seed, 2));
  }

  rawHeight(x: number, z: number): number {
    const { n1, n2 } = this;
    const r = Math.hypot(x, z);

    // Gentle rolling floor with some mid-scale undulation.
    let h = n1.fbm(x / 650, z / 650, 4) * 9 + n2.noise(x / 140, z / 140) * 1.6;

    // Dunes: warped directional ridges, only in some regions.
    const duneMask = smoothstep(0.05, 0.45, n2.fbm(x / 800 + 31.7, z / 800 - 17.3, 2));
    if (duneMask > 0) {
      const phase = (x * 0.8 + z * 0.6) / 48 + n1.noise(x / 260, z / 260) * 2.2;
      const dune = Math.pow(1 - Math.abs(Math.sin(phase)), 1.6);
      h += dune * 4.5 * duneMask;
    }

    // Dry washes: shallow carved channels.
    const wash = n2.ridged(x / 520 + 11.1, z / 520 + 5.3, 3);
    h -= smoothstep(0.82, 0.96, wash) * 3.5;

    // Buttes / mesas: stacked flat plateaus joined by near-vertical risers.
    const clear = smoothstep(this.spawnClear * 0.6, this.spawnClear, r);
    const m = n2.fbm(x / 420, z / 420, 3) + 0.16 * n1.noise(x / 70, z / 70);
    if (m > 0.25 && clear > 0) {
      const top = 55 + 45 * (0.5 + 0.5 * n1.noise(x / 1100 + 7, z / 1100 - 3));
      h += clear * top * plateaus(m, MESA_LEVELS);
    }

    // Canyon walls ringing the basin: ragged outline, flat stepped tops.
    const wallT = (r + n1.fbm(x / 340, z / 340, 2) * 220 - this.basinRadius) / 420;
    if (wallT > 0) {
      h = Math.max(h, 0) + 230 * plateaus(wallT, WALL_LEVELS) + smoothstep(0, 0.2, wallT) * n2.noise(x / 90, z / 90) * 3;
    }
    return h;
  }

  heightAt(x: number, z: number): number {
    const c = this.cell;
    const gx = x / c;
    const gz = z / c;
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const x0 = i * c;
    const z0 = j * c;
    return triangleHeight(
      this.rawHeight(x0, z0),
      this.rawHeight(x0 + c, z0),
      this.rawHeight(x0, z0 + c),
      this.rawHeight(x0 + c, z0 + c),
      fx, fz, cellFlipped(i, j),
    );
  }

  /** Approximate surface normal's Y component (1 = flat) via finite differences. */
  flatness(x: number, z: number, eps = 3): number {
    const dx = this.heightAt(x + eps, z) - this.heightAt(x - eps, z);
    const dz = this.heightAt(x, z + eps) - this.heightAt(x, z - eps);
    return (2 * eps) / Math.hypot(dx, 2 * eps, dz);
  }
}
