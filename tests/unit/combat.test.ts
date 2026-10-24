import { describe, expect, it } from 'vitest';
import { IRONCLAW, WARDEN, type ChassisDef } from '../../src/data/chassis';
import { HIT_REACTION } from '../../src/sim/combat/combat';
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

describe('hit reaction', () => {
  /** Peak torso reel (rad) over `seconds`, calling `each(tick)` before every step. */
  function peakReel(world: World, m: Mech, seconds: number, each?: (tick: number) => void): number {
    let peak = 0;
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      each?.(i);
      world.step(DT);
      peak = Math.max(peak, Math.abs(m.state.reelPitch));
    }
    return peak;
  }
  // The Warden (b) faces +Z; a shot from the Ironclaw at the origin travels −Z: a hit from the front.
  const missiles = (b: Mech, dmg: number): void => b.hitReaction(0, -1, 0, false, HIT_REACTION.srm.jolt * dmg, HIT_REACTION.srm.shove * dmg);

  it('a missile volley reels the torso back, shoves the mech, then recovers', () => {
    const { world, b } = arena();
    const z0 = b.state.z;
    const peak = peakReel(world, b, 0.5, (i) => i === 0 && missiles(b, 12));
    expect(peak).toBeGreaterThan(5 * (Math.PI / 180));
    expect(b.state.z).toBeLessThan(z0 - 0.2); // knocked back along the shot
    run(world, 2);
    expect(Math.abs(b.state.reelPitch)).toBeLessThan(0.005);
  });

  it('a laser burn of the same damage pushes gently instead of slamming', () => {
    const slam = (() => {
      const { world, b } = arena();
      return peakReel(world, b, 1, (i) => i === 0 && missiles(b, 12));
    })();
    const { world, b } = arena();
    const ticks = Math.round(0.7 / DT);
    const perTick = 12 / ticks;
    let firstTick = 0;
    const push = peakReel(world, b, 1, (i) => {
      if (i < ticks) b.hitReaction(0, -1, 0, false, HIT_REACTION.beam.jolt * perTick, HIT_REACTION.beam.shove * perTick);
      if (i === 1) firstTick = b.state.reelPitch;
    });
    expect(push).toBeGreaterThan(0.01);
    expect(slam).toBeGreaterThan(push * 1.5);
    expect(firstTick).toBeLessThan(push * 0.1); // builds up over the burn
  });

  it('side hits twist and lean the torso; heavier mechs reel less', () => {
    const { world, a, b } = arena();
    b.hitReaction(0, -1, -1, false, 1, 0); // left torso, from the front
    world.step(DT);
    expect(b.state.reelYaw).toBeGreaterThan(0); // left side shoved back: twists left
    // Same hit on both chassis: the 75 t Ironclaw moves less than the 50 t Warden.
    a.hitReaction(0, 1, 0, false, 1, 0);
    b.hitReaction(0, -1, 0, false, 1, 0);
    world.step(DT);
    expect(a.state.reelVPitch).toBeLessThan(b.state.reelVPitch);
    // A push from the side leans the torso away from it.
    const side = arena().b;
    side.hitReaction(1, 0, 0, false, 1, 0); // pushed toward +X = the Warden's left (it faces +Z)
    expect(side.state.reelVRoll).toBeGreaterThan(0);
  });

  it('incoming SRMs knock the target back and throw its aim off', () => {
    const { world, a, b } = arena(IRONCLAW, 150);
    const pitch = Math.atan2(IRONCLAW.eyeHeight * 0.8 - WARDEN.eyeHeight, 150);
    a.command = { ...IDLE_COMMAND };
    b.command = { ...IDLE_COMMAND, aimYaw: Math.PI, aimPitch: pitch, fire: 0b100 };
    world.step(DT);
    b.command = { ...IDLE_COMMAND, aimYaw: Math.PI, aimPitch: pitch };
    let aimShift = 0;
    const peak = peakReel(world, a, 2, () => {
      const p = a.combat.aimPoint;
      aimShift = Math.max(aimShift, Math.abs(p.y - (a.state.y + IRONCLAW.eyeHeight)));
    });
    expect(world.combat.events.some((e) => e.type === 'impact' && e.mechId === a.id)).toBe(true);
    expect(peak).toBeGreaterThan(0.02);
    expect(a.state.z).toBeGreaterThan(0.05); // shoved toward +Z, away from the shooter
    expect(aimShift).toBeGreaterThan(5); // the reel lifted the aim point metres off at range
  });
});
