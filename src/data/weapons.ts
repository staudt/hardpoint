import type { HardpointType } from './chassis';

/**
 * How a weapon delivers damage:
 * - beam: hitscan beam held for `beamDuration`; damage spread over the burn.
 * - bolt / shell: single fast projectile.
 * - stream: rapid-fire rounds while held (machine gun).
 * - srm: dumbfire missile volley with spread.
 * - lrm: arcing missile volley; homes on a locked target.
 */
export type Delivery = 'beam' | 'bolt' | 'shell' | 'stream' | 'srm' | 'lrm';

export interface WeaponDef {
  id: string;
  /** HUD name, e.g. "MED LASER". */
  name: string;
  type: HardpointType;
  delivery: Delivery;
  /** Damage per hit: whole beam burn, per shell, or per missile. */
  damage: number;
  /** Heat per shot / volley. */
  heat: number;
  /** Seconds between shots (beams: includes the burn). */
  cooldown: number;
  /** Full damage up to this range (m); falls off linearly to `maxRange`. */
  range: number;
  maxRange: number;
  /** Missiles only: below this range missiles do no damage (arming distance). */
  minRange?: number;
  /** Projectile speed (m/s); ignored for beams. */
  speed: number;
  beamDuration?: number;
  /** Projectiles per trigger pull (missiles per volley). */
  count?: number;
  /** Cone half-angle for volley spread (rad). */
  spread?: number;
  /** Default ammo (shots/volleys) in a standard loadout; undefined = no ammo needed. */
  ammo?: number;
  /** Lock-on time (s) for homing missiles. */
  lockTime?: number;
  tonnage: number;
  /** Visual: beam/tracer colour. */
  color: number;
}

export const WEAPONS: Record<string, WeaponDef> = {
  llas: { id: 'llas', name: 'LT LASER', type: 'energy', delivery: 'beam', damage: 3, heat: 1.5, cooldown: 1.2, range: 200, maxRange: 400, speed: 0, beamDuration: 0.5, tonnage: 0.5, color: 0xff3b30 },
  mlas: { id: 'mlas', name: 'MED LASER', type: 'energy', delivery: 'beam', damage: 5, heat: 3, cooldown: 2, range: 300, maxRange: 600, speed: 0, beamDuration: 0.7, tonnage: 1, color: 0x3bff6a },
  hlas: { id: 'hlas', name: 'HVY LASER', type: 'energy', delivery: 'beam', damage: 9, heat: 7, cooldown: 3.5, range: 450, maxRange: 900, speed: 0, beamDuration: 1.0, tonnage: 5, color: 0x47a6ff },
  pcan: { id: 'pcan', name: 'P-CANNON', type: 'energy', delivery: 'bolt', damage: 10, heat: 10, cooldown: 4, range: 600, maxRange: 1000, minRange: 90, speed: 900, tonnage: 7, color: 0x9fd8ff },
  mg: { id: 'mg', name: 'MACH GUN', type: 'ballistic', delivery: 'stream', damage: 0.4, heat: 0, cooldown: 0.1, range: 120, maxRange: 240, speed: 900, ammo: 400, tonnage: 0.5, color: 0xffd27a },
  ac5: { id: 'ac5', name: 'AC/5', type: 'ballistic', delivery: 'shell', damage: 5, heat: 1, cooldown: 1.5, range: 600, maxRange: 1100, speed: 650, ammo: 40, tonnage: 8, color: 0xffc46a },
  ac20: { id: 'ac20', name: 'AC/20', type: 'ballistic', delivery: 'shell', damage: 20, heat: 7, cooldown: 4, range: 270, maxRange: 540, speed: 420, ammo: 10, tonnage: 14, color: 0xffa040 },
  srm6: { id: 'srm6', name: 'SRM-6', type: 'missile', delivery: 'srm', damage: 2, heat: 2, cooldown: 3, range: 270, maxRange: 400, speed: 170, count: 6, spread: 0.045, ammo: 15, tonnage: 3, color: 0xfff0d0 },
  lrm15: { id: 'lrm15', name: 'LRM-15', type: 'missile', delivery: 'lrm', damage: 1, heat: 2, cooldown: 4, range: 1000, maxRange: 1100, minRange: 180, speed: 130, count: 15, spread: 0.12, ammo: 8, lockTime: 1.5, tonnage: 7, color: 0xfff0d0 },
};

export function getWeapon(id: string): WeaponDef {
  const w = WEAPONS[id];
  if (!w) throw new Error(`unknown weapon ${id}`);
  return w;
}

/** Damage multiplier by distance: 1 within range, linear to 0 at maxRange; 0 inside minRange. */
export function rangeFactor(w: WeaponDef, distance: number): number {
  if (w.minRange !== undefined && distance < w.minRange) return 0;
  if (distance <= w.range) return 1;
  if (distance >= w.maxRange) return 0;
  return 1 - (distance - w.range) / (w.maxRange - w.range);
}
