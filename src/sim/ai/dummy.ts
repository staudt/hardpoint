import { IDLE_COMMAND, type Mech, type MechCommand } from '../mech';

/** Training-range target behaviours (placeholder until the real AI in M4). Deterministic in sim time. */
export type DummyMode = 'stand' | 'patrol' | 'strafe';

export interface Dummy {
  mech: Mech;
  mode: DummyMode;
  homeYaw: number;
}

export function dummyCommand(d: Dummy, time: number): MechCommand {
  switch (d.mode) {
    case 'stand':
      return { ...IDLE_COMMAND, aimYaw: d.homeYaw };
    case 'patrol':
      // Walk a wide circle.
      return { ...IDLE_COMMAND, aimYaw: d.homeYaw + time * 0.18, moveZ: 0.55 };
    case 'strafe':
      // Side-step back and forth across the player's line of fire.
      return { ...IDLE_COMMAND, aimYaw: d.homeYaw, moveX: Math.sin(time * 0.35) > 0 ? 0.8 : -0.8 };
  }
}
