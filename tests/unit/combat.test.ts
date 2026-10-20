import { describe, expect, it } from 'vitest';
import { IRONCLAW, WARDEN, type ChassisDef } from '../../src/data/chassis';
import { applyDamage, type DamageContext } from '../../src/sim/combat/damage';
import { rayBox, raycastTerrain, rayMech } from '../../src/sim/combat/raycast';
import { IDLE_COMMAND, type Mech } from '../../src/sim/mech';
import { Rng } from '../../src/sim/rng';
import { FlatTerrain } from '../../src/sim/terrains';
import { World } from '../../src/sim/world';

const DT = 1 / 60;

function arena(shooterDef: ChassisDef = IRONCLAW, range = 150): { world: World; a: Mech; b: Mech } {
  const world = new World(7, new FlatTerrain());
  const a = world.spawnMech(shooterDef, 0, 0, 0, 0);
  const b = world.spawnMech(WARDEN, 0, -range, Math.PI, 1);
  b.command = { ...IDLE_COMMAND, aimYaw: Math.PI };
  return { world, a, b };
}

function run(world: World, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) world.step(DT);
}

const ctx = (): DamageContext => ({ rng: new Rng(1), events: [], attackerId: 99 });

describe('raycasts', () => {
  it('ray vs box', () => {
    expect(rayBox(0, 0, 5, 0, 0, -1, [0, 0, 0], [1, 1, 1], 100)).toBeCloseTo(4);
    expect(rayBox(3, 0, 5, 0, 0, -1, [0, 0, 0], [1, 1, 1], 100)).toBeNull();
    expect(rayBox(0, 0, 5, 0, 0, -1, [0, 0, 0], [1, 1, 1], 3)).toBeNull();
  });

  it('ray vs mech respects torso twist', () => {
    const { b } = arena();
    // Shoot from the north (z = -300) toward the Warden at z=-150 facing +Z (yaw π).
    const hitCt = rayMech(b, { x: 0, y: 7, z: 0 }, { x: 0, y: 0, z: -1 }, 500);
    expect(hitCt?.loc).toBe('ct');
    // Ray at the Warden's right arm (its right is world −X when facing +Z).
    const hitArm = rayMech(b, { x: -2.1, y: 7.1, z: 0 }, { x: 0, y: 0, z: -1 }, 500);
    expect(hitArm?.loc).toBe('ra');
  });

  it('terrain raycast finds the ground', () => {
    const t = raycastTerrain(new FlatTerrain(), { x: 0, y: 10, z: 0 }, { x: 0, y: -Math.SQRT1_2, z: -Math.SQRT1_2 }, 100);
    expect(t).toBeCloseTo(10 * Math.SQRT2, 2);
  });
});

describe('damage', () => {
  it('eats armour, then structure, then transfers inward', () => {
    const { b } = arena();
    const c = b.combat;
    applyDamage(b, 'la', WARDEN.armor.la, ctx());
    expect(c.armor.la).toBe(0);
    expect(c.structure.la).toBe(WARDEN.structure.la);
    applyDamage(b, 'la', WARDEN.structure.la + 5, ctx());
    expect(c.destroyed.la).toBe(true);
    expect(c.armor.lt).toBe(WARDEN.armor.lt - 5); // overflow into left torso
    expect(c.weapons.filter((w) => w.location === 'la').every((w) => w.destroyed)).toBe(true);
  });

  it('a destroyed side torso takes its arm and cooks its ammo', () => {
    const { b } = arena();
    const c = b.combat;
    const events: DamageContext['events'] = [];
    applyDamage(b, 'lt', 1000, { rng: new Rng(2), events, attackerId: 1 });
    expect(c.destroyed.lt).toBe(true);
    expect(c.destroyed.la).toBe(true);
    // Warden keeps AC/20 ammo (left arm) and SRM ammo in the left torso.
    expect(events.some((e) => e.type === 'ammoExplosion')).toBe(true);
    expect(c.weapons.find((w) => w.def.id === 'ac20')!.ammo).toBe(0);
  });

  it('centre torso destruction kills the mech', () => {
    const { b } = arena();
    const events: DamageContext['events'] = [];
    applyDamage(b, 'ct', 10_000, { rng: new Rng(3), events, attackerId: 1 });
    expect(b.combat.alive).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'mechDestroyed', mechId: b.id, killerId: 1 });
  });

  it('a lost leg slows the mech', () => {
    const { b } = arena();
    applyDamage(b, 'll', 1000, ctx());
    expect(b.combat.speedFactor()).toBeCloseTo(0.3);
  });
});

