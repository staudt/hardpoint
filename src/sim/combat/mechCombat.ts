import { HIT_LOCATIONS, type ChassisDef, type HardpointDef, type HitLocation, type PerLocation } from '../../data/chassis';
import { getWeapon, type WeaponDef } from '../../data/weapons';
import { v3, type Vec3 } from '../vec';

export const MAX_GROUPS = 5;

export interface WeaponMount {
  index: number;
  def: WeaponDef;
  hardpoint: HardpointDef;
  location: HitLocation;
  /** Where this weapon's ammo bin sits (explodes if that location's structure is destroyed). */
  ammoLocation: HitLocation;
  /** Bitmask of groups (bit 0 = group 1). */
  groups: number;
  cooldown: number;
  /** Remaining shots/volleys; Infinity for energy weapons. */
  ammo: number;
  destroyed: boolean;
}

/** Arm weapons keep ammo in the matching side torso; everything else in its own location. */
export function ammoLocationFor(loc: HitLocation): HitLocation {
  if (loc === 'la') return 'lt';
  if (loc === 'ra') return 'rt';
  if (loc === 'head') return 'ct';
  return loc;
}

const perLoc = (v: PerLocation): PerLocation => ({ ...v });

/** All combat state of one mech. Plain data + small helpers; logic lives in combat.ts / damage.ts. */
export class MechCombat {
  readonly weapons: WeaponMount[];
  readonly armor: PerLocation;
  readonly structure: PerLocation;
  readonly destroyed: Record<HitLocation, boolean>;
  alive = true;
  heat = 0;
  heatSinks: number;
  coolant: number;
  /** > 0 while shut down (seconds remaining of the minimum shutdown). */
  shutdownTimer = 0;
  shutdown = false;
  override = false;
  readonly chainMode: boolean[] = new Array<boolean>(MAX_GROUPS).fill(false);
  readonly chainIndex: number[] = new Array<number>(MAX_GROUPS).fill(0);
  readonly chainTimer: number[] = new Array<number>(MAX_GROUPS).fill(0);
  targetId = 0;
  /** 0..1 lock progress on `targetId` for lock-on missiles. */
  lock = 0;
  /** Convergence point of the aim ray (world). */
  readonly aimPoint: Vec3 = v3();
  /** Last direction (world, from mech) damage came from, for HUD hit indicators. */
  lastHitFrom: Vec3 | null = null;

  constructor(readonly chassis: ChassisDef) {
    this.weapons = chassis.loadout.map((entry, index) => {
      const hp = chassis.hardpoints.find((h) => h.id === entry.hardpoint);
      if (!hp) throw new Error(`${chassis.id}: no hardpoint ${entry.hardpoint}`);
      const def = getWeapon(entry.weapon);
      return {
        index,
        def,
        hardpoint: hp,
        location: hp.location,
        ammoLocation: ammoLocationFor(hp.location),
        groups: entry.groups.reduce((m, g) => m | (1 << (g - 1)), 0),
        cooldown: 0,
        ammo: def.ammo ?? Infinity,
        destroyed: false,
      };
    });
    this.armor = perLoc(chassis.armor);
    this.structure = perLoc(chassis.structure);
    this.destroyed = Object.fromEntries(HIT_LOCATIONS.map((l) => [l, false])) as Record<HitLocation, boolean>;
    this.heatSinks = chassis.heatSinks;
    this.coolant = chassis.coolantCharges;
  }

  get heatFrac(): number {
    return this.heat / this.chassis.heatCapacity;
  }

  /** Multiplier on top speed from heat and leg damage. */
  speedFactor(): number {
    let f = 1;
    const h = this.heatFrac;
    if (h > 0.5) f *= 1 - Math.min(1, (h - 0.5) / 0.5) * 0.4;
    if (this.destroyed.ll || this.destroyed.rl) f *= 0.3;
    return f;
  }

  canFire(w: WeaponMount): boolean {
    return !w.destroyed && w.cooldown <= 0 && w.ammo > 0;
  }

  /** Weapons belonging to group g (0-based). */
  group(g: number): WeaponMount[] {
    return this.weapons.filter((w) => (w.groups & (1 << g)) !== 0);
  }

  toggleGroup(weaponIndex: number, g: number): void {
    const w = this.weapons[weaponIndex];
    if (w) w.groups ^= 1 << g;
  }

  /** Fraction of armour+structure remaining for a location (0 = destroyed). */
  integrity(loc: HitLocation): number {
    if (this.destroyed[loc]) return 0;
    const max = this.chassis.armor[loc] + this.chassis.structure[loc];
    return (this.armor[loc] + this.structure[loc]) / max;
  }
}
