import type { HitLocation } from '../../data/chassis';
import { rangeFactor, type Delivery } from '../../data/weapons';
import { DEG } from '../angles';
import type { Mech } from '../mech';
import type { Rng } from '../rng';
import type { HeightField } from '../terrain';
import { clampCone, copy3, dirFromAngles, dist3, localToWorld, normalize3, set3, v3, type Vec3 } from '../vec';
import { applyDamage, explodeAmmo, type DamageContext } from './damage';
import type { CombatEvent } from './events';
import { MAX_GROUPS, type WeaponMount } from './mechCombat';
import { raycastTerrain, rayMech } from './raycast';

export interface CombatWorld {
  readonly mechs: readonly Mech[];
  readonly terrain: HeightField;
  readonly rng: Rng;
  /** Multiplier on heat-sink dissipation (desert < 1, arctic > 1). */
  readonly ambientCooling: number;
}

export interface Projectile {
  id: number;
  owner: number;
  weapon: number;
  weaponId: string;
  kind: Delivery;
  pos: Vec3;
  prev: Vec3;
  vel: Vec3;
  speed: number;
  damage: number;
  traveled: number;
  maxDist: number;
  /** Homing: target mech id, or a fixed point; turn rate in rad/s (0 = dumbfire). */
  targetId: number;
  targetPoint: Vec3 | null;
  homing: number;
}

export interface Beam {
  id: number;
  owner: number;
  weapon: number;
  weaponId: string;
  from: Vec3;
  to: Vec3;
  /** Seconds of burn left. */
  left: number;
  dps: number;
  /** Mech id currently being hit (0 = none). */
  hitMech: number;
}

const AIM_RANGE = 1200;
const ARM_CONE = 20 * DEG;
const TORSO_CONE = 5 * DEG;
const LOCK_CONE = 5 * DEG;
const CHAIN_INTERVAL = 0.25;
const HEAT_PER_SINK = 0.1; // heat units per second per sink
const SHUTDOWN_MIN = 4;
const LRM_LOFT = 0.45;

/**
 * Hit reaction per point of damage on a 50 t mech: torso jolt (rad/s) and knockback (m/s).
 * Beams deliver theirs a tick at a time over the burn, so they push steadily; missiles and
 * shells land all at once, so they slam the torso back.
 */
export const HIT_REACTION: Record<Delivery, { jolt: number; shove: number }> = {
  beam: { jolt: 0.25, shove: 0.1 },
  stream: { jolt: 0.12, shove: 0.03 },
  bolt: { jolt: 0.08, shove: 0.12 },
  shell: { jolt: 0.08, shove: 0.15 },
  srm: { jolt: 0.15, shove: 0.3 },
  lrm: { jolt: 0.15, shove: 0.3 },
};
const SIDE: Partial<Record<HitLocation, number>> = { la: -1, lt: -1, ll: -1, ra: 1, rt: 1, rl: 1 };

const _o = v3();
const _d = v3();
const _fwd = v3();

/** Weapons fire, projectiles, beams, heat, lock-on. Deterministic; all randomness via world.rng. */
export class Combat {
  readonly projectiles: Projectile[] = [];
  readonly beams: Beam[] = [];
  /** Accumulates until drained by the renderer. */
  readonly events: CombatEvent[] = [];
  private nextId = 1;

  drainEvents(): CombatEvent[] {
    return this.events.splice(0, this.events.length);
  }

  step(world: CombatWorld, dt: number): void {
    for (const m of world.mechs) {
      if (!m.combat.alive) continue;
      this.updateHeat(world, m, dt);
      this.updateAim(world, m);
      this.updateLock(world, m, dt);
      this.updateFiring(world, m, dt);
    }
    this.updateBeams(world, dt);
    this.updateProjectiles(world, dt);
  }

