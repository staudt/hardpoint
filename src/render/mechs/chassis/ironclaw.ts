import type * as THREE from 'three';
import { DEG } from '../../../sim/angles';
import { axle, barrel, box, cyl, hull, makePaint, mergeByMaterial, node, taper, tubeGrid, type Paint, type V3 } from '../kit';
import type { LegRig, MechRig } from '../rig';

/**
 * Ironclaw IC-7 — reverse-joint 75 t heavy. Homage to the classic clan heavy:
 * forward-hunched torso with a cockpit "beak", shoulder missile racks, gun-pod
 * arms slung under the side torsos, chicken-walker legs with three-toed feet.
 */
const HIP_HEIGHT = 6.2;
const UPPER = 3.0;
const LOWER = 3.3;
const TARSUS = 1.8;
const TARSUS_ANGLE = 25 * DEG;
const ANKLE_H = 0.55;
const HIP_X = 1.95;

export function buildIronclaw(paint: Paint = makePaint({ armor: 0x8c8752, armorDark: 0x6b6943, frame: 0x47463f, accent: 0xd0a62a })): MechRig {
  const root = node('ironclaw');
  const pelvis = node('pelvis', [0, HIP_HEIGHT, 0], root);

  // --- Pelvis -------------------------------------------------------------
  pelvis.add(
    taper(2.4, 1.8, 3.0, 2.2, 1.3, paint.armorDark, [0, 0.15, 0.25]),
    axle(0.75, 0.9, 8, paint.frame, [-HIP_X + 0.15, 0, 0.35]),
    axle(0.75, 0.9, 8, paint.frame, [HIP_X - 0.15, 0, 0.35]),
    box(1.2, 0.9, 1.2, paint.frame, [0, 0.75, 0.2]), // torso ring
  );

  // --- Torso ----------------------------------------------------------------
  const torsoTwist = node('torso_twist', [0, 1.0, 0], pelvis);
  const torsoPitch = node('torso_pitch', [0, 0, 0], torsoTwist);
  const hardpoints: Record<string, THREE.Object3D> = {};
  const hp = (id: string, at: V3): void => {
    hardpoints[id] = node(id, at, torsoPitch);
  };

  // Centre torso: hunched, sloping forward into the cockpit nose.
  const ctPts: V3[] = [];
  for (const s of [-1, 1]) {
    ctPts.push(
      [s * 1.6, 1.7, 1.9], [s * 1.45, 1.55, -1.2], [s * 0.95, 0.45, -3.2],
      [s * 0.75, -0.45, -3.0], [s * 1.1, -1.15, -1.7], [s * 1.5, -1.0, 1.7],
    );
  }
  torsoPitch.add(hull(ctPts, paint.armor));

  // Canopy: thin slab lying on the sloped nose.
  const canopyPts: V3[] = [];
  for (const s of [-1, 1]) {
    canopyPts.push([s * 0.85, 1.4, -1.55], [s * 0.72, 0.62, -3.05], [s * 0.78, 1.3, -1.52], [s * 0.66, 0.54, -3.0]);
  }
  const locHead = node('loc_head', [0, 0, 0], torsoPitch);
  const canopy = hull(canopyPts, paint.glass);
  locHead.add(canopy);
  // Chin plate + centre laser.
  torsoPitch.add(taper(1.3, 0.9, 1.6, 1.1, 0.35, paint.armorDark, [0, -1.0, -1.8]));
  torsoPitch.add(barrel(0.12, 0.9, 6, paint.metal, [0, -1.15, -2.45]));
  hp('hp_ct_1', [0, -1.15, -2.95]);

  // Back: reactor housing, vents and exhaust glow.
  torsoPitch.add(
    box(2.2, 1.5, 1.1, paint.frame, [0, 0.3, 2.15], undefined, 0.12),
    box(1.7, 0.14, 0.1, paint.glow, [0, -0.15, 2.72]),
  );
  for (let i = 0; i < 4; i++) torsoPitch.add(box(0.12, 1.0, 0.5, paint.armorDark, [-0.75 + i * 0.5, 0.6, 2.8]));

  const locations: MechRig['locations'] = { head: locHead };
  for (const s of [-1, 1] as const) {
    const L = s < 0 ? 'l' : 'r';
    const side = node(`loc_${L}t`, [0, 0, 0], torsoPitch);
    locations[`${L}t`] = side;
    // Side torso block.
    side.add(taper(1.4, 2.7, 1.75, 3.2, 2.4, paint.armorDark, [s * 2.2, 0.3, 0.3], undefined, s * 0.05));
    side.add(box(0.08, 0.5, 1.8, paint.accent, [s * 3.06, 0.9, 0.1]));
    // Shoulder missile rack.
    const rackZ = -0.15;
    side.add(box(2.0, 1.6, 2.7, paint.armor, [s * 2.2, 2.25, rackZ], undefined, 0.16));
    side.add(tubeGrid(3, 2, 0.52, 0.18, paint.hole, [s * 2.2, 2.2, rackZ - 1.37]));
    side.add(box(2.06, 0.2, 0.12, paint.accent, [s * 2.2, 3.08, rackZ - 1.3]));
    hp(`hp_${L}t_1`, [s * 2.2, 2.2, rackZ - 1.5]);

    // Arm: shoulder actuator, upper pod, forearm gun pod.
    const arm = node(`arm_${L}`, [s * 3.15, 0.35, -0.3], torsoPitch);
    locations[`${L}a`] = arm;
    arm.add(
      axle(0.5, 0.7, 8, paint.frame, [s * 0.15, 0, 0]),
      box(0.9, 1.5, 1.1, paint.armorDark, [s * 0.3, -0.75, 0], undefined, 0.1),
      box(1.05, 1.05, 2.9, paint.armor, [s * 0.3, -1.65, -0.75], undefined, 0.12),
      box(1.1, 0.12, 1.2, paint.accent, [s * 0.3, -1.08, -1.4]),
    );
    if (s > 0) {
      // Right: autocannon over a laser.
      arm.add(barrel(0.24, 2.3, 8, paint.metal, [s * 0.3, -1.5, -3.2]));
      arm.add(cyl(0.32, 0.32, 0.4, 8, paint.frame, [s * 0.3, -1.5, -4.3], [Math.PI / 2, 0, 0]));
      arm.add(barrel(0.13, 0.9, 6, paint.metal, [s * 0.3, -2.0, -2.6]));
      hardpoints.hp_ra_1 = node('hp_ra_1', [s * 0.3, -1.5, -4.55], arm);
      hardpoints.hp_ra_2 = node('hp_ra_2', [s * 0.3, -2.0, -3.1], arm);
    } else {
      // Left: twin lasers.
      for (const [k, dx] of [[1, -0.2], [2, 0.2]] as const) {
        arm.add(barrel(0.15, 1.5, 6, paint.metal, [s * 0.3 + dx, -1.55, -2.85]));
        arm.add(box(0.36, 0.36, 0.3, paint.frame, [s * 0.3 + dx, -1.55, -2.2]));
        hardpoints[`hp_la_${k}`] = node(`hp_la_${k}`, [s * 0.3 + dx, -1.55, -3.65], arm);
      }
    }
  }
  // Antenna on the left rack.
  locations.lt!.add(cyl(0.04, 0.06, 2.2, 4, paint.frame, [-2.8, 4.1, 0.7]));

  const cockpit = node('cockpit', [0, 0.9, -2.5], torsoPitch);

  const legs = [buildLeg(-1, paint, pelvis), buildLeg(1, paint, pelvis)] as [LegRig, LegRig];
  locations.ll = legs[0].hip;
  locations.rl = legs[1].hip;
  mergeByMaterial(root, new Set([canopy]));

  return {
    root,
    pelvis,
    torsoTwist,
    torsoPitch,
    cockpit,
    cockpitHide: [canopy],
    legs,
    hardpoints,
    hipHeight: HIP_HEIGHT,
    height: HIP_HEIGHT + 1.0 + 2.9,
    locations,
    gait: {
      spread: HIP_X + 0.15,
      forward: 0.3,
      reach: 3.3,
      stepHeight: 1.1,
      minStepTime: 0.36,
      maxStepTime: 0.72,
      bob: 0.32,
      sway: 0.035,
    },
  };
}

