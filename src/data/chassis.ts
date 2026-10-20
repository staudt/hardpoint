import { DEG } from '../sim/angles';

export type HitLocation = 'head' | 'ct' | 'lt' | 'rt' | 'la' | 'ra' | 'll' | 'rl';
export type HardpointType = 'energy' | 'ballistic' | 'missile';

export type V3 = readonly [number, number, number];

export const HIT_LOCATIONS: readonly HitLocation[] = ['head', 'ct', 'lt', 'rt', 'la', 'ra', 'll', 'rl'];

export interface HardpointDef {
  /** Node name in the model: `hp_<location>_<n>`. */
  id: string;
  location: HitLocation;
  type: HardpointType;
  /** Muzzle position in mech-local space (standing pose, torso twist 0). Kept in sync with the rig by a unit test. */
  muzzle: V3;
}

/** Axis-aligned box in mech-local space. `torso` boxes rotate with the torso twist; `legs` boxes with the legs. */
export interface HitBox {
  loc: HitLocation;
  frame: 'torso' | 'legs';
  c: V3;
  h: V3;
}

export interface LoadoutEntry {
  hardpoint: string;
  weapon: string;
  /** Weapon groups (1-based) this weapon fires with. */
  groups: number[];
}

export type PerLocation = Record<HitLocation, number>;

export interface ChassisDef {
  id: string;
  name: string;
  /** Designation shown in the HUD, e.g. "IC-7". */
  variant: string;
  tonnage: number;
  legType: 'reverse' | 'standard';
  // Movement
  maxSpeed: number; // m/s forward
  reverseFactor: number; // fraction of maxSpeed when walking backward
  accel: number; // m/s²
  decel: number; // m/s²
  legTurnRate: number; // rad/s
  maxGrade: number; // rise/run the mech can climb (1 = 45°)
  // Torso
  twistLimit: number; // rad either side of the legs
  twistRate: number; // rad/s
  pitchMin: number; // rad (negative = down)
  pitchMax: number; // rad
  hardpoints: HardpointDef[];
  /** Eye/cockpit height above ground (m): origin of the aim ray. */
  eyeHeight: number;
  // Damage & heat
  armor: PerLocation;
  structure: PerLocation;
  hitBoxes: HitBox[];
  heatCapacity: number;
  heatSinks: number;
  coolantCharges: number;
  loadout: LoadoutEntry[];
}


const kph = (v: number): number => v / 3.6;

/** Reverse-joint heavy (homage to the classic clan heavy hunter). */
export const IRONCLAW: ChassisDef = {
  id: 'ironclaw',
  name: 'Ironclaw',
  variant: 'IC-7',
  tonnage: 75,
  legType: 'reverse',
  maxSpeed: kph(64),
  reverseFactor: 0.55,
  accel: 6,
  decel: 10,
  legTurnRate: 55 * DEG,
  maxGrade: 0.9,
  twistLimit: 100 * DEG,
  twistRate: 110 * DEG,
  pitchMin: -22 * DEG,
  pitchMax: 18 * DEG,
  hardpoints: [
    { id: 'hp_lt_1', location: 'lt', type: 'missile', muzzle: [-2.2, 9.4, -1.65] },
    { id: 'hp_rt_1', location: 'rt', type: 'missile', muzzle: [2.2, 9.4, -1.65] },
    { id: 'hp_la_1', location: 'la', type: 'energy', muzzle: [-3.65, 6.0, -3.95] },
    { id: 'hp_la_2', location: 'la', type: 'energy', muzzle: [-3.25, 6.0, -3.95] },
    { id: 'hp_ra_1', location: 'ra', type: 'ballistic', muzzle: [3.45, 6.05, -4.85] },
    { id: 'hp_ra_2', location: 'ra', type: 'energy', muzzle: [3.45, 5.55, -3.4] },
    { id: 'hp_ct_1', location: 'ct', type: 'energy', muzzle: [0, 6.05, -2.95] },
  ],
  eyeHeight: 8.1,
  armor: { head: 9, ct: 40, lt: 28, rt: 28, la: 22, ra: 22, ll: 30, rl: 30 },
  structure: { head: 3, ct: 23, lt: 16, rt: 16, la: 12, ra: 12, ll: 16, rl: 16 },
  hitBoxes: [
    { loc: 'head', frame: 'torso', c: [0, 8.1, -2.55], h: [0.7, 0.45, 0.6] },
    { loc: 'ct', frame: 'torso', c: [0, 7.6, -0.5], h: [1.4, 1.4, 2.6] },
    { loc: 'ct', frame: 'legs', c: [0, 6.3, 0.25], h: [1.4, 0.7, 1.1] },
    { loc: 'lt', frame: 'torso', c: [-2.2, 8.4, 0.15], h: [1.0, 2.0, 1.75] },
    { loc: 'rt', frame: 'torso', c: [2.2, 8.4, 0.15], h: [1.0, 2.0, 1.75] },
    { loc: 'la', frame: 'torso', c: [-3.45, 6.7, -1.75], h: [0.55, 1.35, 2.15] },
    { loc: 'ra', frame: 'torso', c: [3.45, 6.7, -2.2], h: [0.55, 1.35, 2.6] },
    { loc: 'll', frame: 'legs', c: [-2.1, 3.0, -0.6], h: [0.9, 3.0, 1.6] },
    { loc: 'rl', frame: 'legs', c: [2.1, 3.0, -0.6], h: [0.9, 3.0, 1.6] },
  ],
  heatCapacity: 32,
  heatSinks: 20,
  coolantCharges: 2,
  loadout: [
    { hardpoint: 'hp_la_1', weapon: 'mlas', groups: [1] },
    { hardpoint: 'hp_la_2', weapon: 'mlas', groups: [1] },
    { hardpoint: 'hp_ra_2', weapon: 'mlas', groups: [1] },
    { hardpoint: 'hp_ct_1', weapon: 'llas', groups: [1] },
    { hardpoint: 'hp_ra_1', weapon: 'ac5', groups: [2] },
    { hardpoint: 'hp_lt_1', weapon: 'lrm15', groups: [3] },
    { hardpoint: 'hp_rt_1', weapon: 'lrm15', groups: [3] },
  ],
};

