import type * as THREE from 'three';
import type { HitLocation } from '../../data/chassis';

/**
 * A mech rig: rigid parts in a hierarchy, no skinning. Each bone's pivot is at
 * its joint; at rotation 0 limbs hang straight down (−Y). Positive rotation.x
 * swings a limb forward (toward −Z).
 */
export interface LegRig {
  /** +1 = right (+X), −1 = left. */
  side: 1 | -1;
  /** Hip socket (child of pelvis). rotation.z rolls the leg sideways. */
  hip: THREE.Object3D;
  /** Thigh pivot (child of hip). */
  upper: THREE.Object3D;
  /** Shin pivot, at (0, −upperLen, 0) inside `upper`. */
  lower: THREE.Object3D;
  /** Reverse-joint only: tarsus pivot at (0, −lowerLen, 0) inside `lower`. */
  tarsus?: THREE.Object3D;
  /** Ankle pivot at the end of the last segment; foot meshes hang below it. */
  foot: THREE.Object3D;
  upperLen: number;
  lowerLen: number;
  tarsusLen: number;
  /** Absolute angle of the tarsus from vertical (rad, forward-positive). */
  tarsusAngle: number;
  /** Ankle pivot height above the sole (m). */
  ankleHeight: number;
}

export interface GaitTuning {
  /** Lateral offset of each foot from the body centre (m). */
  spread: number;
  /** Neutral foot position forward of the hip socket line (m). */
  forward: number;
  /** Max forward/back offset of a *planted* foot from neutral (m): limited by leg length. */
  reach: number;
  /** Body travel per footfall (m). Long strides = a slow, heavy cadence. */
  stride: number;
  /** Fastest and slowest time between footfalls (s). */
  minInterval: number;
  maxInterval: number;
  /** Foot lift when walking (m), plus `leapHeight` at full flight. */
  stepHeight: number;
  leapHeight: number;
  /** Walking body bob, peak to peak (m). */
  bob: number;
  /** Leaping body rise, peak to peak (m): up through the flight, down into the landing. */
  leap: number;
  /** Body roll toward the stance foot (rad). */
  sway: number;
}

export interface MechRig {
  root: THREE.Group;
  pelvis: THREE.Object3D;
  /** Yaw pivot for torso twist (child of pelvis). */
  torsoTwist: THREE.Object3D;
  /** Pitch pivot (child of torsoTwist). */
  torsoPitch: THREE.Object3D;
  /** Cockpit camera mount (looks along −Z). */
  cockpit: THREE.Object3D;
  /** Meshes hidden in cockpit view (canopy, head) so they don't block the camera. */
  cockpitHide: THREE.Object3D[];
  legs: [LegRig, LegRig];
  hardpoints: Record<string, THREE.Object3D>;
  /** Nominal pelvis height above the ground when standing (m). */
  hipHeight: number;
  gait: GaitTuning;
  /** Overall height (m), for cameras. */
  height: number;
  /**
   * Root node of each hit location's parts (for damage tint, detaching limbs).
   * The centre torso is implicit: every mesh under `pelvis` not inside another location.
   */
  locations: Partial<Record<Exclude<HitLocation, 'ct'>, THREE.Object3D>>;
}
