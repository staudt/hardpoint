import type * as THREE from 'three';
import { axle, barrel, box, cyl, hull, makePaint, mergeByMaterial, node, taper, tubeGrid, type Paint, type V3 } from '../kit';
import type { LegRig, MechRig } from '../rig';

/**
 * Warden WD-3 — 50 t humanoid medium brawler. Broad heroic chest, small
 * angular head with a visor slit, pauldrons, gun-arms with forearms bent
 * forward, standard (forward-knee) legs with wedge feet.
 */
const HIP_HEIGHT = 4.85;
const UPPER = 2.5;
const LOWER = 2.5;
const ANKLE_H = 0.45;
const HIP_X = 1.1;

export function buildWarden(paint: Paint = makePaint({ armor: 0x9a8f78, armorDark: 0x6e6656, frame: 0x3e3d39, accent: 0xb5452a })): MechRig {
  const root = node('warden');
  const pelvis = node('pelvis', [0, HIP_HEIGHT, 0], root);

  // --- Pelvis -------------------------------------------------------------
  pelvis.add(
    box(2.4, 1.0, 1.6, paint.armorDark, [0, 0, 0], undefined, 0.15),
    axle(0.5, 0.6, 8, paint.frame, [-HIP_X, -0.05, 0]),
    axle(0.5, 0.6, 8, paint.frame, [HIP_X, -0.05, 0]),
    taper(0.9, 0.12, 1.3, 0.14, 0.8, paint.armor, [0, -0.55, -0.9]), // front skirt
    taper(0.9, 0.12, 1.3, 0.14, 0.8, paint.armor, [0, -0.55, 0.9]), // rear skirt
  );

  // --- Torso ----------------------------------------------------------------
  const torsoTwist = node('torso_twist', [0, 0.9, 0], pelvis);
  const torsoPitch = node('torso_pitch', [0, 0, 0], torsoTwist);
  const hardpoints: Record<string, THREE.Object3D> = {};

  torsoPitch.add(
    box(1.6, 0.8, 1.4, paint.frame, [0, 0, 0]), // waist
    taper(2.6, 2.0, 3.0, 2.2, 2.4, paint.armor, [0, 1.4, 0]), // chest
    taper(1.7, 1.5, 2.0, 1.7, 0.3, paint.armorDark, [0, 2.7, 0.05]), // collar
    taper(2.0, 0.1, 2.4, 0.12, 1.0, paint.armorDark, [0, 1.0, -1.12]), // chest plate
    box(2.2, 0.12, 0.1, paint.accent, [0, 0.45, -1.15]),
  );

  // Head.
  const locHead = node('loc_head', [0, 0, 0], torsoPitch);
  const headShell = box(1.0, 0.8, 1.1, paint.armorDark, [0, 3.15, -0.1], undefined, 0.12);
  const visor = box(0.8, 0.14, 0.06, paint.glass, [0, 3.2, -0.66]);
  locHead.add(headShell, visor);
  locHead.add(
    taper(0.3, 0.5, 0.5, 0.6, 0.3, paint.frame, [0, 3.65, 0.1]), // crest
    barrel(0.09, 0.7, 6, paint.metal, [0.62, 3.05, -0.5]),
  );
  hardpoints.hp_head_1 = node('hp_head_1', [0.62, 3.05, -0.88], locHead);
  const cockpit = node('cockpit', [0, 3.15, -0.25], torsoPitch);

  // SRM 2x2 box on the upper-left chest (left torso location). Right torso has no separate parts.
  const locLt = node('loc_lt', [0, 0, 0], torsoPitch);
  const locRt = node('loc_rt', [0, 0, 0], torsoPitch);
  locLt.add(
    box(0.95, 0.95, 0.6, paint.frame, [-1.05, 2.0, -1.35], undefined, 0.08),
    tubeGrid(2, 2, 0.4, 0.15, paint.hole, [-1.05, 2.0, -1.68]),
    box(1.0, 0.1, 0.62, paint.accent, [-1.05, 2.52, -1.35]),
  );
  hardpoints.hp_lt_1 = node('hp_lt_1', [-1.05, 2.0, -1.72], locLt);
  const locations: MechRig['locations'] = { head: locHead, lt: locLt, rt: locRt };

  // Back: reactor pack with glow strip and two vent stacks.
  torsoPitch.add(
    box(2.0, 1.6, 0.9, paint.frame, [0, 1.5, 1.5], undefined, 0.12),
    box(1.5, 0.12, 0.08, paint.glow, [0, 1.3, 1.97]),
    cyl(0.17, 0.2, 1.0, 6, paint.armorDark, [-0.6, 2.7, 1.5]),
    cyl(0.17, 0.2, 1.0, 6, paint.armorDark, [0.6, 2.7, 1.5]),
  );

  // Arms.
  for (const s of [-1, 1] as const) {
    const L = s < 0 ? 'l' : 'r';
    const arm = node(`arm_${L}`, [s * 2.0, 2.0, 0], torsoPitch);
    locations[`${L}a`] = arm;
    arm.add(
      taper(1.4, 1.6, 1.8, 1.9, 0.9, paint.armor, [s * 0.1, 0.45, 0]), // pauldron
      box(1.5, 0.1, 1.2, paint.accent, [s * 0.1, 0.93, 0]),
      axle(0.4, 0.9, 8, paint.frame, [0, 0, 0]),
      box(0.85, 1.6, 0.85, paint.armorDark, [0, -0.9, 0], undefined, 0.1), // upper arm
      box(0.7, 0.7, 0.7, paint.frame, [0, -1.7, 0]), // elbow
      box(0.9, 0.9, 1.6, paint.armor, [0, -1.7, -0.9], undefined, 0.1), // forearm
    );
    if (s < 0) {
      // Left: chunky autocannon.
      arm.add(
        box(1.1, 1.1, 1.5, paint.armorDark, [0, -1.7, -2.0], undefined, 0.12),
        barrel(0.2, 2.2, 8, paint.metal, [0, -1.7, -3.65]),
        cyl(0.3, 0.3, 0.4, 8, paint.frame, [0, -1.7, -4.7], [Math.PI / 2, 0, 0]),
        box(0.12, 0.12, 1.2, paint.accent, [0, -1.12, -2.0]),
      );
      hardpoints.hp_la_1 = node('hp_la_1', [0, -1.7, -4.95], arm);
    } else {
      // Right: twin laser emitters.
      arm.add(box(0.95, 0.95, 0.8, paint.armorDark, [0, -1.7, -2.0], undefined, 0.1));
      for (const [k, dx] of [[1, -0.25], [2, 0.25]] as const) {
        arm.add(barrel(0.12, 1.4, 6, paint.metal, [dx, -1.7, -2.8]));
        arm.add(cyl(0.17, 0.17, 0.2, 6, paint.frame, [dx, -1.7, -3.5], [Math.PI / 2, 0, 0]));
        hardpoints[`hp_ra_${k}`] = node(`hp_ra_${k}`, [dx, -1.7, -3.65], arm);
      }
      arm.add(box(0.12, 0.12, 1.0, paint.accent, [0, -1.12, -1.9]));
    }
  }

  const legs = [buildLeg(-1, paint, pelvis), buildLeg(1, paint, pelvis)] as [LegRig, LegRig];
  locations.ll = legs[0].hip;
  locations.rl = legs[1].hip;
  mergeByMaterial(root, new Set([headShell, visor]));

  return {
    root,
    pelvis,
    torsoTwist,
    torsoPitch,
    cockpit,
    cockpitHide: [headShell, visor],
    legs,
    hardpoints,
    hipHeight: HIP_HEIGHT,
    height: HIP_HEIGHT + 0.9 + 3.8,
    locations,
    gait: {
      spread: 1.2,
      forward: 0.15,
      reach: 2.6,
      stride: 10.5,
      minInterval: 0.45,
      maxInterval: 0.85,
      stepHeight: 0.8,
      leapHeight: 0.7,
      bob: 0.25,
      leap: 0.55,
      sway: 0.035,
    },
  };
}

