import * as THREE from 'three';
import { getWeapon } from '../../data/weapons';
import type { CombatEvent } from '../../sim/combat/events';
import type { World } from '../../sim/world';
import { ParticlePool, type ParticleSpec } from './particles';

const hdr = (hex: number, k: number): THREE.Color => new THREE.Color(hex).multiplyScalar(k);
const FIRE_HOT = hdr(0xffd08a, 6);
const FIRE = hdr(0xff7a2a, 3.5);
const EMBER = hdr(0x7a2a10, 0.6);
const SPARK = hdr(0xffe0a0, 8);
const SMOKE_LIGHT = new THREE.Color(0x9a8f84);
const SMOKE_DARK = new THREE.Color(0x58504a);
const DUST = new THREE.Color(0xc89468);
const DEBRIS = new THREE.Color(0x3c3a34);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const rand = (a: number, b: number): number => a + Math.random() * (b - a);

/**
 * All transient combat visuals: beams, tracers, missiles with smoke trails,
 * muzzle flashes, impacts and explosions. Reads sim state and events; never
 * writes back to the sim.
 */
export class Effects {
  readonly group = new THREE.Group();
  readonly fire: ParticlePool;
  readonly smoke: ParticlePool;
  readonly sparks: ParticlePool;
  readonly debris: ParticlePool;
  private readonly beamCore: THREE.InstancedMesh;
  private readonly beamGlow: THREE.InstancedMesh;
  private readonly tracers: THREE.InstancedMesh;
  private readonly missiles: THREE.InstancedMesh;
  private readonly flames: THREE.InstancedMesh;
  private trailTimer = 0;
  /** Called for each sim event after visuals are spawned (audio hooks in here). */
  onEvent: ((e: CombatEvent) => void) | null = null;

