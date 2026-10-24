import type { ChassisDef } from '../data/chassis';
import { angleDiff, approach, approachAngle, clamp, forwardX, forwardZ, wrapAngle } from './angles';
import { MechCombat } from './combat/mechCombat';
import type { HeightField } from './terrain';

/** Per-tick control intent. Plain data so it can come from input, AI or the network. */
export interface MechCommand {
  /** Movement relative to the aim direction: x = right, z = forward. Each -1..1. */
  moveX: number;
  moveZ: number;
  /** Desired world aim (rad). Yaw 0 faces −Z; pitch > 0 looks up. */
  aimYaw: number;
  aimPitch: number;
  /** Bitmask of weapon groups whose trigger is held (bit 0 = group 1). */
  fire: number;
  /** Alpha strike: fire every ready weapon. */
  alpha: boolean;
  /** Selected target mech id (0 = none). */
  targetId: number;
  /** Shutdown override engaged. */
  override: boolean;
  /** Edge-triggered: true for exactly one tick to use a coolant charge. */
  coolant: boolean;
}

/** Distance ahead (m) over which the climbable grade is measured. */
const LOOKAHEAD = 4;

export const IDLE_COMMAND: MechCommand = {
  moveX: 0, moveZ: 0, aimYaw: 0, aimPitch: 0, fire: 0, alpha: false, targetId: 0, override: false, coolant: false,
};

/** Serializable kinematic state. */
export interface MechKinematics {
  x: number;
  y: number;
  z: number;
  legYaw: number;
  /** World yaw of the torso. */
  torsoYaw: number;
  torsoPitch: number;
  /** Signed speed along the legs' forward (m/s); negative = walking backward. */
  speed: number;
  /** Total distance walked (m). */
  odometer: number;
  /**
   * Hit reaction: the torso knocked off its aim (rad), springing back. Added on
   * top of torsoYaw/torsoPitch for the visuals and for where the weapons point.
   * Pitch > 0 = reeled back (nose up), yaw > 0 = twisted left, roll > 0 = leaning left.
   */
  reelPitch: number;
  reelYaw: number;
  reelRoll: number;
  reelVPitch: number;
  reelVYaw: number;
  reelVRoll: number;
  /** Knockback velocity (m/s, world), decaying. */
  knockX: number;
  knockZ: number;
}

/** Reel spring: stiffness (1/s²) and damping (1/s) — underdamped, so a hard hit overshoots a little. */
const REEL_K = 70;
const REEL_C = 10;
const REEL_MAX = 0.3;
const KNOCK_DECAY = 5;

export function copyKinematics(src: MechKinematics, dst: MechKinematics): MechKinematics {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
  dst.legYaw = src.legYaw;
  dst.torsoYaw = src.torsoYaw;
  dst.torsoPitch = src.torsoPitch;
  dst.speed = src.speed;
  dst.odometer = src.odometer;
  dst.reelPitch = src.reelPitch;
  dst.reelYaw = src.reelYaw;
  dst.reelRoll = src.reelRoll;
  dst.reelVPitch = src.reelVPitch;
  dst.reelVYaw = src.reelVYaw;
  dst.reelVRoll = src.reelVRoll;
  dst.knockX = src.knockX;
  dst.knockZ = src.knockZ;
  return dst;
}

export class Mech {
  readonly state: MechKinematics;
  /** State at the start of the last tick — the renderer interpolates prev → state. */
  readonly prev: MechKinematics;
  command: MechCommand = { ...IDLE_COMMAND };
  readonly combat: MechCombat;

  constructor(
    readonly id: number,
    readonly def: ChassisDef,
    x: number,
    z: number,
    yaw: number,
    terrain: HeightField,
    readonly team = 0,
  ) {
    this.combat = new MechCombat(def);
    this.state = {
      x, y: terrain.heightAt(x, z), z, legYaw: yaw, torsoYaw: yaw, torsoPitch: 0, speed: 0, odometer: 0,
      reelPitch: 0, reelYaw: 0, reelRoll: 0, reelVPitch: 0, reelVYaw: 0, reelVRoll: 0, knockX: 0, knockZ: 0,
    };
    this.prev = copyKinematics(this.state, {} as MechKinematics);
    this.command.aimYaw = yaw;
  }

  /** Twist of the torso relative to the legs (rad). */
  get twist(): number {
    return angleDiff(this.state.legYaw, this.state.torsoYaw);
  }

  /**
   * Hit reaction. (fx, fz): unit horizontal direction the hit pushes. `side`: which
   * side of the torso was struck (−1 left, +1 right, 0 centre); `low`: a leg hit.
   * `jolt` (rad/s) kicks the torso off its aim; `shove` (m/s) knocks the mech back.
   * Both are for a 50 t mech and scale down with tonnage.
   */
  hitReaction(fx: number, fz: number, side: number, low: boolean, jolt: number, shove: number): void {
    const s = this.state;
    const mass = this.def.tonnage / 50;
    const j = jolt / mass;
    // The push in the torso's frame: `back` > 0 when hit from the front, `right` > 0 when pushed rightward.
    const back = -(fx * forwardX(s.torsoYaw) + fz * forwardZ(s.torsoYaw));
    const right = fx * Math.cos(s.torsoYaw) - fz * Math.sin(s.torsoYaw);
    s.reelVPitch += j * back * (low ? 0.5 : 1);
    s.reelVYaw += j * back * -side * 0.5;
    s.reelVRoll -= j * right * 0.6;
    s.knockX += (fx * shove) / mass;
    s.knockZ += (fz * shove) / mass;
  }

