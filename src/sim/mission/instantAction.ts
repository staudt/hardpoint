import { getChassis } from '../../data/chassis';
import { MechBrain, PILOTS, type PilotRank } from '../ai/mechBrain';
import type { Mech } from '../mech';
import { hash2, type Rng } from '../rng';
import type { World } from '../world';

export type WaveEntry = [chassis: string, rank: PilotRank];

/** Escalating waves; past the end, the last waves repeat with veteran pilots. */
export const WAVES: WaveEntry[][] = [
  [['warden', 'green']],
  [['warden', 'green'], ['warden', 'green']],
  [['ironclaw', 'regular']],
  [['warden', 'regular'], ['warden', 'regular'], ['ironclaw', 'green']],
  [['ironclaw', 'regular'], ['ironclaw', 'regular']],
  [['ironclaw', 'veteran'], ['warden', 'veteran'], ['warden', 'veteran']],
];

export type MissionPhase = 'intermission' | 'combat' | 'failed';

export interface Hostile {
  mech: Mech;
  brain: MechBrain;
}

/**
 * Instant Action: survive escalating waves of AI mechs. Deterministic sim-side
 * logic — spawns, wave flow, kill counting. The HUD reads its public state.
 */
export class InstantAction {
  wave = 0;
  phase: MissionPhase = 'intermission';
  /** Seconds until the next wave drops (intermission). */
  timer: number;
  kills = 0;
  readonly hostiles: Hostile[] = [];
  private readonly rng: Rng;

  constructor(
    private readonly world: World,
    readonly player: Mech,
    firstDelay = 4,
    readonly intermission = 10,
  ) {
    this.rng = world.rng.fork(0x1a);
    this.timer = firstDelay;
  }

  /** Hostiles still alive this wave. */
  get remaining(): number {
    return this.hostiles.filter((h) => h.mech.combat.alive).length;
  }

  get waveSize(): number {
    return this.hostiles.length;
  }

  /** Call before world.step: drives AI commands and the wave flow. */
  step(dt: number): void {
    for (const h of this.hostiles) h.mech.command = h.brain.think(this.world, dt);
    if (this.phase === 'failed') return;
    if (!this.player.combat.alive) {
      this.phase = 'failed';
      return;
    }
    if (this.phase === 'intermission') {
      this.timer -= dt;
      if (this.timer <= 0) this.spawnWave();
      return;
    }
    if (this.remaining === 0) {
      this.phase = 'intermission';
      this.timer = this.intermission;
    }
  }

  /** Called by the game when a mech dies (counts player kills). */
  onDestroyed(mechId: number, killerId: number): void {
    if (killerId === this.player.id && this.hostiles.some((h) => h.mech.id === mechId)) this.kills++;
  }

  private spawnWave(): void {
    const idx = this.wave;
    this.wave++;
    const list = WAVES[Math.min(idx, WAVES.length - 1)]!.map(([c, r]): WaveEntry => [c, idx >= WAVES.length ? 'veteran' : r]);
    // Beyond the scripted waves, add one more mech every other wave.
    for (let extra = 0; idx >= WAVES.length && extra < Math.floor((idx - WAVES.length) / 2) + 1; extra++) {
      list.push([this.rng.pick(['warden', 'ironclaw']), 'veteran']);
    }
    const p = this.player.state;
    const base = this.rng.next() * Math.PI * 2; // the wave arrives from one general direction
    for (const [chassis, rank] of list) {
      const spot = this.findSpawn(p.x, p.z, base);
      const yaw = Math.atan2(-(p.x - spot.x), -(p.z - spot.z)); // face the player
      const mech = this.world.spawnMech(getChassis(chassis), spot.x, spot.z, yaw, 1);
      this.hostiles.push({ mech, brain: new MechBrain(mech, PILOTS[rank], hash2(this.world.seed, mech.id)) });
    }
    this.phase = 'combat';
  }

  /** A flat, open spot 550–800 m from the player, inside the basin, roughly toward `baseAngle`. */
  private findSpawn(px: number, pz: number, baseAngle: number): { x: number; z: number } {
    const t = this.world.terrain;
    const maxR = 'basinRadius' in t ? (t as { basinRadius: number }).basinRadius - 120 : t.halfSize - 200;
    let best = { x: px, z: pz - 600 };
    for (let i = 0; i < 60; i++) {
      const a = baseAngle + this.rng.range(-0.6, 0.6) * (1 + i / 20);
      const r = this.rng.range(550, 800);
      const x = px + Math.sin(a) * r;
      const z = pz + Math.cos(a) * r;
      if (Math.hypot(x, z) > maxR) continue;
      const h = t.heightAt(x, z);
      const e = 4;
      const slope = Math.max(Math.abs(t.heightAt(x + e, z) - h), Math.abs(t.heightAt(x, z + e) - h)) / e;
      if (slope > 0.25 || h > 12) continue; // not on butte tops or cliff faces
      if (this.world.mechs.some((m) => Math.hypot(m.state.x - x, m.state.z - z) < 40)) continue;
      best = { x, z };
      break;
    }
    return best;
  }
}
