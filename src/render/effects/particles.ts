import * as THREE from 'three';

export interface ParticleSpec {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size0: number;
  size1: number;
  color0: THREE.Color;
  color1?: THREE.Color;
  /** m/s² downward. */
  gravity?: number;
  /** Fraction of velocity lost per second. */
  drag?: number;
  /** Bounce off / rest on the ground (debris). */
  ground?: boolean;
  /** Stretch along velocity (sparks, tracers). */
  stretch?: number;
}

const STRIDE = 24;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const _v = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

/**
 * Fixed-capacity particle pool rendered as one InstancedMesh (one draw call).
 * Packed in a Float32Array; dead particles are swap-removed.
 */
export class ParticlePool {
  readonly mesh: THREE.InstancedMesh;
  private readonly data: Float32Array;
  private count = 0;

  constructor(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    readonly capacity: number,
    private readonly groundAt: (x: number, z: number) => number = () => -Infinity,
  ) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.data = new Float32Array(capacity * STRIDE);
  }

  get alive(): number {
    return this.count;
  }

  spawn(p: ParticleSpec): void {
    if (this.count >= this.capacity) return; // drop when saturated
    const o = this.count++ * STRIDE;
    const d = this.data;
    const c1 = p.color1 ?? p.color0;
    d[o] = p.x; d[o + 1] = p.y; d[o + 2] = p.z;
    d[o + 3] = p.vx ?? 0; d[o + 4] = p.vy ?? 0; d[o + 5] = p.vz ?? 0;
    d[o + 6] = 0; d[o + 7] = p.life;
    d[o + 8] = p.size0; d[o + 9] = p.size1;
    d[o + 10] = p.color0.r; d[o + 11] = p.color0.g; d[o + 12] = p.color0.b;
    d[o + 13] = c1.r; d[o + 14] = c1.g; d[o + 15] = c1.b;
    d[o + 16] = p.gravity ?? 0; d[o + 17] = p.drag ?? 0;
    d[o + 18] = Math.random() * Math.PI * 2; d[o + 19] = Math.random() * Math.PI * 2;
    d[o + 20] = (Math.random() - 0.5) * 4; // spin rate
    d[o + 21] = p.ground ? 1 : 0;
    d[o + 22] = p.stretch ?? 0;
  }

  update(dt: number): void {
    const d = this.data;
    let i = 0;
    while (i < this.count) {
      const o = i * STRIDE;
      d[o + 6]! += dt;
      if (d[o + 6]! >= d[o + 7]!) {
        // Swap-remove.
        const last = (this.count - 1) * STRIDE;
        if (o !== last) d.copyWithin(o, last, last + STRIDE);
        this.count--;
        continue;
      }
      const drag = Math.max(0, 1 - d[o + 17]! * dt);
      d[o + 3]! *= drag;
      d[o + 4] = d[o + 4]! * drag - d[o + 16]! * dt;
      d[o + 5]! *= drag;
      d[o]! += d[o + 3]! * dt;
      d[o + 1]! += d[o + 4]! * dt;
      d[o + 2]! += d[o + 5]! * dt;
      if (d[o + 21]) {
        const g = this.groundAt(d[o]!, d[o + 2]!);
        if (d[o + 1]! < g) {
          d[o + 1] = g;
          d[o + 4] = Math.abs(d[o + 4]!) * 0.3;
          d[o + 3]! *= 0.5;
          d[o + 5]! *= 0.5;
          d[o + 20]! *= 0.5;
        }
      }
      d[o + 18]! += d[o + 20]! * dt;

      const t = d[o + 6]! / d[o + 7]!;
      const size = d[o + 8]! + (d[o + 9]! - d[o + 8]!) * t;
      _p.set(d[o]!, d[o + 1]!, d[o + 2]!);
      const stretch = d[o + 22]!;
      if (stretch > 0) {
        _v.set(d[o + 3]!, d[o + 4]!, d[o + 5]!);
        const speed = _v.length();
        _q.setFromUnitVectors(Z, speed > 1e-3 ? _v.divideScalar(speed) : Z);
        _s.set(size, size, size + speed * stretch);
      } else {
        _q.setFromEuler(_e.set(d[o + 18]!, d[o + 19]!, 0));
        _s.setScalar(size);
      }
      this.mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      _c.setRGB(
        d[o + 10]! + (d[o + 13]! - d[o + 10]!) * t,
        d[o + 11]! + (d[o + 14]! - d[o + 11]!) * t,
        d[o + 12]! + (d[o + 15]! - d[o + 12]!) * t,
      );
      this.mesh.setColorAt(i, _c);
      i++;
    }
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
