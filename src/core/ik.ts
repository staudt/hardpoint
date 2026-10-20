/**
 * Planar two-bone IK for mech legs, in the leg's sagittal plane.
 * Coordinates: `f` = forward distance, `d` = downward distance from the hip to the target.
 * Angles are measured from straight down; positive swings the bone forward.
 * The knee always bends forward (true for both humanoid and reverse-joint mech legs,
 * where the backward "knee" is really the ankle/heel joint handled by a third segment).
 */
export interface TwoBoneSolution {
  /** Absolute angle of the upper bone. */
  upper: number;
  /** Absolute angle of the lower bone. */
  lower: number;
  /** False if the target was out of reach (solution is the closest stretch). */
  reached: boolean;
}

export function solveTwoBone(f: number, d: number, upperLen: number, lowerLen: number): TwoBoneSolution {
  const maxReach = (upperLen + lowerLen) * 0.9995;
  const minReach = Math.abs(upperLen - lowerLen) * 1.0005 + 1e-6;
  let dist = Math.hypot(f, d);
  const reached = dist <= maxReach && dist >= minReach;
  dist = Math.min(Math.max(dist, minReach), maxReach);

  const toTarget = Math.atan2(f, d);
  const cosHip = (upperLen * upperLen + dist * dist - lowerLen * lowerLen) / (2 * upperLen * dist);
  const cosKnee = (upperLen * upperLen + lowerLen * lowerLen - dist * dist) / (2 * upperLen * lowerLen);
  const hip = Math.acos(Math.min(1, Math.max(-1, cosHip)));
  const knee = Math.acos(Math.min(1, Math.max(-1, cosKnee)));

  const upper = toTarget + hip;
  const lower = upper - (Math.PI - knee);
  return { upper, lower, reached };
}

/** End point of the chain for given absolute angles (inverse check / debug). */
export function chainEnd(upper: number, lower: number, upperLen: number, lowerLen: number): { f: number; d: number } {
  return {
    f: Math.sin(upper) * upperLen + Math.sin(lower) * lowerLen,
    d: Math.cos(upper) * upperLen + Math.cos(lower) * lowerLen,
  };
}
