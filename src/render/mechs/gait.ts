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
  /** Lift-off speed of the swing curve (0 = ease in from rest; ~1 = leaves at body speed). */
  launch: number;
  /** A stride while moving (re-timed to the current speed), not a standing shuffle. */
  paced: boolean;
}

/**
 * Procedural stepping with a giant's cadence. While moving, feet alternate on a
 * fixed beat (`interval`, from the stride length). A planted foot can only stay
 * down while the body passes over it within `reach`, so at speed each swing
 * outlasts the beat: both feet are briefly airborne and the mech bounds from
 * foot to foot in long, slow leaps instead of shuffling quickly. Landing spots
 * lead the body by half the stance, so the body passes over the planted foot
 * and nothing slides. Visual only; the sim never depends on it.
 */
export class Gait {
  readonly feet: [Foot, Foot];
  /** Body offsets for the renderer. */
  bob = 0;
  roll = 0;
  /** Spring for footfall impacts (m, downward positive). */
  impact = 0;
  /** 0..1: how much of each beat is spent with both feet in the air. */
  flight = 0;
  private impactVel = 0;
  private last = 1;
  /** Seconds since the current beat started (a foot lifted off). */
  private beat = 0;
  private interval = 1;
  private swing = 1;
  private moving = false;
  private initialized = false;
  /** Called on each footfall with the foot index and strength 0..1. */
  onFootfall: ((foot: number, strength: number) => void) | null = null;

