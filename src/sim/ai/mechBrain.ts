import { angleDiff, DEG } from '../angles';
import { MAX_GROUPS } from '../combat/mechCombat';
import { IDLE_COMMAND, type Mech, type MechCommand } from '../mech';
import type { NavPoint } from '../nav/navGrid';
import { Rng } from '../rng';
import { dirFromAngles, dist3, normalize3, set3, v3 } from '../vec';
import type { World } from '../world';

export interface BrainProfile {
  /** 0..1: aim accuracy and reaction. */
  skill: number;
  /** Heat fraction the pilot won't fire past. */
  heatLimit: number;
  /** Uses coolant when running hot. */
  usesCoolant: boolean;
}

export const PILOTS = {
  green: { skill: 0.3, heatLimit: 0.72, usesCoolant: false },
  regular: { skill: 0.55, heatLimit: 0.8, usesCoolant: true },
  veteran: { skill: 0.8, heatLimit: 0.88, usesCoolant: true },
} satisfies Record<string, BrainProfile>;
export type PilotRank = keyof typeof PILOTS;

const THINK_INTERVAL = 0.4;
/** Straight-line distance (m) that must be walkable to skip pathfinding. */
const LOOK_CLEAR = 25;
const _eye = v3();
const _d = v3();
const _aim = v3();

/**
 * Combat AI for one mech. Deterministic: all randomness from its own Rng.
 * Produces the same MechCommand the player does — no cheating on movement,
 * heat or weapons. It knows enemy positions (radar) but only shoots with LOS.
 */
export class MechBrain {
  targetId = 0;
  readonly preferredRange: number;
  private readonly rng: Rng;
  private thinkTimer = 0;
  private strafeDir = 1;
  private strafeTimer = 0;
  private stuckTimer = 0;
  private detourYaw = 0;
  private detourTimer = 0;
  private path: NavPoint[] = [];
  private pathGoal: NavPoint | null = null;
  private repathTimer = 0;
  private trackTime = 0;
  private errYaw = 0;
  private errPitch = 0;
  private errTimer = 0;
  private coolantCooldown = 0;
  private aimYaw: number;
  private aimPitch = 0;

  constructor(
    readonly mech: Mech,
    readonly profile: BrainProfile,
    seed: number,
  ) {
    this.rng = new Rng(seed);
    this.aimYaw = mech.state.torsoYaw;
    this.preferredRange = preferredRange(mech);
    this.strafeDir = this.rng.next() < 0.5 ? -1 : 1;
  }

  think(world: World, dt: number): MechCommand {
    const me = this.mech;
    if (!me.combat.alive) return { ...IDLE_COMMAND };
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = THINK_INTERVAL;
      this.pickTarget(world);
    }
    const target = world.getMech(this.targetId);
    if (!target || !target.combat.alive) return { ...IDLE_COMMAND, aimYaw: this.aimYaw, aimPitch: this.aimPitch };

    const s = me.state;
    const t = target.state;
    const dx = t.x - s.x;
    const dz = t.z - s.z;
    const dist = Math.hypot(dx, dz);

