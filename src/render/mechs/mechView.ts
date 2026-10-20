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
  /** Seconds since destruction (−1 while alive) — drives the collapse. */
  private deadFor = -1;

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

    const vx = forwardX(this.legYaw) * speed;
    const vz = forwardZ(this.legYaw) * speed;
    if (this.mech.combat.alive) this.gait.update(dt, x, z, this.legYaw, vx, vz, this.mech.def.maxSpeed, this.ground);
    else this.deadFor = Math.max(0, this.deadFor) + dt;
    // Collapse: the body sags onto folding legs and pitches forward.
    const collapse = this.deadFor < 0 ? 0 : Math.min(1, this.deadFor / 1.4);
    const sag = collapse * collapse;

    // Body height follows the feet (so it never over-stretches the legs), plus bob/impact.
    const [fl, fr] = this.gait.feet;
    const groundY = this.ground(x, z);
    const feetY = (fl.pos.y + fr.pos.y) / 2;
    const baseY = Math.min(groundY, feetY) * 0.5 + Math.max(groundY, feetY) * 0.5;
    const maxY = Math.min(fl.pos.y, fr.pos.y) + rig.hipHeight * 1.06;
    const pelvisY = Math.min(baseY + rig.hipHeight + this.gait.bob - this.gait.impact * 0.35, maxY) - sag * rig.hipHeight * 0.45;

    rig.root.position.set(x, groundY, z);
    rig.root.rotation.set(0, this.legYaw, 0);
    rig.pelvis.position.y = pelvisY - groundY;
    rig.pelvis.rotation.z = this.gait.roll + sag * 0.12;
    // Lean into acceleration a little; slump forward when destroyed.
    rig.pelvis.rotation.x = -(state.speed - prev.speed) * 0.4 - speed * 0.004 - sag * 0.45;
    rig.torsoTwist.rotation.y = angleDiff(this.legYaw, this.torsoYaw);
    rig.torsoPitch.rotation.x = this.torsoPitch;

    this.position.set(x, groundY, z);
    rig.root.updateMatrixWorld(true);
    for (let i = 0; i < 2; i++) this.solveLeg(rig.legs[i]!, this.gait.feet[i]!.pos, this.gait.feet[i]!.yaw);
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
