import * as THREE from 'three';
import { solveTwoBone } from '../../core/ik';
import { angleDiff, forwardX, forwardZ } from '../../sim/angles';
import type { Mech } from '../../sim/mech';
import { Gait, type GroundFn } from './gait';
import type { LegRig, MechRig } from './rig';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _qTilt = new THREE.Quaternion();
const _n = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Renders a sim Mech: interpolates its state, drives the gait, solves leg IK. */
export class MechView {
  readonly gait: Gait;
  /** Interpolated values for cameras/HUD. */
  readonly position = new THREE.Vector3();
  legYaw = 0;
  torsoYaw = 0;
  torsoPitch = 0;
  /** Hit-reaction offsets (rad), see MechKinematics.reel*. */
  reelPitch = 0;
  reelYaw = 0;
  reelRoll = 0;
  /** Seconds since destruction (−1 while alive) — drives the collapse. */
  private deadFor = -1;
  /** Smoothed pelvis height (world y); NaN until the first frame. */
  private pelvisY = Number.NaN;

  constructor(
    readonly mech: Mech,
    readonly rig: MechRig,
    private readonly ground: GroundFn,
  ) {
    this.gait = new Gait(rig.gait);
  }

  get object(): THREE.Object3D {
    return this.rig.root;
  }

  /** @param alpha interpolation factor between the previous and current sim tick. */
  update(alpha: number, dt: number): void {
    const { prev, state } = this.mech;
    const rig = this.rig;
    const x = prev.x + (state.x - prev.x) * alpha;
    const z = prev.z + (state.z - prev.z) * alpha;
    this.legYaw = prev.legYaw + angleDiff(prev.legYaw, state.legYaw) * alpha;
    this.torsoYaw = prev.torsoYaw + angleDiff(prev.torsoYaw, state.torsoYaw) * alpha;
    this.torsoPitch = prev.torsoPitch + (state.torsoPitch - prev.torsoPitch) * alpha;
    const speed = prev.speed + (state.speed - prev.speed) * alpha;
    this.reelPitch = prev.reelPitch + (state.reelPitch - prev.reelPitch) * alpha;
    this.reelYaw = prev.reelYaw + (state.reelYaw - prev.reelYaw) * alpha;
    this.reelRoll = prev.reelRoll + (state.reelRoll - prev.reelRoll) * alpha;

    const vx = forwardX(this.legYaw) * speed;
    const vz = forwardZ(this.legYaw) * speed;
    if (this.mech.combat.alive) this.gait.update(dt, x, z, this.legYaw, vx, vz, this.mech.def.maxSpeed, this.ground);
    else this.deadFor = Math.max(0, this.deadFor) + dt;
    // Collapse: the body sags onto folding legs and pitches forward.
    const collapse = this.deadFor < 0 ? 0 : Math.min(1, this.deadFor / 1.4);
    const sag = collapse * collapse;

    // Body height follows the ground under the feet, plus bob and landing compression…
    const [fl, fr] = this.gait.feet;
    // (The ground under the feet, not the feet themselves: a lifted foot mustn't lift the body.)
    const groundY = this.ground(x, z);
    const feetY = (this.ground(fl.pos.x, fl.pos.z) + this.ground(fr.pos.x, fr.pos.z)) / 2;
    const baseY = (groundY + feetY) / 2;
    let target = baseY + rig.hipHeight + this.gait.bob - this.gait.impact * 0.6;
    // …but never so high that a planted leg can't reach its foot: on a long stride the
    // body sinks and the knees bend, like something very heavy.
    for (let i = 0; i < 2; i++) {
      const f = this.gait.feet[i]!;
      if (f.t < 0) target = Math.min(target, this.maxHipY(rig.legs[i]!, f.pos, x, z) - rig.legs[i]!.hip.position.y);
    }
    // Ease toward it: quickly down (a foot may float a few cm for a frame or two), gently
    // up (no pop when a foot lifts). The cockpit rides on this, so it must never jump.
    if (Number.isNaN(this.pelvisY)) this.pelvisY = target;
    else this.pelvisY += (target - this.pelvisY) * Math.min(1, dt * (target < this.pelvisY ? 22 : 12));
    const pelvisY = this.pelvisY - sag * rig.hipHeight * 0.45;

    rig.root.position.set(x, groundY, z);
    rig.root.rotation.set(0, this.legYaw, 0);
    rig.pelvis.position.y = pelvisY - groundY;
    rig.pelvis.rotation.z = this.gait.roll + sag * 0.12;
    // Lean into acceleration a little; slump forward when destroyed.
    rig.pelvis.rotation.x = -(state.speed - prev.speed) * 0.4 - speed * 0.004 - sag * 0.45;
    rig.torsoTwist.rotation.y = angleDiff(this.legYaw, this.torsoYaw) + this.reelYaw;
    rig.torsoPitch.rotation.x = this.torsoPitch + this.reelPitch;
    rig.torsoPitch.rotation.z = this.reelRoll;

    this.position.set(x, groundY, z);
    rig.root.updateMatrixWorld(true);
    for (let i = 0; i < 2; i++) this.solveLeg(rig.legs[i]!, this.gait.feet[i]!.pos, this.gait.feet[i]!.yaw);
  }

