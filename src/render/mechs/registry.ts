import { buildIronclaw } from './chassis/ironclaw';
import { buildWarden } from './chassis/warden';
import type { MechRig } from './rig';

const BUILDERS: Record<string, () => MechRig> = {
  ironclaw: buildIronclaw,
  warden: buildWarden,
};

/** Build the visual rig for a chassis id (falls back to the Ironclaw). */
export function buildMechRig(chassisId: string): MechRig {
  return (BUILDERS[chassisId] ?? buildIronclaw)();
}