  private stepReel(dt: number, terrain: HeightField): void {
    const s = this.state;
    s.reelVPitch += (-REEL_K * s.reelPitch - REEL_C * s.reelVPitch) * dt;
    s.reelVYaw += (-REEL_K * s.reelYaw - REEL_C * s.reelVYaw) * dt;
    s.reelVRoll += (-REEL_K * s.reelRoll - REEL_C * s.reelVRoll) * dt;
    s.reelPitch = clamp(s.reelPitch + s.reelVPitch * dt, -REEL_MAX, REEL_MAX);
    s.reelYaw = clamp(s.reelYaw + s.reelVYaw * dt, -REEL_MAX, REEL_MAX);
    s.reelRoll = clamp(s.reelRoll + s.reelVRoll * dt, -REEL_MAX, REEL_MAX);

    const k = Math.hypot(s.knockX, s.knockZ);
    if (k < 1e-3) {
      s.knockX = s.knockZ = 0;
      return;
    }
    // Knockback slides the mech, but never up a cliff or off the map.
    const nx = s.x + s.knockX * dt;
    const nz = s.z + s.knockZ * dt;
    const lim = terrain.halfSize - 50;
    const grade = (terrain.heightAt(s.x + (s.knockX / k) * LOOKAHEAD, s.z + (s.knockZ / k) * LOOKAHEAD) - s.y) / LOOKAHEAD;
    if (grade <= this.def.maxGrade && Math.abs(nx) <= lim && Math.abs(nz) <= lim) {
      s.x = nx;
      s.z = nz;
    }
    const decay = Math.exp(-KNOCK_DECAY * dt);
    s.knockX *= decay;
    s.knockZ *= decay;
  }

  step(dt: number, terrain: HeightField): void {
    const s = this.state;
    const d = this.def;
    copyKinematics(s, this.prev);
    // Dead or shut down: no control — coast to a stop.
    const disabled = !this.combat.alive || this.combat.shutdown;
    const cmd = disabled ? { ...IDLE_COMMAND, aimYaw: s.torsoYaw, aimPitch: s.torsoPitch } : this.command;
    if (!this.combat.alive) {
      s.speed = 0;
      return;
    }
    this.stepReel(dt, terrain);

    // Torso tracks the aim at its twist rate, limited relative to the legs.
    s.torsoYaw = approachAngle(s.torsoYaw, cmd.aimYaw, d.twistRate * dt);
    s.torsoPitch = approach(s.torsoPitch, clamp(cmd.aimPitch, d.pitchMin, d.pitchMax), d.twistRate * 0.6 * dt);

    // Movement intent relative to the aim direction.
    const mag = Math.min(1, Math.hypot(cmd.moveX, cmd.moveZ));
    let legTarget = s.legYaw;
    let targetSpeed = 0;
    const maxSpeed = d.maxSpeed * this.combat.speedFactor();
    if (mag > 0.05) {
      const moveYaw = cmd.aimYaw + Math.atan2(-cmd.moveX, cmd.moveZ);
      if (cmd.moveZ < -0.05) {
        // Backing up: keep facing roughly the aim, walk in reverse.
        legTarget = wrapAngle(moveYaw + Math.PI);
        targetSpeed = -mag * maxSpeed * d.reverseFactor;
      } else {
        legTarget = moveYaw;
        targetSpeed = mag * maxSpeed;
      }
    } else if (Math.abs(this.twist) > d.twistLimit * 0.85) {
      legTarget = s.torsoYaw; // turn in place to relieve the twist
    }
    s.legYaw = approachAngle(s.legYaw, legTarget, d.legTurnRate * dt);

    // Don't stride sideways: scale speed by how well the legs face the target heading.
    const facing = Math.cos(angleDiff(s.legYaw, legTarget));
    targetSpeed *= Math.max(0, facing);
    const rate = Math.abs(targetSpeed) > Math.abs(s.speed) && Math.sign(targetSpeed) !== -Math.sign(s.speed) ? d.accel : d.decel;
    s.speed = approach(s.speed, targetSpeed, rate * dt);

    // Re-apply the twist limit now that the legs moved.
    const tw = angleDiff(s.legYaw, s.torsoYaw);
    if (Math.abs(tw) > d.twistLimit) s.torsoYaw = wrapAngle(s.legYaw + Math.sign(tw) * d.twistLimit);

    // Move, with slope limits. The grade is judged over a stride-sized look-ahead so
    // mechs step over small bumps (dune crests, wash edges) but stop at real cliffs.
    if (s.speed !== 0) {
      const dist = s.speed * dt;
      const dirSign = Math.sign(s.speed);
      const fx = forwardX(s.legYaw) * dirSign;
      const fz = forwardZ(s.legYaw) * dirSign;
      const nx = s.x + fx * Math.abs(dist);
      const nz = s.z + fz * Math.abs(dist);
      const lim = terrain.halfSize - 50;
      const grade = (terrain.heightAt(s.x + fx * LOOKAHEAD, s.z + fz * LOOKAHEAD) - s.y) / LOOKAHEAD;
      if (grade > d.maxGrade || Math.abs(nx) > lim || Math.abs(nz) > lim) {
        s.speed = 0; // blocked by a cliff or the map edge
      } else {
        // Uphill slows, downhill speeds up slightly.
        const slope = clamp(1 - grade * 0.5, 0.55, 1.15);
        s.x = s.x + (nx - s.x) * slope;
        s.z = s.z + (nz - s.z) * slope;
        s.odometer += Math.abs(dist * slope);
      }
    }
    s.y = terrain.heightAt(s.x, s.z);
  }
}
