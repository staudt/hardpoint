import type { HeightField } from '../terrain';

export interface NavPoint {
  x: number;
  z: number;
}

const SQRT2 = Math.SQRT2;
const NEIGHBORS: readonly [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

/**
 * Coarse navigation grid over the height field: per-cell steepness, computed
 * once. A* finds paths for any unit given its climbable grade; paths are
 * string-pulled into straight walkable segments. Deterministic.
 */
export class NavGrid {
  readonly size: number;
  readonly origin: number;
  /** Max grade (rise/run) across each cell; Infinity = off-map. */
  readonly grade: Float32Array;
  // A* scratch buffers (reused between searches).
  private readonly gScore: Float32Array;
  private readonly cameFrom: Int32Array;
  private readonly stamp: Uint32Array;
  private readonly closed: Uint32Array;
  private search = 0;

  constructor(
    terrain: HeightField,
    /** Half-extent (m) of the square covered; outside counts as blocked. */
    radius: number,
    readonly cell = 10,
  ) {
    this.size = Math.ceil((radius * 2) / cell);
    this.origin = -this.size * cell * 0.5;
    const n = this.size;
    // Heights at cell corners.
    const h = new Float32Array((n + 1) * (n + 1));
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) h[j * (n + 1) + i] = terrain.rawHeight(this.origin + i * cell, this.origin + j * cell);
    }
    this.grade = new Float32Array(n * n);
    const lim = terrain.halfSize - 60;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const cx = this.origin + (i + 0.5) * cell;
        const cz = this.origin + (j + 0.5) * cell;
        if (Math.abs(cx) > lim || Math.abs(cz) > lim) {
          this.grade[j * n + i] = Infinity;
          continue;
        }
        const a = h[j * (n + 1) + i]!;
        const b = h[j * (n + 1) + i + 1]!;
        const c = h[(j + 1) * (n + 1) + i]!;
        const d = h[(j + 1) * (n + 1) + i + 1]!;
        const g = Math.max(Math.abs(a - b), Math.abs(c - d), Math.abs(a - c), Math.abs(b - d), Math.abs(a - d) / SQRT2, Math.abs(b - c) / SQRT2) / cell;
        this.grade[j * n + i] = g;
      }
    }
    this.gScore = new Float32Array(n * n);
    this.cameFrom = new Int32Array(n * n);
    this.stamp = new Uint32Array(n * n);
    this.closed = new Uint32Array(n * n);
  }

  cellOf(x: number, z: number): number {
    const i = Math.floor((x - this.origin) / this.cell);
    const j = Math.floor((z - this.origin) / this.cell);
    if (i < 0 || j < 0 || i >= this.size || j >= this.size) return -1;
    return j * this.size + i;
  }

  center(idx: number): NavPoint {
    const i = idx % this.size;
    const j = Math.floor(idx / this.size);
    return { x: this.origin + (i + 0.5) * this.cell, z: this.origin + (j + 0.5) * this.cell };
  }

  walkable(idx: number, maxGrade: number): boolean {
    return idx >= 0 && this.grade[idx]! <= maxGrade;
  }

  /** True if the straight segment a→b only crosses walkable cells. */
  clearLine(a: NavPoint, b: NavPoint, maxGrade: number): boolean {
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(dist / (this.cell * 0.4)));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      if (!this.walkable(this.cellOf(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t), maxGrade)) return false;
    }
    return true;
  }

  /** Nearest walkable cell to a point (spiral search), or -1. */
  nearestWalkable(p: NavPoint, maxGrade: number, maxRing = 12): number {
    const c = this.cellOf(p.x, p.z);
    if (this.walkable(c, maxGrade)) return c;
    const ci = Math.floor((p.x - this.origin) / this.cell);
    const cj = Math.floor((p.z - this.origin) / this.cell);
    for (let r = 1; r <= maxRing; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= this.size || j >= this.size) continue;
          const idx = j * this.size + i;
          const d = di * di + dj * dj;
          if (this.walkable(idx, maxGrade) && d < bestD) {
            best = idx;
            bestD = d;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /**
   * A* from `from` to `to` for a unit that climbs up to `maxGrade`. Returns
   * string-pulled waypoints (excluding the start), or [] if no route. If the
   * search budget runs out, returns a path to the closest node reached.
   */
  findPath(from: NavPoint, to: NavPoint, maxGrade: number, maxExpand = 40000): NavPoint[] {
    const start = this.nearestWalkable(from, maxGrade);
    const goal = this.nearestWalkable(to, maxGrade);
    if (start < 0 || goal < 0) return [];
    const n = this.size;
    const id = ++this.search;
    const gx = goal % n;
    const gz = Math.floor(goal / n);
    const h = (idx: number): number => {
      const dx = Math.abs((idx % n) - gx);
      const dz = Math.abs(Math.floor(idx / n) - gz);
      return (dx + dz + (SQRT2 - 2) * Math.min(dx, dz)) * this.cell;
    };
    const heap = new MinHeap();
    this.stamp[start] = id;
    this.gScore[start] = 0;
    this.cameFrom[start] = -1;
    heap.push(start, h(start));
    let best = start;
    let bestH = h(start);
    let expanded = 0;
    while (heap.size > 0 && expanded < maxExpand) {
      const cur = heap.pop();
      if (this.closed[cur] === id) continue;
      this.closed[cur] = id;
      expanded++;
      if (cur === goal) {
        best = goal;
        break;
      }
      const hc = h(cur);
      if (hc < bestH) {
        bestH = hc;
        best = cur;
      }
      const ci = cur % n;
      const cj = Math.floor(cur / n);
      for (const [di, dj, cost] of NEIGHBORS) {
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const nb = j * n + i;
        if (!this.walkable(nb, maxGrade) || this.closed[nb] === id) continue;
        // No corner cutting past blocked cells.
        if (di !== 0 && dj !== 0 && (!this.walkable(cj * n + i, maxGrade) || !this.walkable(j * n + ci, maxGrade))) continue;
        const g = this.gScore[cur]! + cost * this.cell * (1 + this.grade[nb]! * 0.6);
        if (this.stamp[nb] !== id || g < this.gScore[nb]!) {
          this.stamp[nb] = id;
          this.gScore[nb] = g;
          this.cameFrom[nb] = cur;
          heap.push(nb, g + h(nb));
        }
      }
    }
    // Reconstruct, then string-pull.
    const raw: NavPoint[] = [];
    for (let c = best; c !== -1 && c !== start; c = this.cameFrom[c]!) raw.push(this.center(c));
    raw.reverse();
    if (best === goal && raw.length) raw[raw.length - 1] = { x: to.x, z: to.z };
    return this.smooth(from, raw, maxGrade);
  }

  private smooth(from: NavPoint, pts: NavPoint[], maxGrade: number): NavPoint[] {
    const out: NavPoint[] = [];
    let anchor = from;
    let i = 0;
    while (i < pts.length) {
      let far = i;
      for (let k = pts.length - 1; k > i; k--) {
        if (this.clearLine(anchor, pts[k]!, maxGrade)) {
          far = k;
          break;
        }
      }
      out.push(pts[far]!);
      anchor = pts[far]!;
      i = far + 1;
    }
    return out;
  }
}

/** Binary min-heap of (index, priority). */
class MinHeap {
  private readonly idx: number[] = [];
  private readonly pri: number[] = [];

  get size(): number {
    return this.idx.length;
  }

  push(i: number, p: number): void {
    const a = this.idx;
    const b = this.pri;
    a.push(i);
    b.push(p);
    let k = a.length - 1;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (b[parent]! <= b[k]!) break;
      [a[parent], a[k]] = [a[k]!, a[parent]!];
      [b[parent], b[k]] = [b[k]!, b[parent]!];
      k = parent;
    }
  }

  pop(): number {
    const a = this.idx;
    const b = this.pri;
    const top = a[0]!;
    const lastI = a.pop()!;
    const lastP = b.pop()!;
    if (a.length > 0) {
      a[0] = lastI;
      b[0] = lastP;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < a.length && b[l]! < b[m]!) m = l;
        if (r < a.length && b[r]! < b[m]!) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k]!, a[m]!];
        [b[m], b[k]] = [b[k]!, b[m]!];
        k = m;
      }
    }
    return top;
  }
}