/** Humanoid medium brawler. */
export const WARDEN: ChassisDef = {
  id: 'warden',
  name: 'Warden',
  variant: 'WD-3',
  tonnage: 50,
  legType: 'standard',
  maxSpeed: kph(86),
  reverseFactor: 0.6,
  accel: 9,
  decel: 14,
  legTurnRate: 80 * DEG,
  maxGrade: 1.0,
  twistLimit: 90 * DEG,
  twistRate: 150 * DEG,
  pitchMin: -25 * DEG,
  pitchMax: 22 * DEG,
  hardpoints: [
    { id: 'hp_la_1', location: 'la', type: 'ballistic', muzzle: [-2.0, 6.05, -4.95] },
    { id: 'hp_ra_1', location: 'ra', type: 'energy', muzzle: [1.75, 6.05, -3.65] },
    { id: 'hp_ra_2', location: 'ra', type: 'energy', muzzle: [2.25, 6.05, -3.65] },
    { id: 'hp_lt_1', location: 'lt', type: 'missile', muzzle: [-1.05, 7.75, -1.72] },
    { id: 'hp_head_1', location: 'head', type: 'energy', muzzle: [0.62, 8.8, -0.88] },
  ],
  eyeHeight: 9.0,
  armor: { head: 9, ct: 26, lt: 18, rt: 18, la: 14, ra: 14, ll: 20, rl: 20 },
  structure: { head: 3, ct: 16, lt: 12, rt: 12, la: 8, ra: 8, ll: 12, rl: 12 },
  hitBoxes: [
    { loc: 'head', frame: 'torso', c: [0, 9.05, -0.15], h: [0.5, 0.45, 0.55] },
    { loc: 'ct', frame: 'torso', c: [0, 7.0, 0.1], h: [0.6, 1.6, 1.1] },
    { loc: 'ct', frame: 'legs', c: [0, 4.85, 0], h: [1.2, 0.5, 0.8] },
    { loc: 'lt', frame: 'torso', c: [-1.0, 7.0, 0.1], h: [0.45, 1.6, 1.1] },
    { loc: 'rt', frame: 'torso', c: [1.0, 7.0, 0.1], h: [0.45, 1.6, 1.1] },
    { loc: 'la', frame: 'torso', c: [-2.1, 7.1, -1.9], h: [0.75, 1.6, 2.9] },
    { loc: 'ra', frame: 'torso', c: [2.1, 7.15, -1.3], h: [0.75, 1.6, 2.3] },
    { loc: 'll', frame: 'legs', c: [-1.14, 2.4, -0.3], h: [0.6, 2.4, 0.9] },
    { loc: 'rl', frame: 'legs', c: [1.14, 2.4, -0.3], h: [0.6, 2.4, 0.9] },
  ],
  heatCapacity: 28,
  heatSinks: 14,
  coolantCharges: 2,
  loadout: [
    { hardpoint: 'hp_ra_1', weapon: 'mlas', groups: [1] },
    { hardpoint: 'hp_ra_2', weapon: 'mlas', groups: [1] },
    { hardpoint: 'hp_head_1', weapon: 'llas', groups: [1] },
    { hardpoint: 'hp_la_1', weapon: 'ac20', groups: [2] },
    { hardpoint: 'hp_lt_1', weapon: 'srm6', groups: [3] },
  ],
};

export const CHASSIS: Record<string, ChassisDef> = {
  [IRONCLAW.id]: IRONCLAW,
  [WARDEN.id]: WARDEN,
};

export function getChassis(id: string): ChassisDef {
  return CHASSIS[id] ?? IRONCLAW;
}