  // ---------------------------------------------------------------- heat
  private updateHeat(world: CombatWorld, m: Mech, dt: number): void {
    const c = m.combat;
    const cmd = m.command;
    const cap = m.def.heatCapacity;
    c.override = cmd.override;
    if (cmd.coolant && c.coolant > 0) {
      c.coolant--;
      c.heat = Math.max(0, c.heat - cap * 0.4);
      this.events.push({ type: 'coolant', mechId: m.id });
    }
    const moving = Math.abs(m.state.speed) / m.def.maxSpeed;
    c.heat += (moving * 0.3 - c.heatSinks * HEAT_PER_SINK * world.ambientCooling) * dt;
    c.heat = Math.min(Math.max(c.heat, 0), cap * 1.5);
    for (const w of c.weapons) w.cooldown = Math.max(0, w.cooldown - dt);
    for (let g = 0; g < MAX_GROUPS; g++) c.chainTimer[g] = Math.max(0, c.chainTimer[g]! - dt);

    const h = c.heatFrac;
    if (c.shutdown) {
      c.shutdownTimer -= dt;
      if (c.shutdownTimer <= 0 && h < 0.4) {
        c.shutdown = false;
        this.events.push({ type: 'startup', mechId: m.id });
      }
    } else if (h >= 1 && !c.override) {
      c.shutdown = true;
      c.shutdownTimer = SHUTDOWN_MIN;
      for (const b of this.beams) if (b.owner === m.id) b.left = 0;
      this.events.push({ type: 'shutdown', mechId: m.id });
    }

    // Running hot risks the ammo; overriding past 100% cooks the internals.
    const ctx = this.ctx(world, m.id);
    const ammoRisk = h >= 1 ? 0.08 : h >= 0.9 ? 0.01 : 0;
    if (ammoRisk > 0 && world.rng.next() < ammoRisk * dt) {
      const bins = [...new Set(c.weapons.filter((w) => Number.isFinite(w.ammo) && w.ammo > 0).map((w) => w.ammoLocation))];
      if (bins.length) explodeAmmo(m, world.rng.pick(bins), ctx);
    }
    if (h >= 1 && c.override) applyDamage(m, 'ct', 1.0 * dt, ctx, true);
  }

  // ---------------------------------------------------------------- aim & lock
  private updateAim(world: CombatWorld, m: Mech): void {
    const s = m.state;
    set3(_o, s.x, s.y + m.def.eyeHeight, s.z);
    // A reeling torso drags the aim with it until it recovers.
    dirFromAngles(m.command.aimYaw + s.reelYaw, m.command.aimPitch + s.reelPitch, _d);
    const t = this.raycast(world, _o, _d, AIM_RANGE, m.id).t;
    set3(m.combat.aimPoint, _o.x + _d.x * t, _o.y + _d.y * t, _o.z + _d.z * t);
  }

  private updateLock(world: CombatWorld, m: Mech, dt: number): void {
    const c = m.combat;
    c.targetId = m.command.targetId;
    const target = world.mechs.find((t) => t.id === c.targetId && t.combat.alive && t.id !== m.id);
    const launcher = c.weapons.find((w) => !w.destroyed && w.def.lockTime !== undefined);
    if (!target || !launcher) {
      c.lock = 0;
      return;
    }
    const s = m.state;
    set3(_o, s.x, s.y + m.def.eyeHeight, s.z);
    const tc = targetCenter(target, v3());
    const dist = dist3(_o, tc);
    dirFromAngles(m.command.aimYaw, m.command.aimPitch, _d);
    const toT = normalize3(v3(tc.x - _o.x, tc.y - _o.y, tc.z - _o.z));
    const angle = Math.acos(Math.min(1, toT.x * _d.x + toT.y * _d.y + toT.z * _d.z));
    if (angle < LOCK_CONE && dist <= launcher.def.maxRange) c.lock = Math.min(1, c.lock + dt / launcher.def.lockTime!);
    else c.lock = Math.max(0, c.lock - dt * 0.5);
  }

  // ---------------------------------------------------------------- firing
  private updateFiring(world: CombatWorld, m: Mech, _dt: number): void {
    const c = m.combat;
    if (c.shutdown) return;
    const cmd = m.command;
    if (cmd.alpha) {
      for (const w of c.weapons) if (c.canFire(w)) this.fire(world, m, w);
      return;
    }
    for (let g = 0; g < MAX_GROUPS; g++) {
      if ((cmd.fire & (1 << g)) === 0) continue;
      const group = c.group(g);
      if (group.length === 0) continue;
      if (!c.chainMode[g]) {
        for (const w of group) if (c.canFire(w)) this.fire(world, m, w);
        continue;
      }
      if (c.chainTimer[g]! > 0) continue;
      // Chain fire: next ready weapon in sequence.
      for (let k = 0; k < group.length; k++) {
        const idx = (c.chainIndex[g]! + k) % group.length;
        const w = group[idx]!;
        if (!c.canFire(w)) continue;
        this.fire(world, m, w);
        c.chainIndex[g] = (idx + 1) % group.length;
        c.chainTimer[g] = CHAIN_INTERVAL;
        break;
      }
    }
  }

