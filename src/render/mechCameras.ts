import * as THREE from 'three';
import type { PlayerController } from '../controls/playerController';
import type { CameraRig, HeightFn } from './cameras';
import type { MechView } from './mechs/mechView';

const _dir = new THREE.Vector3();
const _target = new THREE.Vector3();

function aimDirection(yaw: number, pitch: number, out: THREE.Vector3): THREE.Vector3 {
  const c = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
}

/**
 * Over-the-shoulder chase camera. Follows the aim (mouse) direction; the torso
 * catches up at its twist rate. The view is tilted down a little so the whole
 * mech is in frame — the HUD crosshair is placed at the projected aim point.
 */
export class ChaseRig implements CameraRig {
  distance = 23;
  shoulder = 5.5;
  tilt = -0.13;
  private readonly pos = new THREE.Vector3();
  private initialized = false;

  constructor(
    private readonly view: MechView,
    private readonly controller: PlayerController,
    private readonly ground: HeightFn,
  ) {}

  update(camera: THREE.PerspectiveCamera, _simTime: number, dt: number): void {
    const h = this.view.rig.height;
    const yaw = this.controller.aimYaw;
    aimDirection(yaw, this.controller.aimPitch * 0.5, _dir);
    _target.copy(this.view.position).setY(this.view.position.y + h * 0.9);
    const desired = _target.clone().addScaledVector(_dir, -this.distance);
    desired.x += Math.cos(yaw) * this.shoulder;
    desired.z -= Math.sin(yaw) * this.shoulder;
    desired.y += h * 0.3;
    desired.y = Math.max(desired.y, this.ground(desired.x, desired.z) + 2.5);
    if (!this.initialized) {
      this.pos.copy(desired);
      this.initialized = true;
    }
    // Slight vertical smoothing only — horizontal follows exactly so aiming stays crisp.
    this.pos.x = desired.x;
    this.pos.z = desired.z;
    this.pos.y += (desired.y - this.pos.y) * Math.min(1, dt * 10);
    camera.position.copy(this.pos);
    aimDirection(yaw, this.controller.aimPitch + this.tilt, _dir);
    camera.lookAt(_target.copy(this.pos).add(_dir));
  }
}

/** World point the player is aiming at (for the crosshair): along the aim from the mech's cockpit height. */
export function aimPoint(view: MechView, controller: PlayerController, distance: number, out: THREE.Vector3): THREE.Vector3 {
  aimDirection(controller.aimYaw, controller.aimPitch, out).multiplyScalar(distance);
  out.x += view.position.x;
  out.z += view.position.z;
  out.y += view.position.y + view.rig.height * 0.8;
  return out;
}

/**
 * First-person cockpit camera rigidly attached to the torso. It inherits the body's
 * stride bob, sway and hit reel; on top of that each landing dips the nose, as the
 * cockpit's weight carries on after the foot stops.
 */
export class CockpitRig implements CameraRig {
  constructor(private readonly view: MechView) {}

  update(camera: THREE.PerspectiveCamera): void {
    const cockpit = this.view.rig.cockpit;
    cockpit.updateWorldMatrix(true, false);
    cockpit.getWorldPosition(camera.position);
    cockpit.getWorldQuaternion(camera.quaternion);
    const impact = this.view.gait.impact;
    camera.position.y -= impact * 0.2;
    camera.rotateX(-impact * 0.12);
  }
}
