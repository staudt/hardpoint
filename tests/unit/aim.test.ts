import { describe, expect, it } from 'vitest';
import { aimFromCamera, torsoAimPoint, type CameraAim } from '../../src/controls/aim';
import { IRONCLAW, WARDEN } from '../../src/data/chassis';
import { IDLE_COMMAND } from '../../src/sim/mech';
import { FlatTerrain } from '../../src/sim/terrains';
import { dist3, normalize3, v3 } from '../../src/sim/vec';
import { World } from '../../src/sim/world';

/**
 * Regression for the third-person parallax bug: from an over-the-shoulder camera,
 * the crosshair point, the sim's convergence point and the torso reticle must all
 * coincide once the torso has caught up — regardless of target distance.
 */
describe('third-person aiming has no parallax', () => {
  const cases: [string, number, boolean][] = [
    ['ground at ~60 m', -0.16, false],
    ['ground at ~250 m', -0.035, false],
    ['enemy mech at 300 m', 0, true],
  ];
  for (const [name, lookPitch, withTarget] of cases) {
    it(name, () => {
      const world = new World(1, new FlatTerrain());
      const me = world.spawnMech(IRONCLAW, 0, 0, 0);
      if (withTarget) world.spawnMech(WARDEN, 8, -300, Math.PI, 1);
      // Camera behind, right and above the mech (like ChaseRig), looking slightly off-axis.
      const cam = v3(5.5, 13, 23);
      // For the mech case, look straight at the target's centre of mass.
      const look = withTarget ? normalize3(v3(8 - cam.x, 7 - cam.y, -300 - cam.z)) : normalize3(v3(0.02, lookPitch, -1));
      const aim: CameraAim = { point: v3(), yaw: 0, pitch: 0 };
      for (let i = 0; i < 240; i++) {
        aimFromCamera(world, me, cam, look, aim);
        me.command = { ...IDLE_COMMAND, aimYaw: aim.yaw, aimPitch: aim.pitch };
        world.step(1 / 60);
      }
      const torso = torsoAimPoint(world, me, v3());
      expect(dist3(me.combat.aimPoint, aim.point)).toBeLessThan(0.5);
      expect(dist3(torso, aim.point)).toBeLessThan(0.5);
    });
  }
});
