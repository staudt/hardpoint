import type { HitLocation } from '../../data/chassis';

/** One-shot things that happened in the sim, drained by the renderer/audio each frame. */
export type CombatEvent =
  | { type: 'fire'; mechId: number; weapon: number; weaponId: string; x: number; y: number; z: number }
  | { type: 'impact'; weaponId: string; x: number; y: number; z: number; mechId: number; loc: HitLocation | null; damage: number }
  | { type: 'locDestroyed'; mechId: number; loc: HitLocation }
  | { type: 'ammoExplosion'; mechId: number; loc: HitLocation; damage: number }
  | { type: 'crit'; mechId: number; loc: HitLocation; what: 'weapon' | 'heatsink' | 'ammo'; weapon?: number }
  | { type: 'mechDestroyed'; mechId: number; killerId: number }
  | { type: 'shutdown'; mechId: number }
  | { type: 'startup'; mechId: number }
  | { type: 'coolant'; mechId: number };
