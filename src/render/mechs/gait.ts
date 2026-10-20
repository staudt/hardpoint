import * as THREE from 'three';
import type { GaitTuning } from './rig';

export type GroundFn = (x: number, z: number) => number;

interface Foot {
  /** Sole position on the ground (world). */
  pos: THREE.Vector3;
  yaw: number;
  from: THREE.Vector3;
  fromYaw: number;
  /** Step progress 0..1, or −1 when planted. */
  t: number;
  duration: number;
}

/**
 * Procedural stepping: feet stay planted in world space and step (alternating)
 * when they lag their neutral spot. Landing spots lead the body by half a
 * stride so the body passes over the planted foot — no foot sliding.
 * Visual only; the sim never depends on it.
 */
export class Gait {
  readonly feet: [Foot, Foot];
  /** Body offsets for the renderer. */
  bob = 0;
  roll = 0;
  /** Spring for footfall impacts (m, downward positive). */
  impact = 0;
  private impactVel = 0;
  private last = 1;
  private initialized = false;
  /** Called on each footfall with the foot index and strength 0..1. */
  onFootfall: ((foot: number, strength: number) => void) | null = null;

  constructor(private readonly tune: GaitTuning) {
    const mk = (): Foot => ({ pos: new THREE.Vector3(), yaw: 0, from: new THREE.Vector3(), fromYaw: 0, t: -1, duration: 1 });
    this.feet = [mk(), mk()];
  }

  /** Neutral sole position for foot i given the body pose. side: 0 = left, 1 = right. */
  private neutral(i: number, x: number, z: number, yaw: number, out: THREE.Vector3): THREE.Vector3 {
    const side = i === 0 ? -1 : 1;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // Local (side*spread, 0, −forward) rotated by yaw.
    const lx = side * this.tune.spread;
    const lz = -this.tune.forward;
    return out.set(x + lx * c + lz * s, 0, z - lx * s + lz * c);
  }

  update(dt: number, x: number, z: number, yaw: number, vx: number, vz: number, maxSpeed: number, ground: GroundFn): void {
    const tune = this.tune;
    const tmp = new THREE.Vector3();
    if (!this.initialized) {
      this.feet.forEach((f, i) => {
        this.neutral(i, x, z, yaw, f.pos);
        f.pos.y = ground(f.pos.x, f.pos.z);
        f.yaw = yaw;
      });
      this.initialized = true;
    }

    const speed = Math.hypot(vx, vz);
    const speedFrac = Math.min(1, speed / Math.max(maxSpeed, 0.01));
    // Foot oscillates ±0.5·v·T around neutral, so T ≤ 2·reach / v.
    const stepTime = THREE.MathUtils.clamp((1.8 * tune.reach) / Math.max(speed, 0.01), tune.minStepTime, tune.maxStepTime);

    const landing = (i: number, remaining: number, out: THREE.Vector3): THREE.Vector3 => {
      this.neutral(i, x + vx * remaining, z + vz * remaining, yaw, out);
      out.x += vx * stepTime * 0.5;
      out.z += vz * stepTime * 0.5;
      out.y = ground(out.x, out.z);
      return out;
    };

    const stepping = this.feet.findIndex((f) => f.t >= 0);
    if (stepping === -1) {
      // Choose who steps: alternate while walking; otherwise whoever lags most.
      const err = this.feet.map((f, i) => landing(i, stepTime, tmp).distanceTo(f.pos) + Math.abs(angleDelta(f.yaw, yaw)) * 2);
      const alt = 1 - this.last;
      let pick = -1;
      if (speed > 0.6 && err[alt]! > 0.2) pick = alt;
      else if (Math.max(err[0]!, err[1]!) > 0.7) pick = err[0]! > err[1]! ? 0 : 1;
      if (pick >= 0) {
        const f = this.feet[pick]!;
        f.from.copy(f.pos);
        f.fromYaw = f.yaw;
        f.t = 0;
        f.duration = stepTime;
      }
    }

    for (let i = 0; i < 2; i++) {
      const f = this.feet[i]!;
      if (f.t < 0) continue;
      f.t = Math.min(1, f.t + dt / f.duration);
      const target = landing(i, (1 - f.t) * f.duration, tmp);
      const e = easeInOut(f.t);
      f.pos.lerpVectors(f.from, target, e);
      f.pos.y = THREE.MathUtils.lerp(f.from.y, target.y, e) + Math.sin(Math.PI * f.t) * tune.stepHeight * (0.5 + 0.5 * speedFrac);
      f.yaw = f.fromYaw + angleDelta(f.fromYaw, yaw) * e;
      if (f.t >= 1) {
        f.t = -1;
        f.pos.copy(target);
        f.yaw = yaw;
        this.last = i;
        const strength = 0.25 + 0.75 * speedFrac;
        this.impactVel += strength * 2.2;
        this.onFootfall?.(i, strength);
      }
    }

    // Body motion: rise mid-step, settle at footfall; roll toward the stance foot.
    const active = this.feet.findIndex((f) => f.t >= 0);
    const phase = active >= 0 ? Math.sin(Math.PI * this.feet[active]!.t) : 0;
    const targetBob = (phase - 0.5) * tune.bob * speedFrac;
    this.bob += (targetBob - this.bob) * Math.min(1, dt * 12);
    const targetRoll = active >= 0 ? (active === 1 ? 1 : -1) * phase * tune.sway * (0.4 + 0.6 * speedFrac) : 0;
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 8);

    // Damped spring for footfall impact (critically-ish damped).
    const k = 120;
    const c = 16;
    this.impactVel += (-k * this.impact - c * this.impactVel) * dt;
    this.impact += this.impactVel * dt;
  }
}

function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
