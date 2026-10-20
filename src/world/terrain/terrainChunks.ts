import * as THREE from 'three';
import { cellFlipped, type HeightField } from '../../sim/terrain';

/** Returns a linear-space RGB colour for a terrain face. */
export type FaceColorFn = (cx: number, cz: number, h: number, ny: number, out: THREE.Color) => void;

export interface TerrainChunkOptions {
  chunkCells: number;
  chunksPerSide: number;
  /** Camera distance thresholds for switching to LOD 1, 2, 3… (m). */
  lodDistances: number[];
  skirtDepth: number;
}

interface Chunk {
  ci: number;
  cj: number;
  center: THREE.Vector3;
  lods: (THREE.Mesh | undefined)[];
  current: number;
}

/**
 * Flat-shaded, vertex-coloured terrain split into square chunks with discrete
 * LODs. Each chunk has skirts so LOD seams never show holes.
 */
export class TerrainChunks {
  readonly group = new THREE.Group();
  readonly material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.95,
    metalness: 0,
  });
  private readonly chunks: Chunk[] = [];
  private readonly chunkSize: number;
  private readonly maxLod: number;

  constructor(
    private readonly field: HeightField,
    private readonly colorFn: FaceColorFn,
    private readonly opts: TerrainChunkOptions,
  ) {
    this.group.name = 'terrain';
    this.chunkSize = field.cell * opts.chunkCells;
    this.maxLod = Math.min(opts.lodDistances.length, Math.log2(opts.chunkCells));
    const half = opts.chunksPerSide / 2;
    for (let cj = -half; cj < half; cj++) {
      for (let ci = -half; ci < half; ci++) {
        const cx = (ci + 0.5) * this.chunkSize;
        const cz = (cj + 0.5) * this.chunkSize;
        const center = new THREE.Vector3(cx, field.rawHeight(cx, cz), cz);
        const chunk: Chunk = { ci, cj, center, lods: [], current: this.maxLod };
        this.chunks.push(chunk);
        this.show(chunk, this.maxLod);
      }
    }
  }

  /** Pick LODs for the camera; builds missing meshes within `budgetMs` (Infinity = all now). */
  update(cameraPos: THREE.Vector3, budgetMs = 4): void {
    const start = performance.now();
    const wanted = this.chunks
      .map((c) => ({ c, d: Math.hypot(c.center.x - cameraPos.x, c.center.z - cameraPos.z) - this.chunkSize * 0.5 }))
      .sort((a, b) => a.d - b.d);
    for (const { c, d } of wanted) {
      let lod = this.opts.lodDistances.findIndex((limit) => d < limit);
      if (lod === -1 || lod > this.maxLod) lod = this.maxLod;
      if (lod === c.current) continue;
      if (!c.lods[lod] && performance.now() - start > budgetMs) continue;
      this.show(c, lod);
    }
  }

  get triangleCount(): number {
    let tris = 0;
    for (const c of this.chunks) {
      const g = c.lods[c.current]?.geometry;
      if (g) tris += g.getAttribute('position').count / 3;
    }
    return tris;
  }

  private show(chunk: Chunk, lod: number): void {
    const prev = chunk.lods[chunk.current];
    if (prev) prev.visible = false;
    let mesh = chunk.lods[lod];
    if (!mesh) {
      mesh = new THREE.Mesh(this.buildGeometry(chunk.ci, chunk.cj, lod), this.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.name = `chunk_${chunk.ci}_${chunk.cj}_lod${lod}`;
      chunk.lods[lod] = mesh;
      this.group.add(mesh);
    }
    mesh.visible = true;
    chunk.current = lod;
  }

  private buildGeometry(ci: number, cj: number, lod: number): THREE.BufferGeometry {
    const field = this.field;
    const step = field.cell * (1 << lod);
    const n = this.opts.chunkCells >> lod;
    const x0 = ci * this.chunkSize;
    const z0 = cj * this.chunkSize;
    const gi0 = Math.round(x0 / step);
    const gj0 = Math.round(z0 / step);

    const heights = new Float32Array((n + 1) * (n + 1));
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) heights[j * (n + 1) + i] = field.rawHeight(x0 + i * step, z0 + j * step);
    }
    const H = (i: number, j: number): number => heights[j * (n + 1) + i]!;

    const triCount = n * n * 2 + n * 4 * 2;
    const pos = new Float32Array(triCount * 9);
    const col = new Float32Array(triCount * 9);
    let v = 0;
    const color = new THREE.Color();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const nrm = new THREE.Vector3();

    const pushTri = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3, want: THREE.Vector3 | null): void => {
      e1.subVectors(q, p);
      e2.subVectors(r, p);
      nrm.crossVectors(e1, e2).normalize();
      let Q = q;
      let R = r;
      const up = want ? nrm.dot(want) : nrm.y;
      if (up < 0) {
        [Q, R] = [R, Q];
        nrm.negate();
      }
      if (!want) this.colorFn((p.x + q.x + r.x) / 3, (p.z + q.z + r.z) / 3, (p.y + q.y + r.y) / 3, nrm.y, color);
      for (const vert of [p, Q, R]) {
        pos[v] = vert.x;
        pos[v + 1] = vert.y;
        pos[v + 2] = vert.z;
        col[v] = color.r;
        col[v + 1] = color.g;
        col[v + 2] = color.b;
        v += 3;
      }
    };

    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const xa = x0 + i * step;
        const za = z0 + j * step;
        const p00 = new THREE.Vector3(xa, H(i, j), za);
        const p10 = new THREE.Vector3(xa + step, H(i + 1, j), za);
        const p01 = new THREE.Vector3(xa, H(i, j + 1), za + step);
        const p11 = new THREE.Vector3(xa + step, H(i + 1, j + 1), za + step);
        if (!cellFlipped(gi0 + i, gj0 + j)) {
          pushTri(p00, p10, p11, null);
          pushTri(p00, p11, p01, null);
        } else {
          pushTri(p00, p10, p01, null);
          pushTri(p11, p01, p10, null);
        }
      }
    }

    // Skirts: vertical strips hanging below each edge, coloured like the edge face above.
    const depth = this.opts.skirtDepth;
    const edges: { out: THREE.Vector3; pt: (k: number) => [number, number] }[] = [
      { out: new THREE.Vector3(0, 0, -1), pt: (k) => [k, 0] },
      { out: new THREE.Vector3(0, 0, 1), pt: (k) => [k, n] },
      { out: new THREE.Vector3(-1, 0, 0), pt: (k) => [0, k] },
      { out: new THREE.Vector3(1, 0, 0), pt: (k) => [n, k] },
    ];
    for (const edge of edges) {
      for (let k = 0; k < n; k++) {
        const [i0, j0] = edge.pt(k);
        const [i1, j1] = edge.pt(k + 1);
        a.set(x0 + i0 * step, H(i0, j0), z0 + j0 * step);
        b.set(x0 + i1 * step, H(i1, j1), z0 + j1 * step);
        this.colorFn((a.x + b.x) / 2, (a.z + b.z) / 2, (a.y + b.y) / 2 - depth / 2, 0, color);
        c.copy(b).setY(b.y - depth);
        pushTri(a, b, c, edge.out);
        const d = a.clone().setY(a.y - depth);
        pushTri(a, c, d, edge.out);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }
}
