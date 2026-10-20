/**
 * Prints muzzle offsets and per-location bounding boxes of a chassis rig in its
 * standing pose (mech-local space, torso twist 0). Use the output to update
 * `muzzle` and `hitBoxes` in src/data/chassis.ts.
 *
 *   npx tsx scripts/measure-rig.ts ironclaw
 */
import * as THREE from 'three';
import { getChassis } from '../src/data/chassis';
import { Mech } from '../src/sim/mech';
import { FlatTerrain } from '../src/sim/terrains';
import { MechView } from '../src/render/mechs/mechView';
import { buildMechRig } from '../src/render/mechs/registry';

const id = process.argv[2] ?? 'ironclaw';
const terrain = new FlatTerrain();
const mech = new Mech(1, getChassis(id), 0, 0, 0, terrain);
const rig = buildMechRig(id);
const view = new MechView(mech, rig, () => 0);
for (let i = 0; i < 30; i++) view.update(1, 1 / 60);
rig.root.updateMatrixWorld(true);

const r = (v: number): number => Math.round(v * 100) / 100;
const fmt = (v: THREE.Vector3): string => `[${r(v.x)}, ${r(v.y)}, ${r(v.z)}]`;

console.log(`// ${id} muzzles`);
for (const [name, node] of Object.entries(rig.hardpoints)) console.log(`${name}: ${fmt(node.getWorldPosition(new THREE.Vector3()))}`);

const locRoots = new Set(Object.values(rig.locations));
function boxOf(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  const visit = (o: THREE.Object3D): void => {
    if (o !== root && locRoots.has(o)) return;
    if (o instanceof THREE.Mesh) box.expandByObject(o);
    else for (const c of o.children) visit(c);
  };
  visit(root);
  return box;
}
console.log(`// ${id} location boxes (centre, half-extents)`);
const entries: [string, THREE.Object3D][] = [['ct', rig.pelvis], ...Object.entries(rig.locations)];
for (const [loc, root] of entries) {
  const b = boxOf(root);
  if (b.isEmpty()) {
    console.log(`${loc}: (empty)`);
    continue;
  }
  console.log(`${loc}: c ${fmt(b.getCenter(new THREE.Vector3()))} h ${fmt(b.getSize(new THREE.Vector3()).multiplyScalar(0.5))}`);
}