describe('heat & ammo', () => {
  it('lasers build heat; sustained fire shuts the mech down', () => {
    const { world, a } = arena();
    a.command = { ...IDLE_COMMAND, fire: 0b001 };
    run(world, 2.1);
    expect(a.combat.heat).toBeGreaterThan(5);
    run(world, 20);
    expect(world.combat.events.some((e) => e.type === 'shutdown' && e.mechId === a.id) || a.combat.shutdown).toBe(true);
  });

  it('override prevents shutdown but damages the centre torso', () => {
    const { world, a } = arena();
    a.combat.heat = IRONCLAW.heatCapacity * 1.2;
    a.command = { ...IDLE_COMMAND, override: true };
    world.step(DT);
    expect(a.combat.shutdown).toBe(false);
    run(world, 3);
    expect(a.combat.structure.ct).toBeLessThan(IRONCLAW.structure.ct);
  });

  it('coolant flush dumps heat and uses a charge', () => {
    const { world, a } = arena();
    a.combat.heat = 20;
    a.command = { ...IDLE_COMMAND, coolant: true };
    world.step(DT);
    expect(a.combat.heat).toBeLessThan(20 - IRONCLAW.heatCapacity * 0.39);
    expect(a.combat.coolant).toBe(IRONCLAW.coolantCharges - 1);
  });

  it('ballistics consume ammo and stop when empty', () => {
    const { world, a } = arena();
    const ac = a.combat.weapons.find((w) => w.def.id === 'ac5')!;
    ac.ammo = 2;
    a.command = { ...IDLE_COMMAND, fire: 0b010 };
    run(world, 6);
    expect(ac.ammo).toBe(0);
    const shots = world.combat.events.filter((e) => e.type === 'fire' && e.weaponId === 'ac5').length;
    expect(shots).toBe(2);
  });

  it('chain fire cycles weapons one at a time', () => {
    const { world, a } = arena();
    a.combat.chainMode[0] = true;
    a.command = { ...IDLE_COMMAND, fire: 0b001 };
    run(world, 0.3);
    const fired = world.combat.events.filter((e) => e.type === 'fire').map((e) => (e as { weapon: number }).weapon);
    expect(fired.length).toBe(2); // t=0 and t=0.25
    expect(fired[0]).not.toBe(fired[1]);
  });
});

describe('weapons hit', () => {
  it('a laser burn deals its full damage at short range', () => {
    const { world, a, b } = arena();
    a.combat.weapons.forEach((w) => (w.groups = 0));
    a.combat.weapons[0]!.groups = 1; // one medium laser
    a.command = { ...IDLE_COMMAND, fire: 1 };
    world.step(DT);
    a.command = { ...IDLE_COMMAND };
    run(world, 1.5);
    const total = Object.values(WARDEN.armor).reduce((s, v) => s + v, 0);
    const left = Object.values(b.combat.armor).reduce((s, v) => s + v, 0);
    expect(total - left).toBeCloseTo(5, 1);
  });

  it('locked LRMs home in on a walking target', () => {
    const { world, a, b } = arena(IRONCLAW, 400);
    b.command = { ...IDLE_COMMAND, aimYaw: Math.PI / 2, moveZ: 1 }; // walks sideways across
    a.command = { ...IDLE_COMMAND, targetId: b.id };
    run(world, 1.6);
    expect(a.combat.lock).toBe(1);
    a.command = { ...IDLE_COMMAND, targetId: b.id, fire: 0b100 };
    world.step(DT);
    a.command = { ...IDLE_COMMAND, targetId: b.id };
    run(world, 5);
    const hits = world.combat.events.filter((e) => e.type === 'impact' && e.mechId === b.id).length;
    expect(hits).toBeGreaterThan(15); // most of 30 missiles
  });

  it('LRMs do nothing inside minimum range', () => {
    const { world, a, b } = arena(IRONCLAW, 60);
    a.command = { ...IDLE_COMMAND, fire: 0b100, aimPitch: -0.05 };
    world.step(DT);
    a.command = { ...IDLE_COMMAND };
    run(world, 3);
    const armor = Object.values(b.combat.armor).reduce((s, v) => s + v, 0);
    expect(armor).toBe(Object.values(WARDEN.armor).reduce((s, v) => s + v, 0));
  });

  it('is deterministic', () => {
    const sim = (): unknown => {
      const { world, a, b } = arena(IRONCLAW, 250);
      a.command = { ...IDLE_COMMAND, fire: 0b111, targetId: b.id, aimYaw: 0.01 };
      b.command = { ...IDLE_COMMAND, aimYaw: Math.PI, fire: 0b111 };
      run(world, 8);
      return { a: a.combat.armor, b: b.combat.armor, ha: a.combat.heat, hb: b.combat.heat, n: world.combat.projectiles.length };
    };
    expect(sim()).toEqual(sim());
  });
});
