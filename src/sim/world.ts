import type { ChassisDef } from '../data/chassis';
import { Combat } from './combat/combat';
import { Mech } from './mech';
import { NavGrid } from './nav/navGrid';
import { Rng } from './rng';
import type { HeightField } from './terrain';

/**
 * Authoritative simulation state. Must stay free of Three.js / DOM so it can
 * run headless (tests, future server) and be serialized.
 */
export class World {
  tick = 0;
  time = 0;
  readonly rng: Rng;
  readonly mechs: Mech[] = [];
  readonly combat = new Combat();
  /** Heat-sink efficiency of the environment (desert < 1). */
  ambientCooling = 1;
  private nextId = 1;
  private navGrid: NavGrid | null = null;

  constructor(
    readonly seed: number,
    readonly terrain: HeightField,
  ) {
    this.rng = new Rng(seed);
  }

  spawnMech(def: ChassisDef, x: number, z: number, yaw: number, team = 0): Mech {
    const mech = new Mech(this.nextId++, def, x, z, yaw, this.terrain, team);
    this.mechs.push(mech);
    return mech;
  }

  /** Navigation grid for AI pathfinding (built on first use). */
  get nav(): NavGrid {
    if (!this.navGrid) {
      const t = this.terrain as HeightField & { basinRadius?: number };
      const radius = t.basinRadius !== undefined ? t.basinRadius + 350 : Math.min(t.halfSize, 1000);
      this.navGrid = new NavGrid(this.terrain, radius);
    }
    return this.navGrid;
  }

  getMech(id: number): Mech | undefined {
    return this.mechs.find((m) => m.id === id);
  }

  step(dt: number): void {
    for (const m of this.mechs) m.step(dt, this.terrain);
    this.combat.step(this, dt);
    this.tick++;
    this.time += dt;
  }
}