    // ---- movement: close to preferred range, then circle-strafe
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeDir = this.rng.next() < 0.5 ? -1 : 1;
      this.strafeTimer = this.rng.range(3, 7);
    }
    const rx = dx / (dist || 1);
    const rz = dz / (dist || 1);
    const pref = this.preferredRange;
    const radial = dist > pref * 1.15 ? 1 : dist < pref * 0.7 ? -0.8 : (dist - pref) / pref;
    const tangential = dist < pref * 1.4 ? 0.8 : 0.25;
    let mx = rx * radial + -rz * tangential * this.strafeDir;
    let mz = rz * radial + rx * tangential * this.strafeDir;
    const mlen = Math.hypot(mx, mz) || 1;
    mx /= mlen;
    mz /= mlen;
    // Goal: a point on the preferred-range ring, swung toward our strafe side.
    const ring = Math.atan2(s.x - t.x, s.z - t.z) + this.strafeDir * 0.4;
    const goal = { x: t.x + Math.sin(ring) * pref, z: t.z + Math.cos(ring) * pref };
    const moveYaw = this.navigate(world, Math.atan2(-mx, -mz), goal, dt);

    // ---- aim: lead the target, with skill-based error that shrinks while tracking
    const lead = this.leadTime(dist);
    const tv = target.state.speed;
    const tvx = -Math.sin(target.state.legYaw) * tv;
    const tvz = -Math.cos(target.state.legYaw) * tv;
    set3(_eye, s.x, s.y + me.def.eyeHeight, s.z);
    set3(_aim, t.x + tvx * lead, t.y + target.def.eyeHeight * 0.75, t.z + tvz * lead);
    this.trackTime += dt;
    this.errTimer -= dt;
    if (this.errTimer <= 0) {
      this.errTimer = 0.35;
      const spread = (1 - this.profile.skill) * 0.07 * (0.5 + Math.min(1, Math.abs(tv) / 15)) / (1 + this.trackTime * 0.4);
      this.errYaw = this.rng.range(-spread, spread);
      this.errPitch = this.rng.range(-spread, spread) * 0.5;
    }
    const adx = _aim.x - _eye.x;
    const ady = _aim.y - _eye.y;
    const adz = _aim.z - _eye.z;
    this.aimYaw = Math.atan2(-adx, -adz) + this.errYaw;
    this.aimPitch = Math.atan2(ady, Math.hypot(adx, adz)) + this.errPitch;

    // Convert world move direction to aim-relative input.
    const rel = angleDiff(this.aimYaw, moveYaw);
    const cmd: MechCommand = {
      ...IDLE_COMMAND,
      moveZ: Math.cos(rel),
      moveX: -Math.sin(rel),
      aimYaw: this.aimYaw,
      aimPitch: this.aimPitch,
      targetId: target.id,
    };

    // ---- weapons
    cmd.fire = this.chooseFire(world, target, dist);
    const c = me.combat;
    this.coolantCooldown -= dt;
    if (this.profile.usesCoolant && c.coolant > 0 && c.heatFrac > 0.86 && this.coolantCooldown <= 0) {
      cmd.coolant = true;
      this.coolantCooldown = 5;
    }
    return cmd;
  }

  private pickTarget(world: World): void {
    const me = this.mech;
    const cur = world.getMech(this.targetId);
    const enemies = world.mechs.filter((m) => m.team !== me.team && m.combat.alive);
    if (enemies.length === 0) {
      this.targetId = 0;
      return;
    }
    const d = (m: Mech): number => Math.hypot(m.state.x - me.state.x, m.state.z - me.state.z);
    const nearest = enemies.reduce((a, b) => (d(a) <= d(b) ? a : b));
    // Sticky targeting: only switch if something is much closer.
    if (!cur || !cur.combat.alive || d(nearest) < d(cur) * 0.6) {
      if (nearest.id !== this.targetId) this.trackTime = 0;
      this.targetId = nearest.id;
    }
  }

  /**
   * Turn a desired heading into a walkable one: go straight if the next stretch
   * is clear on the nav grid, otherwise follow an A* path toward `goal`.
   * A random detour is the last resort when physically stuck.
   */
  private navigate(world: World, yaw: number, goal: NavPoint, dt: number): number {
    const me = this.mech;
    const s = me.state;
    const nav = world.nav;
    const grade = me.def.maxGrade * 0.8;
    const here = { x: s.x, z: s.z };
    const ahead = { x: s.x - Math.sin(yaw) * LOOK_CLEAR, z: s.z - Math.cos(yaw) * LOOK_CLEAR };
    let chosen = yaw;
    this.repathTimer -= dt;
    if (nav.clearLine(here, ahead, grade)) {
      this.path = [];
    } else {
      const goalMoved = this.pathGoal ? Math.hypot(goal.x - this.pathGoal.x, goal.z - this.pathGoal.z) > 60 : true;
      if (this.path.length === 0 || this.repathTimer <= 0 || goalMoved) {
        this.path = nav.findPath(here, goal, grade);
        this.pathGoal = goal;
        this.repathTimer = 3;
      }
      while (this.path.length > 1 && Math.hypot(this.path[0]!.x - s.x, this.path[0]!.z - s.z) < 12) this.path.shift();
      const wp = this.path[0];
      if (wp) chosen = Math.atan2(-(wp.x - s.x), -(wp.z - s.z));
    }

    if (this.detourTimer > 0) {
      this.detourTimer -= dt;
      chosen += this.detourYaw;
    }
    // Stuck detection: wanted to move but barely moving.
    if (Math.abs(s.speed) < 1) this.stuckTimer += dt;
    else this.stuckTimer = 0;
    if (this.stuckTimer > 2.5 && this.detourTimer <= 0) {
      this.detourYaw = this.rng.range(60, 120) * DEG * (this.rng.next() < 0.5 ? -1 : 1);
      this.detourTimer = 2;
      this.stuckTimer = 0;
      this.repathTimer = 0;
    }
    return chosen;
  }

  /** Lead time for the slowest ready projectile weapon (beams don't need lead). */
  private leadTime(dist: number): number {
    let speed = Infinity;
    for (const w of this.mech.combat.weapons) {
      if (w.destroyed || w.ammo <= 0 || w.def.delivery === 'beam' || w.def.delivery === 'lrm') continue;
      speed = Math.min(speed, w.def.speed);
    }
    return Number.isFinite(speed) ? dist / speed : 0;
  }

  private chooseFire(world: World, target: Mech, dist: number): number {
    const me = this.mech;
    const c = me.combat;
    if (c.shutdown) return 0;
    // Torso must be roughly on target.
    if (Math.abs(angleDiff(me.state.torsoYaw, this.aimYaw)) > 8 * DEG) return 0;
    // Line of sight: the aim ray must reach the target first.
    set3(_eye, me.state.x, me.state.y + me.def.eyeHeight, me.state.z);
    dirFromAngles(this.aimYaw, this.aimPitch, _d);
    const tc = v3(target.state.x, target.state.y + target.def.eyeHeight * 0.75, target.state.z);
    const hit = world.combat.raycast(world, _eye, normalize3(set3(_d, tc.x - _eye.x, tc.y - _eye.y, tc.z - _eye.z)), dist3(_eye, tc) + 10, me.id);
    const los = hit.mech?.id === target.id;

    let mask = 0;
    let heat = c.heat;
    const cap = me.def.heatCapacity * this.profile.heatLimit;
    for (let g = 0; g < MAX_GROUPS; g++) {
      const ready = c.group(g).filter((w) => c.canFire(w));
      if (ready.length === 0) continue;
      const lrm = ready.every((w) => w.def.delivery === 'lrm');
      if (!los && !(lrm && c.lock >= 1)) continue; // LRMs can arc over cover with a lock
      const inRange = ready.some((w) => dist <= w.def.range * 1.15 && dist >= (w.def.minRange ?? 0));
      if (!inRange) continue;
      if (lrm && c.lock < 1) continue;
      const groupHeat = ready.reduce((h, w) => h + w.def.heat, 0);
      if (heat + groupHeat > cap) continue;
      heat += groupHeat;
      mask |= 1 << g;
    }
    return mask;
  }
}

/** Damage-weighted effective range of a loadout, clamped to sensible brawling/sniping bounds. */
export function preferredRange(m: Mech): number {
  let sum = 0;
  let weight = 0;
  for (const w of m.combat.weapons) {
    const dps = (w.def.damage * (w.def.count ?? 1)) / w.def.cooldown;
    // Long-range missiles shouldn't pull a brawler out of its laser range.
    const r = w.def.delivery === 'lrm' ? Math.min(w.def.range, 550) : w.def.range;
    sum += r * 0.8 * dps;
    weight += dps;
  }
  return Math.min(600, Math.max(150, weight ? sum / weight : 300));
}

