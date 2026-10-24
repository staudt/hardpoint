export const SCENES = ['desert', 'test', 'viewer'] as const;
export type SceneId = (typeof SCENES)[number];

export const CAMERAS = ['orbit', 'free', 'chase', 'cockpit'] as const;
export type CameraMode = (typeof CAMERAS)[number];

export interface GameParams {
  scene: SceneId;
  seed: number;
  cam: CameraMode;
  /** If set: fast-forward the sim to this time (s) and freeze — for deterministic screenshots. */
  freezeAt: number | null;
  debug: boolean;
  /** Optional free-camera pose for screenshots: `pos=x,y,z&look=x,y,z` (y is height above terrain). */
  camPos: Vec3 | null;
  camLook: Vec3 | null;
  /** Chassis id for the player (and the model shown by `scene=viewer`). */
  mech: string;
  /** Debug autopilot for screenshots: walk forward at this throttle (-1..1) while turning `turn` rad/s. */
  walk: number;
  turn: number;
  /** Debug autopilot trigger: bitmask of weapon groups to hold (auto-targets the nearest enemy). */
  fire: number;
  /** Game mode: Instant Action waves, training-range dummies, or empty. */
  mode: GameMode;
}

export const MODES = ['instant', 'range', 'none'] as const;
export type GameMode = (typeof MODES)[number];

export type Vec3 = [number, number, number];

export const DEFAULT_PARAMS: GameParams = {
  scene: 'desert',
  seed: 1,
  cam: 'cockpit',
  freezeAt: null,
  debug: false,
  camPos: null,
  camLook: null,
  mech: 'ironclaw',
  walk: 0,
  turn: 0,
  fire: 0,
  mode: 'instant',
};

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Parse `?scene=desert&seed=3&cam=free&t=2.5&debug=1`. Unknown/invalid values fall back to defaults. */
export function parseParams(search: string): GameParams {
  const q = new URLSearchParams(search);
  const seed = Number.parseInt(q.get('seed') ?? '', 10);
  const t = Number.parseFloat(q.get('t') ?? '');
  return {
    scene: oneOf(q.get('scene'), SCENES, DEFAULT_PARAMS.scene),
    seed: Number.isFinite(seed) ? seed : DEFAULT_PARAMS.seed,
    cam: oneOf(q.get('cam'), CAMERAS, DEFAULT_PARAMS.cam),
    freezeAt: Number.isFinite(t) && t >= 0 ? t : null,
    debug: q.get('debug') === '1' || q.get('debug') === 'true',
    camPos: parseVec3(q.get('pos')),
    camLook: parseVec3(q.get('look')),
    mech: q.get('mech') ?? DEFAULT_PARAMS.mech,
    walk: finiteOr(q.get('walk'), 0),
    turn: finiteOr(q.get('turn'), 0),
    fire: finiteOr(q.get('fire'), 0),
    mode: oneOf(q.get('mode'), MODES, defaultMode(q.get('scene'))),
  };
}

function parseVec3(value: string | null): Vec3 | null {
  if (!value) return null;
  const parts = value.split(',').map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? (parts as Vec3) : null;
}

function finiteOr(value: string | null, fallback: number): number {
  const n = Number.parseFloat(value ?? '');
  return Number.isFinite(n) ? n : fallback;
}

function defaultMode(scene: string | null): GameMode {
  if (scene === 'viewer') return 'none';
  if (scene === 'test') return 'range';
  return 'instant';
}
