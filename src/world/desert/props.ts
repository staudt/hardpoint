import * as THREE from 'three';
import { Rng } from '../../sim/rng';
import type { DesertTerrain } from '../../sim/terrain';
import { DESERT } from './palette';

/** Faceted rock: low-subdivision icosahedron with jittered vertices, flat-shaded. */
function rockGeometry(rng: Rng, detail: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.getAttribute('position');
  // Jitter shared positions consistently (icosahedron is non-indexed in three).
  const seen = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let d = seen.get(key);
    if (!d) {
      const s = rng.range(0.75, 1.2);
      d = [pos.getX(i) * s, Math.max(pos.getY(i) * s, -0.35), pos.getZ(i) * s];
      seen.set(key, d);
    }
    pos.setXYZ(i, d[0], d[1], d[2]);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Desert shrub: a few squashed blobs merged into one geometry. */
function shrubGeometry(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const count = rng.int(2, 4);
  for (let i = 0; i < count; i++) {
    const g = new THREE.IcosahedronGeometry(rng.range(0.6, 1), 0);
    g.scale(1, rng.range(0.55, 0.8), 1);
    g.translate(rng.range(-0.7, 0.7), rng.range(0.25, 0.6), rng.range(-0.7, 0.7));
    parts.push(g);
  }
  const merged = mergeNonIndexed(parts);
  merged.computeVertexNormals();
  return merged;
}

function mergeNonIndexed(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const total = geos.reduce((s, g) => s + g.getAttribute('position').count, 0);
  const pos = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) {
    const src = (g.index ? g.toNonIndexed() : g).getAttribute('position').array as Float32Array;
    pos.set(src, o);
    o += src.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return out;
}

interface ScatterSpec {
  count: number;
  geometries: THREE.BufferGeometry[];
  material: THREE.Material;
  /** Return scale (x,y,z) or null to reject this spot. */
  place: (x: number, z: number, h: number, flat: number, rng: Rng) => THREE.Vector3 | null;
  colors: THREE.Color[];
  sink: number;
}

function scatter(terrain: DesertTerrain, rng: Rng, spec: ScatterSpec, radius: number): THREE.InstancedMesh[] {
  const buckets: THREE.Matrix4[][] = spec.geometries.map(() => []);
  const tints: THREE.Color[][] = spec.geometries.map(() => []);
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  let attempts = 0;
  let placed = 0;
  while (placed < spec.count && attempts < spec.count * 8) {
    attempts++;
    const a = rng.next() * Math.PI * 2;
    const r = Math.sqrt(rng.next()) * radius;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = terrain.heightAt(x, z);
    const scale = spec.place(x, z, h, terrain.flatness(x, z), rng);
    if (!scale) continue;
    const k = rng.int(0, spec.geometries.length - 1);
    e.set(rng.range(-0.15, 0.15), rng.next() * Math.PI * 2, rng.range(-0.15, 0.15));
    q.setFromEuler(e);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, h - spec.sink * scale.y, z), q, scale);
    buckets[k]!.push(m);
    tints[k]!.push(rng.pick(spec.colors).clone().multiplyScalar(rng.range(0.85, 1.1)));
    placed++;
  }
  return spec.geometries.map((geo, k) => {
    const list = buckets[k]!;
    const mesh = new THREE.InstancedMesh(geo, spec.material, list.length);
    list.forEach((m, i) => {
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, tints[k]![i]!);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    return mesh;
  });
}

/** Rocks, boulders and shrubs scattered over the basin. Deterministic per seed. */
export function buildDesertProps(terrain: DesertTerrain, seed: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'props';
  const rng = new Rng(seed).fork(101);
  const mat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9, metalness: 0 });
  const radius = terrain.basinRadius + 250;

  const rocks = Array.from({ length: 4 }, () => rockGeometry(rng, 0));
  const boulders = Array.from({ length: 3 }, () => rockGeometry(rng, 1));
  const shrubs = Array.from({ length: 3 }, () => shrubGeometry(rng));

  const rockColors = [DESERT.boulder, DESERT.rock, DESERT.rockDark, DESERT.sandDark];
  for (const m of scatter(terrain, rng, {
    count: 4200,
    geometries: rocks,
    material: mat,
    colors: rockColors,
    sink: 0.3,
    place: (_x, _z, _h, flat, r) => {
      if (flat < 0.6) return null;
      const s = r.next() < 0.8 ? r.range(0.6, 2) : r.range(2.2, 4);
      return new THREE.Vector3(s * r.range(0.8, 1.3), s * r.range(0.5, 0.9), s * r.range(0.8, 1.3));
    },
  }, radius)) group.add(m);

  for (const m of scatter(terrain, rng, {
    count: 420,
    geometries: boulders,
    material: mat,
    colors: rockColors,
    sink: 0.35,
    // Big boulders favour cliff bases (moderately sloped ground).
    place: (_x, _z, _h, flat, r) => {
      if (flat < 0.5 || (flat > 0.97 && r.next() < 0.7)) return null;
      const s = r.range(3.5, 9);
      return new THREE.Vector3(s * r.range(0.8, 1.4), s * r.range(0.5, 0.85), s * r.range(0.8, 1.4));
    },
  }, radius)) group.add(m);

  for (const m of scatter(terrain, rng, {
    count: 900,
    geometries: shrubs,
    material: mat,
    colors: [DESERT.shrub, DESERT.shrubDark],
    sink: 0.1,
    place: (_x, _z, h, flat, r) => {
      if (flat < 0.92 || h > 6) return null;
      const s = r.range(0.8, 2.2);
      return new THREE.Vector3(s, s * r.range(0.7, 1.1), s);
    },
  }, terrain.basinRadius)) group.add(m);

  return group;
}
