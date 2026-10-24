import { describe, expect, it } from 'vitest';
import { IRONCLAW, WARDEN } from '../../src/data/chassis';
import { MechView } from '../../src/render/mechs/mechView';
import { buildMechRig } from '../../src/render/mechs/registry';
import { IDLE_COMMAND } from '../../src/sim/mech';
import { FlatTerrain } from '../../src/sim/terrains';
import { World } from '../../src/sim/world';

const DT = 1 / 60;

describe('MechView body motion', () => {
  // Regression: setting off from a standstill used to leave a planted foot far behind
  // (the first strides were timed for a walk), and the body squatted to reach it.
  for (const def of [IRONCLAW, WARDEN]) {
    it(`${def.id}: no squats or jumps when starting, stopping and reversing`, () => {
      const world = new World(1, new FlatTerrain());
      const m = world.spawnMech(def, 0, 0, 0, 0);
      const v = new MechView(m, buildMechRig(def.id), () => 0);
      // Throttle script: go, stop, go, reverse, go.
      const script: [number, number][] = [[0.5, 0], [4, 1], [2.5, 0], [3, 1], [3, -1], [3, 1]];
      let min = Infinity;
      let maxStep = 0;
      let last = Number.NaN;
      for (const [seconds, throttle] of script) {
        for (let i = 0; i < Math.round(seconds / DT); i++) {
          m.command = { ...IDLE_COMMAND, moveZ: throttle };
          world.step(DT);
          v.update(1, DT);
          const y = v.rig.pelvis.position.y;
          min = Math.min(min, y);
          if (!Number.isNaN(last)) maxStep = Math.max(maxStep, Math.abs(y - last));
          last = y;
        }
      }
      const hip = v.rig.hipHeight;
      expect(min).toBeGreaterThan(hip - 0.75); // the stride's own trough, never a squat
      expect(maxStep).toBeLessThan(0.12); // per frame: the cockpit rides on this
    });
  }
});
