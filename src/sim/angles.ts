export const DEG = Math.PI / 180;

/** Wrap to [-π, π). */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

/** Signed shortest difference `to - from`, in [-π, π). */
export function angleDiff(from: number, to: number): number {
  return wrapAngle(to - from);
}

/** Rotate `from` toward `to` by at most `maxStep` radians along the shortest arc. */
export function approachAngle(from: number, to: number, maxStep: number): number {
  const d = angleDiff(from, to);
  if (Math.abs(d) <= maxStep) return to;
  return wrapAngle(from + Math.sign(d) * maxStep);
}

export function approach(from: number, to: number, maxStep: number): number {
  if (Math.abs(to - from) <= maxStep) return to;
  return from + Math.sign(to - from) * maxStep;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Unit forward vector for a yaw (yaw 0 faces −Z; positive yaw turns left, like three.js rotation.y). */
export function forwardX(yaw: number): number {
  return -Math.sin(yaw);
}
export function forwardZ(yaw: number): number {
  return -Math.cos(yaw);
}