  /** Muzzle position (world) and aimed direction for a weapon, respecting its convergence cone and heat wobble. */
  private aimWeapon(world: CombatWorld, m: Mech, w: WeaponMount, pos: Vec3, dir: Vec3, wobble: boolean): void {
    const s = m.state;
    const mz = w.hardpoint.muzzle;
    localToWorld(s, s.torsoYaw, mz[0], mz[1], mz[2], pos);
    const ap = m.combat.aimPoint;
    normalize3(set3(dir, ap.x - pos.x, ap.y - pos.y, ap.z - pos.z));
    dirFromAngles(s.torsoYaw + s.reelYaw, s.torsoPitch + s.reelPitch, _fwd);
    clampCone(dir, _fwd, w.location === 'la' || w.location === 'ra' ? ARM_CONE : TORSO_CONE);
    const h = m.combat.heatFrac;
    if (wobble && h > 0.7) {
      const amt = Math.min(1, (h - 0.7) / 0.3) * 0.035;
      dir.x += world.rng.range(-amt, amt);
      dir.y += world.rng.range(-amt, amt);
      dir.z += world.rng.range(-amt, amt);
      normalize3(dir);
    }
  }

  private fire(world: CombatWorld, m: Mech, w: WeaponMount): void {
    const def = w.def;
    const c = m.combat;
    w.cooldown = def.cooldown;
    c.heat += def.heat;
    if (Number.isFinite(w.ammo)) w.ammo--;
    const pos = v3();
    const dir = v3();
    this.aimWeapon(world, m, w, pos, dir, true);
    this.events.push({ type: 'fire', mechId: m.id, weapon: w.index, weaponId: def.id, x: pos.x, y: pos.y, z: pos.z });

    if (def.delivery === 'beam') {
      const dur = def.beamDuration ?? 0.5;
      this.beams.push({ id: this.nextId++, owner: m.id, weapon: w.index, weaponId: def.id, from: pos, to: { ...pos }, left: dur, dps: def.damage / dur, hitMech: 0 });
      return;
    }
    const count = def.count ?? 1;
    const locked = c.lock >= 1 ? c.targetId : 0;
    for (let i = 0; i < count; i++) {
      const d = { ...dir };
      if (def.delivery === 'lrm') {
        d.y += LRM_LOFT;
        normalize3(d);
      }
      if (def.spread) {
        d.x += world.rng.range(-def.spread, def.spread);
        d.y += world.rng.range(-def.spread, def.spread) * 0.6;
        d.z += world.rng.range(-def.spread, def.spread);
        normalize3(d);
      }
      // Stagger launch points slightly so volleys don't overlap.
      const p = { x: pos.x + d.x * i * 0.4, y: pos.y + d.y * i * 0.4, z: pos.z + d.z * i * 0.4 };
      this.projectiles.push({
        id: this.nextId++,
        owner: m.id,
        weapon: w.index,
        weaponId: def.id,
        kind: def.delivery,
        pos: p,
        prev: { ...p },
        vel: { x: d.x * def.speed, y: d.y * def.speed, z: d.z * def.speed },
        speed: def.speed,
        damage: def.damage,
        traveled: 0,
        maxDist: def.maxRange * 1.15,
        targetId: def.delivery === 'lrm' ? locked : 0,
        targetPoint: def.delivery === 'lrm' && !locked ? { ...c.aimPoint } : null,
        homing: def.delivery === 'lrm' ? (locked ? 1.9 : 1.2) : 0,
      });
    }
  }