  constructor(ground: (x: number, z: number) => number) {
    this.group.name = 'effects';
    const puff = new THREE.IcosahedronGeometry(1, 0);
    const cube = new THREE.BoxGeometry(1, 1, 1);
    const additive = (opacity = 1): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({ transparent: opacity < 1, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

    this.fire = new ParticlePool(puff, new THREE.MeshBasicMaterial({ fog: false }), 1500);
    this.smoke = new ParticlePool(
      puff,
      new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1, transparent: true, opacity: 0.55, depthWrite: false }),
      3000,
    );
    this.sparks = new ParticlePool(cube, additive(), 1500);
    this.debris = new ParticlePool(cube, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 }), 600, ground);
    this.debris.mesh.castShadow = true;

    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
    this.beamCore = makeInstanced(beamGeo, additive(), 64);
    this.beamGlow = makeInstanced(beamGeo, additive(0.35), 64);
    this.tracers = makeInstanced(new THREE.BoxGeometry(1, 1, 1), additive(), 256);
    const missileGeo = new THREE.CylinderGeometry(0.16, 0.16, 1.1, 5).rotateX(Math.PI / 2);
    this.missiles = makeInstanced(missileGeo, new THREE.MeshStandardMaterial({ color: 0x8a8a80, flatShading: true }), 256);
    this.flames = makeInstanced(new THREE.IcosahedronGeometry(1, 0), additive(), 256);

    this.group.add(
      this.fire.mesh, this.smoke.mesh, this.sparks.mesh, this.debris.mesh,
      this.beamCore, this.beamGlow, this.tracers, this.missiles, this.flames,
    );
  }

  /** Per frame: mirror beams/projectiles, spawn trails and beam sparks, process events, age particles. */
  update(world: World, alpha: number, dt: number): void {
    for (const e of world.combat.drainEvents()) {
      this.handle(world, e);
      this.onEvent?.(e);
    }
    this.syncBeams(world, dt);
    this.syncProjectiles(world, alpha, dt);
    this.fire.update(dt);
    this.smoke.update(dt);
    this.sparks.update(dt);
    this.debris.update(dt);
  }

  // ------------------------------------------------------------ beams
  private syncBeams(world: World, dt: number): void {
    const beams = world.combat.beams;
    let n = 0;
    for (const b of beams) {
      if (n >= 64) break;
      const color = getWeapon(b.weaponId).color;
      _a.set(b.from.x, b.from.y, b.from.z);
      _b.set(b.to.x, b.to.y, b.to.z);
      _d.subVectors(_b, _a);
      const len = _d.length();
      if (len < 0.01) continue;
      _q.setFromUnitVectors(Y, _d.divideScalar(len));
      const flicker = 0.85 + Math.random() * 0.3;
      this.beamCore.setMatrixAt(n, _m.compose(_a, _q, _s.set(0.09 * flicker, len, 0.09 * flicker)));
      this.beamCore.setColorAt(n, hdr(color, 1).lerp(new THREE.Color(1, 1, 1), 0.5).multiplyScalar(7));
      this.beamGlow.setMatrixAt(n, _m.compose(_a, _q, _s.set(0.32 * flicker, len, 0.32 * flicker)));
      this.beamGlow.setColorAt(n, hdr(color, 2.5));
      n++;
      // Burning impact point.
      if (Math.random() < dt * 40) {
        const onMech = b.hitMech !== 0;
        this.burst(this.sparks, _b, onMech ? 3 : 1, 6, 14, 0.12, 0.25, SPARK, SPARK, 25);
        if (Math.random() < 0.3) this.puff(this.smoke, _b, onMech ? SMOKE_DARK : DUST, 0.6, 1.4, 1.0, 1.5);
      }
    }
    this.beamCore.count = this.beamGlow.count = n;
    for (const m of [this.beamCore, this.beamGlow]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------ projectiles
  private syncProjectiles(world: World, alpha: number, dt: number): void {
    let nt = 0;
    let nm = 0;
    this.trailTimer += dt;
    const emitTrail = this.trailTimer >= 0.035;
    if (emitTrail) this.trailTimer = 0;
    for (const p of world.combat.projectiles) {
      _a.set(p.prev.x + (p.pos.x - p.prev.x) * alpha, p.prev.y + (p.pos.y - p.prev.y) * alpha, p.prev.z + (p.pos.z - p.prev.z) * alpha);
      _d.set(p.vel.x, p.vel.y, p.vel.z).normalize();
      _q.setFromUnitVectors(Z, _d);
      const color = getWeapon(p.weaponId).color;
      if (p.kind === 'srm' || p.kind === 'lrm') {
        if (nm < 256) {
          this.missiles.setMatrixAt(nm, _m.compose(_a, _q, _s.set(1, 1, 1)));
          _b.copy(_a).addScaledVector(_d, -0.7);
          this.flames.setMatrixAt(nm, _m.compose(_b, _q, _s.set(0.28, 0.28, 0.5)));
          this.flames.setColorAt(nm, FIRE_HOT);
          nm++;
        }
        if (emitTrail) this.puff(this.smoke, _b, SMOKE_LIGHT, 0.35, 1.6, 1.4, 0.4, 0.4);
      } else if (nt < 256) {
        const big = p.kind === 'bolt' ? 0.55 : p.kind === 'shell' ? 0.22 + p.damage * 0.012 : 0.07;
        const len = p.kind === 'bolt' ? 7 : p.kind === 'shell' ? 9 : 4;
        _b.copy(_a).addScaledVector(_d, -len / 2);
        this.tracers.setMatrixAt(nt, _m.compose(_b, _q, _s.set(big, big, len)));
        this.tracers.setColorAt(nt, hdr(color, p.kind === 'bolt' ? 9 : 6));
        nt++;
      }
    }
    this.tracers.count = nt;
    this.missiles.count = this.flames.count = nm;
    for (const m of [this.tracers, this.missiles, this.flames]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------ events
  private handle(world: World, e: CombatEvent): void {
    switch (e.type) {
      case 'fire': {
        const w = getWeapon(e.weaponId);
        _a.set(e.x, e.y, e.z);
        if (w.type === 'ballistic') {
          this.burst(this.fire, _a, w.delivery === 'stream' ? 1 : 4, 2, 8, 0.25, 0.8 + w.damage * 0.03, FIRE_HOT, FIRE, 0, 0.12);
          if (w.delivery !== 'stream') this.puff(this.smoke, _a, SMOKE_LIGHT, 0.6, 2.2, 1.2, 0.8);
        } else if (w.type === 'missile') {
          this.puff(this.smoke, _a, SMOKE_LIGHT, 1.0, 3.0, 1.5, 0.6);
        } else if (w.delivery === 'bolt') {
          this.burst(this.sparks, _a, 10, 5, 15, 0.15, 0.3, hdr(w.color, 9), hdr(w.color, 2), 0);
        }
        break;
      }
      case 'impact': {
        const w = getWeapon(e.weaponId);
        _a.set(e.x, e.y + 0.3, e.z);
        const scale = w.delivery === 'stream' ? 0.25 : w.type === 'missile' ? 0.7 + w.damage * 0.25 : 0.6 + w.damage * 0.06;
        this.explosion(_a, scale, e.mechId === 0);
        break;
      }
      case 'locDestroyed':
      case 'ammoExplosion': {
        const m = world.getMech(e.mechId);
        if (!m) break;
        const box = m.def.hitBoxes.find((b) => b.loc === e.loc);
        _a.set(m.state.x, m.state.y + (box ? box.c[1] : 6), m.state.z);
        this.explosion(_a, e.type === 'ammoExplosion' ? 3.2 : 1.8, false);
        this.burst(this.debris, _a, 14, 6, 16, 0.25, 0.7, DEBRIS, DEBRIS, 22, 5);
        break;
      }
      case 'mechDestroyed': {
        const m = world.getMech(e.mechId);
        if (!m) break;
        _a.set(m.state.x, m.state.y + m.def.eyeHeight * 0.7, m.state.z);
        this.explosion(_a, 4.5, false);
        this.burst(this.debris, _a, 40, 8, 24, 0.3, 1.0, DEBRIS, DEBRIS, 22, 6);
        break;
      }
      case 'coolant': {
        const m = world.getMech(e.mechId);
        if (!m) break;
        _a.set(m.state.x, m.state.y + m.def.eyeHeight * 0.7, m.state.z);
        for (let i = 0; i < 16; i++) this.puff(this.smoke, _a, new THREE.Color(0xe8f0f4), 1.2, 4, 2.2, 4, 3);
        break;
      }
      default:
        break;
    }
  }

  /** Fireball + sparks + smoke; `scale` ~1 for a missile hit, ~4 for a mech death. */
  explosion(at: THREE.Vector3, scale: number, onGround: boolean): void {
    const n = Math.round(4 + scale * 4);
    for (let i = 0; i < n; i++) {
      this.fire.spawn({
        x: at.x + rand(-1, 1) * scale, y: at.y + rand(-0.5, 1) * scale, z: at.z + rand(-1, 1) * scale,
        vx: rand(-3, 3) * scale, vy: rand(1, 5) * scale, vz: rand(-3, 3) * scale,
        life: rand(0.35, 0.7) * (0.8 + scale * 0.15), size0: rand(0.6, 1.1) * scale, size1: rand(1.3, 2) * scale,
        color0: FIRE_HOT, color1: EMBER, drag: 3,
      });
    }
    this.burst(this.sparks, at, Math.round(6 + scale * 6), 8, 22 * Math.sqrt(scale), 0.1, 0.25, SPARK, FIRE, 20);
    const smokes = Math.round(2 + scale * 3);
    for (let i = 0; i < smokes; i++) this.puff(this.smoke, at, onGround ? DUST : SMOKE_DARK, 0.8 * scale, 2.6 * scale, rand(1.5, 3) * (0.7 + scale * 0.2), 1.5 * scale, scale);
  }

  /** Smoke column / puff helper. `rise` = upward speed, `jitter` = random horizontal speed. */
  puff(pool: ParticlePool, at: THREE.Vector3, color: THREE.Color, size0: number, size1: number, life: number, rise: number, jitter = 0.6): void {
    const spec: ParticleSpec = {
      x: at.x + rand(-0.3, 0.3), y: at.y, z: at.z + rand(-0.3, 0.3),
      vx: rand(-jitter, jitter), vy: rise * rand(0.6, 1.2), vz: rand(-jitter, jitter),
      life, size0, size1, color0: color, color1: color.clone().lerp(SMOKE_LIGHT, 0.3), drag: 0.8,
    };
    pool.spawn(spec);
  }

  /** Radial burst of particles (sparks, debris). */
  burst(
    pool: ParticlePool, at: THREE.Vector3, count: number, minSpeed: number, maxSpeed: number,
    size0: number, size1: number, c0: THREE.Color, c1: THREE.Color, gravity = 0, lifeOrStretch = 0.35,
  ): void {
    const isDebris = pool === this.debris;
    for (let i = 0; i < count; i++) {
      _d.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(minSpeed, maxSpeed));
      pool.spawn({
        x: at.x, y: at.y, z: at.z, vx: _d.x, vy: _d.y + (isDebris ? 6 : 0), vz: _d.z,
        life: isDebris ? lifeOrStretch + rand(0, 2) : rand(0.2, 0.5),
        size0, size1, color0: c0, color1: c1, gravity, drag: isDebris ? 0.2 : 1.5,
        ground: isDebris, stretch: pool === this.sparks ? 0.04 : 0,
      });
    }
  }
}

function makeInstanced(geo: THREE.BufferGeometry, mat: THREE.Material, max: number): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, max);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false;
  m.count = 0;
  return m;
}

/** Re-export for MechView emitters. */
export { FIRE, FIRE_HOT, SMOKE_DARK, SMOKE_LIGHT, SPARK, DEBRIS };
