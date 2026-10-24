import type { Mech } from '../sim/mech';
import { dirFromAngles, set3, v3, type Vec3 } from '../sim/vec';
import type { World } from '../sim/world';

const AIM_RANGE = 1200;
const _d = v3();
const _o = v3();

export interface CameraAim {
  /** What the camera's aim ray hits (world). The crosshair sits here. */
  point: Vec3;
  /** Yaw/pitch from the mech's eye to `point` — what the mech should aim at. */
  yaw: number;
  pitch: number;
}

/**
 * Third-person aiming: cast the aim ray from the camera (not the mech), then
 * aim the mech's eye at whatever it hits. This removes the parallax between the
 * crosshair and where the weapons actually converge.
 */
export function aimFromCamera(world: World, mech: Mech, camPos: Vec3, look: Vec3, out: CameraAim): CameraAim {
  const hit = world.combat.raycast(world, camPos, look, AIM_RANGE, mech.id);
  set3(out.point, camPos.x + look.x * hit.t, camPos.y + look.y * hit.t, camPos.z + look.z * hit.t);
  const s = mech.state;
  const dx = out.point.x - s.x;
  const dy = out.point.y - (s.y + mech.def.eyeHeight);
  const dz = out.point.z - s.z;
  out.yaw = Math.atan2(-dx, -dz);
  out.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  return out;
}

/** Where the torso-mounted weapons would land right now: raycast along the torso's facing from the eye. */
export function torsoAimPoint(world: World, mech: Mech, out: Vec3): Vec3 {
  const s = mech.state;
  set3(_o, s.x, s.y + mech.def.eyeHeight, s.z);
  dirFromAngles(s.torsoYaw + s.reelYaw, s.torsoPitch + s.reelPitch, _d);
  const t = world.combat.raycast(world, _o, _d, AIM_RANGE, mech.id).t;
  return set3(out, _o.x + _d.x * t, _o.y + _d.y * t, _o.z + _d.z * t);
}
