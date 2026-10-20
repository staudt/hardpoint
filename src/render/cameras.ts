import * as THREE from 'three';
import type { Input } from '../core/input';

export interface CameraRig {
  /** Called once per rendered frame. `simTime` is deterministic; `frameSeconds` is wall time. */
  update(camera: THREE.PerspectiveCamera, simTime: number, frameSeconds: number): void;
}

export type HeightFn = (x: number, z: number) => number;

/** Slow cinematic orbit around a focus point. Deterministic in sim time (good for screenshots). */
export class OrbitRig implements CameraRig {
  constructor(
    private readonly focus: THREE.Vector3,
    private readonly radius: number,
    private readonly height: number,
    private readonly speed = 0.05,
    private readonly startAngle = 0.6,
  ) {}

  update(camera: THREE.PerspectiveCamera, simTime: number): void {
    const a = this.startAngle + simTime * this.speed;
    camera.position.set(
      this.focus.x + Math.cos(a) * this.radius,
      this.focus.y + this.height,
      this.focus.z + Math.sin(a) * this.radius,
    );
    camera.lookAt(this.focus);
  }
}

/** Debug fly camera: WASD + mouse look (click to lock pointer), Space/C up/down, Shift boost. */
export class FreeRig implements CameraRig {
  private yaw: number;
  private pitch: number;
  private readonly pos: THREE.Vector3;
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly input: Input,
    start: THREE.Vector3,
    lookAt: THREE.Vector3,
    private readonly ground?: HeightFn,
  ) {
    this.pos = start.clone();
    const d = lookAt.clone().sub(start).normalize();
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.asin(d.y);
  }

  update(camera: THREE.PerspectiveCamera, _simTime: number, dt: number): void {
    const { dx, dy } = this.input.consumeMouseDelta();
    this.yaw -= dx * 0.0025;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0025, -1.5, 1.5);
    this.euler.set(this.pitch, this.yaw, 0);
    camera.quaternion.setFromEuler(this.euler);

    const speed = (this.input.isDown('boost') ? 250 : 60) * dt;
    const f = this.input.axis('back', 'forward');
    const s = this.input.axis('left', 'right');
    const u = this.input.axis('down', 'up');
    this.tmp.set(s, 0, -f).applyQuaternion(camera.quaternion).multiplyScalar(speed);
    this.pos.add(this.tmp);
    this.pos.y += u * speed;
    if (this.ground) this.pos.y = Math.max(this.pos.y, this.ground(this.pos.x, this.pos.z) + 2);
    camera.position.copy(this.pos);
  }
}
