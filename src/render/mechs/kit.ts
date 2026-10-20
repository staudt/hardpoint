import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Low-poly modelling kit for mechs, vehicles and props. Everything is built
 * from convex hulls, boxes and low-segment cylinders with flat shading.
 * Conventions: metres, +Y up, forward is −Z.
 */
export type V3 = readonly [number, number, number];

export interface Paint {
  armor: THREE.MeshStandardMaterial;
  armorDark: THREE.MeshStandardMaterial;
  frame: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  glow: THREE.MeshStandardMaterial;
  hole: THREE.MeshStandardMaterial;
}

export interface PaintScheme {
  armor: number;
  armorDark: number;
  frame: number;
  accent: number;
  glow?: number;
}

export function makePaint(s: PaintScheme): Paint {
  const std = (color: number, roughness = 0.75, metalness = 0.15): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });
  const glow = std(0x000000);
  glow.emissive.setHex(s.glow ?? 0xff6a2a);
  glow.emissiveIntensity = 4;
  const glass = std(0x1c2a2e, 0.25, 0.6);
  glass.emissive.setHex(0x0e2a2a);
  return {
    armor: std(s.armor),
    armorDark: std(s.armorDark),
    frame: std(s.frame, 0.6, 0.45),
    metal: std(0x5c5f60, 0.45, 0.7),
    accent: std(s.accent),
    glass,
    glow,
    hole: std(0x111111, 0.9, 0),
  };
}

function finish(mesh: THREE.Mesh, at?: V3, rot?: V3): THREE.Mesh {
  if (at) mesh.position.set(at[0], at[1], at[2]);
  if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Convex hull of arbitrary points — the workhorse for faceted armour. */
export function hull(points: readonly V3[], mat: THREE.Material, at?: V3, rot?: V3): THREE.Mesh {
  const geo = new ConvexGeometry(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  return finish(new THREE.Mesh(geo, mat), at, rot);
}

/** Box with optional chamfer on all edges (c = chamfer size). */
export function box(w: number, h: number, d: number, mat: THREE.Material, at?: V3, rot?: V3, c = 0): THREE.Mesh {
  if (c <= 0) return finish(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat), at, rot);
  const x = w / 2, y = h / 2, z = d / 2;
  const pts: V3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    pts.push([sx * (x - c), sy * y, sz * z], [sx * x, sy * (y - c), sz * z], [sx * x, sy * y, sz * (z - c)]);
  }
  return hull(pts, mat, at, rot);
}

/**
 * Tapered block: bottom rectangle (w0 × d0) at −h/2, top rectangle (w1 × d1) at +h/2,
 * top shifted by (dx, dz). Great for armour plates, hulls and limbs.
 */
export function taper(
  w0: number, d0: number, w1: number, d1: number, h: number,
  mat: THREE.Material, at?: V3, rot?: V3, dx = 0, dz = 0,
): THREE.Mesh {
  const pts: V3[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    pts.push([(sx * w0) / 2, -h / 2, (sz * d0) / 2], [(sx * w1) / 2 + dx, h / 2, (sz * d1) / 2 + dz]);
  }
  return hull(pts, mat, at, rot);
}

/** Low-segment cylinder along Y (rotate to orient). */
export function cyl(rTop: number, rBottom: number, h: number, seg: number, mat: THREE.Material, at?: V3, rot?: V3): THREE.Mesh {
  return finish(new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), mat), at, rot);
}

/** Cylinder lying along Z (barrels, pointing forward). */
export function barrel(r: number, len: number, seg: number, mat: THREE.Material, at: V3): THREE.Mesh {
  return cyl(r, r, len, seg, mat, at, [Math.PI / 2, 0, 0]);
}

/** Cylinder lying along X (hip/shoulder actuators). */
export function axle(r: number, len: number, seg: number, mat: THREE.Material, at: V3): THREE.Mesh {
  return cyl(r, r, len, seg, mat, at, [0, 0, Math.PI / 2]);
}

/** Named empty node (pivot / hardpoint / camera mount). */
export function node(name: string, at: V3 = [0, 0, 0], parent?: THREE.Object3D): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(at[0], at[1], at[2]);
  parent?.add(g);
  return g;
}

/** Add several children and return the parent (fluent helper). */
export function add<T extends THREE.Object3D>(parent: T, ...children: THREE.Object3D[]): T {
  for (const c of children) parent.add(c);
  return parent;
}

/** Mirror a builder across X: build(side) for side = −1 (left) and +1 (right). */
export function mirrored(build: (side: -1 | 1) => THREE.Object3D[]): THREE.Object3D[] {
  return [...build(-1), ...build(1)];
}

/** Grid of dark tube openings on a launcher face (missile racks). Face lies in XY at z, facing −Z. */
export function tubeGrid(cols: number, rows: number, pitch: number, r: number, mat: THREE.Material, at: V3): THREE.Group {
  const g = node('tubes', at);
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    g.add(box(r * 2, r * 2, 0.12, mat, [(i - (cols - 1) / 2) * pitch, (j - (rows - 1) / 2) * pitch, 0]));
  }
  return g;
}

/**
 * Draw-call optimisation: within every node, merge all non-emissive child meshes
 * into ONE mesh with the paint baked into vertex colours (shared material), and
 * merge emissive meshes (glow, glass) per material. The node hierarchy — pivots,
 * hardpoints, animation — is untouched. Meshes in `keep` stay separate (parts
 * toggled at runtime). Damage tinting works by multiplying the material colour.
 */
export function mergeByMaterial(root: THREE.Object3D, keep: ReadonlySet<THREE.Object3D> = new Set()): void {
  const baked = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, metalness: 0.2 });
  baked.name = 'baked-paint';
  const isEmissive = (m: THREE.Material): boolean =>
    m instanceof THREE.MeshStandardMaterial && m.emissiveIntensity > 0 && m.emissive.getHex() !== 0;
  const nodes: THREE.Object3D[] = [];
  root.traverse((o) => nodes.push(o));
  for (const parent of nodes) {
    const groups = new Map<THREE.Material, THREE.Mesh[]>();
    for (const c of parent.children) {
      if (!(c instanceof THREE.Mesh) || keep.has(c) || c.children.length > 0 || Array.isArray(c.material)) continue;
      const key = isEmissive(c.material) ? c.material : baked;
      const list = groups.get(key) ?? [];
      list.push(c);
      groups.set(key, list);
    }
    for (const [material, meshes] of groups) {
      const bake = material === baked;
      if (meshes.length < 2 && !bake) continue;
      const geos = meshes.map((m) => {
        m.updateMatrix();
        const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
        if (bake) {
          const col = (m.material as THREE.MeshStandardMaterial).color;
          const n = g.getAttribute('position').count;
          const arr = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) arr.set([col.r, col.g, col.b], i * 3);
          g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
        }
        return g.applyMatrix4(m.matrix);
      });
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      for (const m of meshes) {
        parent.remove(m);
        m.geometry.dispose();
      }
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
  }
}
