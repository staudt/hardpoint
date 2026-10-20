import type { HitLocation } from '../../data/chassis';
import type { Mech } from '../mech';
import type { Rng } from '../rng';
import type { CombatEvent } from './events';

export interface DamageContext {
  rng: Rng;
  events: CombatEvent[];
  attackerId: number;
}

/** Where damage overflows once a location is destroyed (MW2/BattleTech style). */
export const TRANSFER: Partial<Record<HitLocation, HitLocation>> = { la: 'lt', ra: 'rt', ll: 'lt', rl: 'rt', lt: 'ct', rt: 'ct' };

/** Chance of a critical per 5 points of internal damage. */
export const CRIT_CHANCE = 0.15;
const AMMO_EXPLOSION_CAP = 60;

/**
 * Apply damage to a location: armour first (unless `internalOnly`), then internal
 * structure; overflow transfers inward. Internal damage can roll criticals.
 */
export function applyDamage(m: Mech, loc: HitLocation, amount: number, ctx: DamageContext, internalOnly = false): void {
  const c = m.combat;
  let cur: HitLocation | undefined = loc;
  let left = amount;
  while (left > 1e-9 && cur && c.alive) {
    if (c.destroyed[cur]) {
      cur = TRANSFER[cur];
      continue;
    }
    if (!internalOnly) {
      const a = Math.min(c.armor[cur], left);
      c.armor[cur] -= a;
      left -= a;
      if (left <= 1e-9) break;
    }
    const s = Math.min(c.structure[cur], left);
    c.structure[cur] -= s;
    left -= s;
    if (c.structure[cur] <= 1e-9) {
      destroyLocation(m, cur, ctx);
      cur = TRANSFER[cur];
    } else if (s > 0 && ctx.rng.next() < 1 - Math.pow(1 - CRIT_CHANCE, s / 5)) {
      critical(m, cur, ctx);
    }
  }
}

export function destroyLocation(m: Mech, loc: HitLocation, ctx: DamageContext): void {
  const c = m.combat;
  if (c.destroyed[loc]) return;
  c.destroyed[loc] = true;
  c.armor[loc] = 0;
  c.structure[loc] = 0;
  for (const w of c.weapons) if (w.location === loc) w.destroyed = true;
  ctx.events.push({ type: 'locDestroyed', mechId: m.id, loc });

  // A side torso takes its arm with it.
  if (loc === 'lt') destroyLocation(m, 'la', ctx);
  if (loc === 'rt') destroyLocation(m, 'ra', ctx);

  // Ammo stored here cooks off.
  explodeAmmo(m, loc, ctx);

  if (loc === 'ct' || loc === 'head' || (c.destroyed.ll && c.destroyed.rl)) kill(m, ctx);
}

/** Detonate all ammo stored in `loc`. Damage goes to the location (or inward if it's already gone). */
export function explodeAmmo(m: Mech, loc: HitLocation, ctx: DamageContext): void {
  let dmg = 0;
  for (const w of m.combat.weapons) {
    if (w.ammoLocation !== loc || !Number.isFinite(w.ammo) || w.ammo <= 0) continue;
    dmg += w.ammo * w.def.damage * (w.def.count ?? 1) * 0.25;
    w.ammo = 0;
  }
  if (dmg <= 0) return;
  dmg = Math.min(dmg, AMMO_EXPLOSION_CAP);
  ctx.events.push({ type: 'ammoExplosion', mechId: m.id, loc, damage: dmg });
  const target = m.combat.destroyed[loc] ? TRANSFER[loc] : loc;
  if (target) applyDamage(m, target, dmg, ctx, true);
  else kill(m, ctx);
}

function critical(m: Mech, loc: HitLocation, ctx: DamageContext): void {
  const c = m.combat;
  const options: (['weapon', number] | ['ammo'] | ['heatsink'])[] = [['heatsink']];
  for (const w of c.weapons) if (w.location === loc && !w.destroyed) options.push(['weapon', w.index]);
  if (c.weapons.some((w) => w.ammoLocation === loc && Number.isFinite(w.ammo) && w.ammo > 0)) options.push(['ammo']);
  const pick = ctx.rng.pick(options);
  if (pick[0] === 'weapon') {
    c.weapons[pick[1]]!.destroyed = true;
    ctx.events.push({ type: 'crit', mechId: m.id, loc, what: 'weapon', weapon: pick[1] });
  } else if (pick[0] === 'heatsink') {
    c.heatSinks = Math.max(0, c.heatSinks - 1);
    ctx.events.push({ type: 'crit', mechId: m.id, loc, what: 'heatsink' });
  } else {
    ctx.events.push({ type: 'crit', mechId: m.id, loc, what: 'ammo' });
    explodeAmmo(m, loc, ctx);
  }
}

export function kill(m: Mech, ctx: DamageContext): void {
  if (!m.combat.alive) return;
  m.combat.alive = false;
  m.state.speed = 0;
  ctx.events.push({ type: 'mechDestroyed', mechId: m.id, killerId: ctx.attackerId });
}
