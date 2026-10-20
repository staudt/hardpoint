import { describe, expect, it } from 'vitest';
import { IRONCLAW, WARDEN } from '../../src/data/chassis';
import { MechBrain, PILOTS, preferredRange } from '../../src/sim/ai/mechBrain';
import { applyDamage } from '../../src/sim/combat/damage';
import { InstantAction } from '../../src/sim/mission/instantAction';
import { IDLE_COMMAND } from '../../src/sim/mech';
import { Rng } from '../../src/sim/rng';
import { DesertTerrain } from '../../src/sim/terrain';
import { FlatTerrain } from '../../src/sim/terrains';
import { World } from '../../src/sim/world';

const DT = 1 / 60;
const total = (m: { combat: { armor: Record<string, number>; structure: Record<string, number> } }): number =>
  Object.values(m.combat.armor).reduce((a, b) => a + b, 0) + Object.values(m.combat.structure).reduce((a, b) => a + b, 0);

describe('MechBrain', () => {
  it('preferred range reflects the loadout (brawler < sniper)', () => {
    const w = new World(1, new FlatTerrain());
    const brawler = w.spawnMech(WARDEN, 0, 0, 0);
    const sniper = w.spawnMech(IRONCLAW, 50, 0, 0);
    expect(preferredRange(brawler)).toBeLessThan(preferredRange(sniper));
  });

  it('closes in on a target, shoots it, and never overheats', () => {
    const world = new World(3, new FlatTerrain());
    const target = world.spawnMech(IRONCLAW, 0, 0, 0, 0);
    const ai = world.spawnMech(WARDEN, 0, -700, 0, 1);
    const brain = new MechBrain(ai, PILOTS.regular, 42);
    const start = total(target);
    let maxHeat = 0;
    for (let i = 0; i < 60 * 45; i++) {
      ai.command = brain.think(world, DT);
      target.command = { ...IDLE_COMMAND };
      world.step(DT);
      maxHeat = Math.max(maxHeat, ai.combat.heatFrac);
    }
    const d = Math.hypot(ai.state.x - target.state.x, ai.state.z - target.state.z);
    expect(d).toBeLessThan(500);
    expect(total(target)).toBeLessThan(start * 0.8);
    expect(ai.combat.shutdown).toBe(false);
    expect(maxHeat).toBeLessThan(1);
  });

  it('two AIs duel to a finish deterministically', () => {
    const duel = (): { winner: number; tick: number } => {
      const world = new World(9, new FlatTerrain());
      const a = world.spawnMech(IRONCLAW, 0, 0, 0, 0);
      const b = world.spawnMech(WARDEN, 0, -600, Math.PI, 1);
      const ba = new MechBrain(a, PILOTS.veteran, 1);
      const bb = new MechBrain(b, PILOTS.veteran, 2);
      for (let i = 0; i < 60 * 240 && a.combat.alive && b.combat.alive; i++) {
        a.command = ba.think(world, DT);
        b.command = bb.think(world, DT);
        world.step(DT);
      }
      return { winner: a.combat.alive ? a.id : b.combat.alive ? b.id : 0, tick: world.tick };
    };
    const r1 = duel();
    expect(r1.winner).not.toBe(0);
    expect(duel()).toEqual(r1);
  }, 30_000);

  it('navigates around terrain in the desert without getting stuck', () => {
    const world = new World(1, new DesertTerrain({ seed: 1 }));
    const target = world.spawnMech(WARDEN, 0, 0, 0, 0);
    const ai = world.spawnMech(WARDEN, 500, -500, 0, 1);
    const brain = new MechBrain(ai, PILOTS.regular, 7);
    for (let i = 0; i < 60 * 60; i++) {
      ai.command = { ...brain.think(world, DT), fire: 0 };
      target.command = { ...IDLE_COMMAND };
      world.step(DT);
    }
    expect(Math.hypot(ai.state.x, ai.state.z)).toBeLessThan(brain.preferredRange * 1.6);
  }, 30_000);
});

describe('InstantAction', () => {
  it('spawns waves, advances when cleared, and fails when the player dies', () => {
    const world = new World(5, new DesertTerrain({ seed: 5 }));
    const player = world.spawnMech(IRONCLAW, 0, 0, 0, 0);
    const mission = new InstantAction(world, player, 1, 2);
    const run = (s: number): void => {
      for (let i = 0; i < Math.round(s / DT); i++) {
        player.command = { ...IDLE_COMMAND };
        mission.step(DT);
        world.step(DT);
      }
    };
    run(1.1);
    expect(mission.wave).toBe(1);
    expect(mission.phase).toBe('combat');
    for (const h of mission.hostiles) {
      const d = Math.hypot(h.mech.state.x, h.mech.state.z);
      expect(d).toBeGreaterThan(500);
      expect(d).toBeLessThan(850);
      applyDamage(h.mech, 'ct', 1e4, { rng: new Rng(1), events: [], attackerId: player.id });
      mission.onDestroyed(h.mech.id, player.id);
    }
    run(0.1);
    expect(mission.phase).toBe('intermission');
    expect(mission.kills).toBe(1);
    run(2.1);
    expect(mission.wave).toBe(2);
    expect(mission.remaining).toBe(2);
    applyDamage(player, 'ct', 1e4, { rng: new Rng(1), events: [], attackerId: 0 });
    run(0.1);
    expect(mission.phase).toBe('failed');
  }, 30_000);
});