  // ---------------------------------------------------------------- beams
  private updateBeams(world: CombatWorld, dt: number): void {
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i]!;
      const owner = world.mechs.find((m) => m.id === b.owner);
      const w = owner?.combat.weapons[b.weapon];
      if (!owner || !w || !owner.combat.alive || w.destroyed || b.left <= 0) {
        this.beams.splice(i, 1);
        continue;
      }
      // Beams track the aim for their whole burn.
      this.aimWeapon(world, owner, w, b.from, _d, false);
      const hit = this.raycast(world, b.from, _d, w.def.maxRange, owner.id);
      set3(b.to, b.from.x + _d.x * hit.t, b.from.y + _d.y * hit.t, b.from.z + _d.z * hit.t);
      b.hitMech = hit.mech ? hit.mech.id : 0;
      if (hit.mech && hit.loc) {
        const dmg = b.dps * Math.min(dt, b.left) * rangeFactor(w.def, hit.t);
        this.hitMech(world, hit.mech, hit.loc, dmg, owner.id, b.from, 'beam', _d);
      }
      b.left -= dt;
    }
  }

  // ---------------------------------------------------------------- projectiles
  private updateProjectiles(world: CombatWorld, dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      copy3(p.prev, p.pos);
      if (p.homing > 0) this.steer(world, p, dt);

      const step = p.speed * dt;
      set3(_d, p.vel.x / p.speed, p.vel.y / p.speed, p.vel.z / p.speed);
      const hit = this.raycast(world, p.pos, _d, step, p.owner);
      if (hit.t < step) {
        const at = { x: p.pos.x + _d.x * hit.t, y: p.pos.y + _d.y * hit.t, z: p.pos.z + _d.z * hit.t };
        const def = world.mechs.find((m) => m.id === p.owner)?.combat.weapons[p.weapon]?.def;
        const factor = def ? rangeFactor(def, p.traveled + hit.t) : 1;
        const dmg = p.damage * factor;
        if (hit.mech && hit.loc && dmg > 0) this.hitMech(world, hit.mech, hit.loc, dmg, p.owner, p.prev, p.kind, _d);
        this.events.push({ type: 'impact', weaponId: p.weaponId, x: at.x, y: at.y, z: at.z, mechId: hit.mech?.id ?? 0, loc: hit.loc, damage: dmg });
        copy3(p.pos, at);
        this.projectiles.splice(i, 1);
        continue;
      }
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      p.pos.z += p.vel.z * dt;
      p.traveled += step;
      if (p.traveled > p.maxDist) this.projectiles.splice(i, 1);
    }
  }

  private steer(world: CombatWorld, p: Projectile, dt: number): void {
    let target: Vec3 | null = p.targetPoint;
    if (p.targetId) {
      const t = world.mechs.find((m) => m.id === p.targetId);
      if (t && t.combat.alive) target = targetCenter(t, v3());
      else p.homing *= 0.5; // lost the target: weaker guidance
    }
    if (!target) return;
    const want = normalize3(v3(target.x - p.pos.x, target.y - p.pos.y, target.z - p.pos.z));
    const cur = set3(_d, p.vel.x / p.speed, p.vel.y / p.speed, p.vel.z / p.speed);
    const maxTurn = p.homing * dt;
    const cos = Math.min(1, cur.x * want.x + cur.y * want.y + cur.z * want.z);
    const angle = Math.acos(cos);
    if (angle > 1e-6) {
      const f = Math.min(1, maxTurn / angle);
      cur.x += (want.x - cur.x) * f;
      cur.y += (want.y - cur.y) * f;
      cur.z += (want.z - cur.z) * f;
      normalize3(cur);
    }
    set3(p.vel, cur.x * p.speed, cur.y * p.speed, cur.z * p.speed);
  }

  // ---------------------------------------------------------------- helpers
  /** `dir`: travel direction of the shot (unit), which is the way the hit pushes. */
  private hitMech(world: CombatWorld, target: Mech, loc: HitLocation, dmg: number, attackerId: number, from: Vec3, kind: Delivery, dir: Vec3): void {
    target.combat.lastHitFrom = normalize3(v3(from.x - target.state.x, 0, from.z - target.state.z));
    const h = Math.hypot(dir.x, dir.z);
    if (h > 1e-6) {
      const r = HIT_REACTION[kind];
      target.hitReaction(dir.x / h, dir.z / h, SIDE[loc] ?? 0, loc === 'll' || loc === 'rl', r.jolt * dmg, r.shove * dmg);
    }
    applyDamage(target, loc, dmg, this.ctx(world, attackerId));
  }

  private ctx(world: CombatWorld, attackerId: number): DamageContext {
    return { rng: world.rng, events: this.events, attackerId };
  }

  /** Nearest hit along a ray against terrain and live mechs (excluding `ignoreId`). t = maxT if nothing. */
  raycast(world: CombatWorld, o: Vec3, d: Vec3, maxT: number, ignoreId: number): RayHit {
    let best: RayHit = { t: maxT, mech: null, loc: null };
    const tg = raycastTerrain(world.terrain, o, d, maxT, Math.min(4, Math.max(maxT / 2, 0.5)));
    if (tg !== null) best = { t: tg, mech: null, loc: null };
    for (const m of world.mechs) {
      if (m.id === ignoreId || !m.combat.alive) continue;
      const h = rayMech(m, o, d, best.t);
      if (h && h.t < best.t) best = { t: h.t, mech: m, loc: h.loc };
    }
    return best;
  }
}

export interface RayHit {
  t: number;
  mech: Mech | null;
  loc: HitLocation | null;
}

/** Aim point on a mech (centre of mass). */
export function targetCenter(m: Mech, out: Vec3): Vec3 {
  return set3(out, m.state.x, m.state.y + m.def.eyeHeight * 0.8, m.state.z);
}
