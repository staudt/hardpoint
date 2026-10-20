/** Minimal plain-data vector maths for the sim (no three.js). */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const copy3 = (o: Vec3, a: Vec3): Vec3 => ((o.x = a.x), (o.y = a.y), (o.z = a.z), o);
export const set3 = (o: Vec3, x: number, y: number, z: number): Vec3 => ((o.x = x), (o.y = y), (o.z = z), o);
export const len3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export function normalize3(a: Vec3): Vec3 {
  const l = len3(a) || 1;
  a.x /= l;
  a.y /= l;
  a.z /= l;
  return a;
}

/** Direction from yaw/pitch (yaw 0 faces −Z, pitch > 0 up). */
export function dirFromAngles(yaw: number, pitch: number, out: Vec3 = v3()): Vec3 {
  const c = Math.cos(pitch);
  return set3(out, -Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
}

/** Rotate a mech-local offset by yaw around +Y and add a base position. */
export function localToWorld(base: Vec3, yaw: number, lx: number, ly: number, lz: number, out: Vec3 = v3()): Vec3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return set3(out, base.x + lx * c + lz * s, base.y + ly, base.z - lx * s + lz * c);
}

/**
 * Turn `dir` toward `axis` so the angle between them is at most `maxAngle` (both unit vectors).
 * Used to limit how far a weapon mount can converge away from the torso facing.
 */
export function clampCone(dir: Vec3, axis: Vec3, maxAngle: number): Vec3 {
  const cos = Math.min(1, Math.max(-1, dot3(dir, axis)));
  const angle = Math.acos(cos);
  if (angle <= maxAngle) return dir;
  // Slerp from axis toward dir by maxAngle.
  const perp = v3(dir.x - axis.x * cos, dir.y - axis.y * cos, dir.z - axis.z * cos);
  normalize3(perp);
  const c = Math.cos(maxAngle);
  const s = Math.sin(maxAngle);
  return set3(dir, axis.x * c + perp.x * s, axis.y * c + perp.y * s, axis.z * c + perp.z * s);
}