  /**
   * Highest world y the hip socket can be while the leg still reaches a planted sole
   * (with a little bend left over). Uses the leg's geometry: two bones plus the
   * fixed-angle tarsus, in the leg's sagittal plane after the sideways hip roll.
   */
  private maxHipY(leg: LegRig, sole: THREE.Vector3, x: number, z: number): number {
    const c = Math.cos(this.legYaw);
    const s = Math.sin(this.legYaw);
    const hx = leg.hip.position.x;
    const hz = leg.hip.position.z;
    // Sole relative to the hip socket, in the legs' frame (forward = −Z).
    const dx = sole.x - (x + hx * c + hz * s);
    const dz = sole.z - (z - hx * s + hz * c);
    const lat = dx * c - dz * s;
    const fwd = dx * s + dz * c;
    const tf = leg.tarsus ? Math.sin(leg.tarsusAngle) * leg.tarsusLen : 0;
    const td = leg.tarsus ? Math.cos(leg.tarsusAngle) * leg.tarsusLen : 0;
    const L = (leg.upperLen + leg.lowerLen) * 0.97;
    const f = -fwd - tf;
    const down = td + Math.sqrt(Math.max(0, L * L - f * f));
    return sole.y + leg.ankleHeight + Math.sqrt(Math.max(0, down * down - lat * lat));
  }

  /** Two-bone IK (plus optional fixed-angle tarsus) to put the sole at `sole`. */
  private solveLeg(leg: LegRig, sole: THREE.Vector3, footYaw: number): void {
    const hip = leg.hip;
    const parent = hip.parent!;
    // Ankle target in the hip's parent space, relative to the hip socket.
    _v.set(sole.x, sole.y + leg.ankleHeight, sole.z);
    parent.worldToLocal(_v).sub(hip.position);

    hip.rotation.z = Math.atan2(_v.x, -_v.y);
    const down = Math.hypot(_v.x, _v.y);
    const fwd = -_v.z;

    let tf = fwd;
    let td = down;
    if (leg.tarsus) {
      tf -= Math.sin(leg.tarsusAngle) * leg.tarsusLen;
      td -= Math.cos(leg.tarsusAngle) * leg.tarsusLen;
    }
    const sol = solveTwoBone(tf, td, leg.upperLen, leg.lowerLen);
    leg.upper.rotation.x = sol.upper;
    leg.lower.rotation.x = sol.lower - sol.upper;
    if (leg.tarsus) leg.tarsus.rotation.x = leg.tarsusAngle - sol.lower;

    // Orient the foot: yaw from the gait, tilted to the ground normal.
    const g = this.ground;
    const e = 1.5;
    _n.set(g(sole.x - e, sole.z) - g(sole.x + e, sole.z), 2 * e, g(sole.x, sole.z - e) - g(sole.x, sole.z + e)).normalize();
    _qTilt.setFromUnitVectors(UP, _n);
    _qYaw.setFromAxisAngle(Y_AXIS, footYaw);
    const desired = _qTilt.multiply(_qYaw);
    leg.foot.parent!.updateWorldMatrix(true, false);
    leg.foot.parent!.getWorldQuaternion(_q);
    leg.foot.quaternion.copy(_q.invert().multiply(desired));
  }
}