function buildLeg(side: -1 | 1, paint: Paint, pelvis: THREE.Object3D): LegRig {
  const s = side;
  const L = s < 0 ? 'l' : 'r';
  const hip = node(`hip_${L}`, [s * HIP_X, 0, 0.35], pelvis);
  const upper = node(`thigh_${L}`, [0, 0, 0], hip);
  // Thigh: heavy armoured wedge.
  upper.add(
    taper(1.3, 1.5, 1.65, 2.3, UPPER, paint.armor, [s * 0.1, -UPPER / 2, 0]),
    box(0.2, 2.2, 1.8, paint.armorDark, [s * 0.92, -1.3, 0], undefined, 0.06),
  );

  const lower = node(`shin_${L}`, [0, -UPPER, 0], upper);
  lower.add(
    axle(0.5, 1.4, 8, paint.frame, [0, 0, 0]),
    box(1.4, 1.2, 1.2, paint.armorDark, [0, -0.05, -0.5], undefined, 0.15), // knee cap
    taper(0.95, 1.0, 1.25, 1.55, LOWER, paint.armor, [0, -LOWER / 2 - 0.1, 0.05]),
    taper(0.9, 0.22, 1.2, 0.3, LOWER * 0.8, paint.armorDark, [0, -LOWER / 2, -0.72]), // shin plate
    cyl(0.15, 0.15, 2.4, 6, paint.metal, [0, -1.7, 0.85]), // hydraulic
  );

  const tarsus = node(`tarsus_${L}`, [0, -LOWER, 0], lower);
  tarsus.add(
    axle(0.42, 1.1, 8, paint.frame, [0, 0, 0]),
    box(0.78, TARSUS, 0.78, paint.frame, [0, -TARSUS / 2, 0], undefined, 0.08),
    taper(0.5, 0.4, 0.7, 0.55, 1.1, paint.armorDark, [0, -0.7, 0.32]), // rear spur plate
  );

  const foot = node(`foot_${L}`, [0, -TARSUS, 0], tarsus);
  foot.add(
    box(1.3, 0.55, 1.3, paint.frame, [0, -0.28, 0], undefined, 0.12),
    // Three forward toes and a rear spur, soles at −ANKLE_H.
    taper(0.7, 2.1, 0.45, 1.6, 0.42, paint.armorDark, [0, -ANKLE_H + 0.21, -1.05]),
    taper(0.6, 1.7, 0.4, 1.25, 0.38, paint.armorDark, [-0.65, -ANKLE_H + 0.19, -0.7], [0, 28 * DEG, 0]),
    taper(0.6, 1.7, 0.4, 1.25, 0.38, paint.armorDark, [0.65, -ANKLE_H + 0.19, -0.7], [0, -28 * DEG, 0]),
    taper(0.45, 1.0, 0.3, 0.7, 0.34, paint.armorDark, [0, -ANKLE_H + 0.17, 0.75]),
  );

  return { side, hip, upper, lower, tarsus, foot, upperLen: UPPER, lowerLen: LOWER, tarsusLen: TARSUS, tarsusAngle: TARSUS_ANGLE, ankleHeight: ANKLE_H };
}