  constructor(private readonly tune: GaitTuning) {
    const mk = (): Foot => ({ pos: new THREE.Vector3(), yaw: 0, from: new THREE.Vector3(), fromYaw: 0, t: -1, duration: 1, launch: 0, paced: false });
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
    const moving = speed > 0.6;
    // Cadence: one footfall per `stride` metres, within the chassis' tempo limits.
    const interval = THREE.MathUtils.clamp(tune.stride / Math.max(speed, 0.01), tune.minInterval, tune.maxInterval);
    // A foot can stay planted only while the body travels ±reach over it; the rest of
    // its two-beat cycle is swing. Swing longer than one beat = a flight phase.
    const maxStance = (2 * tune.reach * 0.9) / Math.max(speed, 0.01);
    const swing = Math.min(Math.max(interval * 0.8, 2 * interval - maxStance), 2 * interval - 0.08);
    const stance = 2 * interval - swing;
    this.interval = interval;
    this.swing = swing;

    const landing = (i: number, remaining: number, out: THREE.Vector3): THREE.Vector3 => {
      this.neutral(i, x + vx * remaining, z + vz * remaining, yaw, out);
      out.x += vx * stance * 0.5;
      out.z += vz * stance * 0.5;
      out.y = ground(out.x, out.z);
      return out;
    };
    const lift = (i: number, duration: number, launch: number, paced: boolean): void => {
      const f = this.feet[i]!;
      f.from.copy(f.pos);
      f.fromYaw = f.yaw;
      f.t = 0;
      f.duration = duration;
      f.launch = launch;
      f.paced = paced;
      this.last = i;
      this.beat = 0;
    };

    this.beat += dt;
    if (moving && !this.moving) this.beat = interval; // set off straight away
    this.moving = moving;
    if (moving) {
      // On the beat, the other foot pushes off (once it has landed) — or sooner if the
      // body has already carried it to the end of its reach, as when accelerating
      // hard out of a slow walk. Otherwise the leg would be left stretched far behind.
      const next = 1 - this.last;
      const f = this.feet[next]!;
      if (f.t < 0) {
        this.neutral(next, x, z, yaw, tmp);
        const trail = ((tmp.x - f.pos.x) * vx + (tmp.z - f.pos.z) * vz) / speed;
        if (this.beat >= interval || trail > tune.reach * 0.9) lift(next, swing, Math.min(1.2, swing / (2 * interval)), true);
      }
    } else if (this.feet.every((f) => f.t < 0)) {
      // Standing: reposition whichever foot lags most (turning in place, stopping).
      const err = this.feet.map((f, i) => landing(i, 0, tmp).distanceTo(f.pos) + Math.abs(angleDelta(f.yaw, yaw)) * 2);
      if (Math.max(err[0]!, err[1]!) > 0.7) lift(err[0]! > err[1]! ? 0 : 1, tune.maxInterval * 0.8, 0, false);
    }

    for (let i = 0; i < 2; i++) {
      const f = this.feet[i]!;
      if (f.t < 0) continue;
      // Strides in flight follow speed changes, so a swing launched at a walk doesn't
      // drag on once the mech is running.
      if (f.paced && moving) f.duration = swing;
      f.t = Math.min(1, f.t + dt / f.duration);
      const target = landing(i, (1 - f.t) * f.duration, tmp);
      const e = swingCurve(f.t, f.launch);
      f.pos.lerpVectors(f.from, target, e);
      // Higher lift for longer strides.
      const height = tune.stepHeight * (0.5 + 0.5 * speedFrac) + tune.leapHeight * this.flight;
      f.pos.y = THREE.MathUtils.lerp(f.from.y, target.y, e) + Math.sin(Math.PI * f.t) * height;
      f.yaw = f.fromYaw + angleDelta(f.fromYaw, yaw) * e;
      if (f.t >= 1) {
        f.t = -1;
        f.pos.copy(target);
        f.yaw = yaw;
        // Landing from a leap hits much harder than a walking step.
        const strength = Math.min(1, 0.2 + 0.5 * speedFrac + 0.6 * this.flight);
        this.impactVel += strength * 3.5;
        this.onFootfall?.(i, strength);
      }
    }

    // Flight fraction of each beat (0 while walking), smoothed so the blend never pops.
    const flightTarget = moving ? THREE.MathUtils.clamp((swing - interval) / interval, 0, 1) : 0;
    this.flight += (flightTarget - this.flight) * Math.min(1, dt * 4);

    // Body motion. Walking: highest mid-swing (vaulting over the stance leg). Leaping:
    // highest mid-flight, sinking into the landing. Blend the two by flight.
    // A small phase lead offsets the smoothing below and the renderer's, so the body
    // is already sinking when the foot lands.
    const u = ((this.beat + 0.08) / this.interval) % 1;
    const sw = this.swing / this.interval;
    const k = THREE.MathUtils.smoothstep(this.flight, 0, 0.25);
    const walkBob = Math.cos(2 * Math.PI * (u - sw / 2)) * tune.bob * 0.5 * speedFrac;
    const leapBob = Math.cos(2 * Math.PI * (u - (sw - 1) / 2)) * tune.leap * 0.5;
    const targetBob = moving ? (1 - k) * walkBob + k * leapBob : 0;
    this.bob += (targetBob - this.bob) * Math.min(1, dt * 16);
    // Roll toward the single planted foot.
    const planted = this.feet.map((f) => f.t < 0);
    const stanceSide = planted[0] && !planted[1] ? -1 : planted[1] && !planted[0] ? 1 : 0;
    const targetRoll = stanceSide * tune.sway * (0.4 + 0.6 * speedFrac);
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 5);

    // Damped spring for footfall impacts: low and slow, like a lot of mass settling.
    const kSpring = 55;
    const c = 10;
    this.impactVel += (-kSpring * this.impact - c * this.impactVel) * dt;
    this.impact += this.impactVel * dt;
  }
}

/**
 * Horizontal progress of a swing: Hermite curve from 0 to 1 that leaves with
 * slope `launch` (so a running foot doesn't stall behind the body) and lands
 * with zero velocity (no skid at touchdown).
 */
function swingCurve(t: number, launch: number): number {
  return launch * t + (3 - 2 * launch) * t * t + (launch - 2) * t * t * t;
}

function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