function buildLeg(side: -1 | 1, paint: Paint, pelvis: THREE.Object3D): LegRig {
  const s = side;
  const L = s < 0 ? 'l' : 'r';
  const hip = node(`hip_${L}`, [s * HIP_X, 0, 0], pelvis);
  const upper = node(`thigh_${L}`, [0, 0, 0], hip);
  upper.add(
    taper(1.0, 1.0, 1.2, 1.2, UPPER, paint.armor, [0, -UPPER / 2, 0]),
    box(0.12, 1.6, 0.9, paint.accent, [s * 0.58, -1.0, 0]),
  );

  const lower = node(`shin_${L}`, [0, -UPPER, 0], upper);
  lower.add(
    axle(0.42, 1.0, 8, paint.frame, [0, 0, 0]),
    taper(0.9, 0.7, 1.1, 0.8, 0.9, paint.armorDark, [0, 0.0, -0.55], undefined, 0, -0.05), // knee cap
    taper(0.8, 0.9, 1.1, 1.1, LOWER, paint.armor, [0, -LOWER / 2, 0]),
    taper(0.7, 0.14, 0.9, 0.2, LOWER * 0.8, paint.armorDark, [0, -LOWER / 2 - 0.1, -0.58]), // shin plate
    box(0.8, 1.2, 0.5, paint.frame, [0, -0.9, 0.7], undefined, 0.08), // calf block
  );

  const foot = node(`foot_${L}`, [0, -LOWER, 0], lower);
  const y0 = -ANKLE_H;
  const wedge: V3[] = [];
  for (const sx of [-1, 1]) {
    wedge.push(
      [sx * 0.55, y0, 0.6], [sx * 0.45, y0, -1.2], // sole
      [sx * 0.5, -0.05, 0.6], [sx * 0.45, -0.05, -0.4], [sx * 0.4, y0 + 0.2, -1.2], // top
    );
  }
  foot.add(
    axle(0.35, 0.9, 8, paint.frame, [0, 0, 0]),
    hull(wedge, paint.armorDark),
    box(0.7, 0.25, 0.7, paint.frame, [0, -0.15, 0.05]),
  );

  return { side, hip, upper, lower, foot, upperLen: UPPER, lowerLen: LOWER, tarsusLen: 0, tarsusAngle: 0, ankleHeight: ANKLE_H };
}
