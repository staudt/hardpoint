import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CHASSIS } from '../../src/data/chassis';
import { getWeapon } from '../../src/data/weapons';
import { MechView } from '../../src/render/mechs/mechView';
import { buildMechRig } from '../../src/render/mechs/registry';
import { Mech } from '../../src/sim/mech';
import { FlatTerrain } from '../../src/sim/terrains';

/** The sim fires from `muzzle` offsets in the chassis data; they must match the model's hp_* nodes. */
describe.each(Object.values(CHASSIS))('$id rig ↔ data sync', (def) => {
  const mech = new Mech(1, def, 0, 0, 0, new FlatTerrain());
  const rig = buildMechRig(def.id);
  const view = new MechView(mech, rig, () => 0);
  for (let i = 0; i < 30; i++) view.update(1, 1 / 60);
  rig.root.updateMatrixWorld(true);

  it('every hardpoint exists in the model at its muzzle offset', () => {
    for (const hp of def.hardpoints) {
      const node = rig.hardpoints[hp.id];
      expect(node, hp.id).toBeDefined();
      const p = node!.getWorldPosition(new THREE.Vector3());
      expect(p.distanceTo(new THREE.Vector3(...hp.muzzle)), hp.id).toBeLessThan(0.3);
    }
  });

  it('every loadout entry uses a hardpoint of the right type', () => {
    for (const entry of def.loadout) {
      const hp = def.hardpoints.find((h) => h.id === entry.hardpoint);
      expect(hp, entry.hardpoint).toBeDefined();
      expect(getWeapon(entry.weapon).type, entry.hardpoint).toBe(hp!.type);
    }
  });

  it('has a hit box for every location', () => {
    for (const loc of ['head', 'ct', 'lt', 'rt', 'la', 'ra', 'll', 'rl'] as const) {
      expect(def.hitBoxes.some((b) => b.loc === loc), loc).toBe(true);
    }
  });
});
