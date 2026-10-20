import * as THREE from 'three';
import { HIT_LOCATIONS, type HitLocation } from '../../data/chassis';
import { localToWorld, v3 } from '../../sim/vec';
import { FIRE, FIRE_HOT, SMOKE_DARK, SPARK, type Effects } from '../effects/effects';
import type { MechView } from './mechView';

const SCORCH = new THREE.Color(0x1a1512);
const DETACHABLE: HitLocation[] = ['la', 'ra', 'lt', 'rt', 'head'];

interface LocMaterial {
  mat: THREE.MeshStandardMaterial;
  base: THREE.Color;
  baseEmissive: number;
}

interface Debris {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  resting: boolean;
  age: number;
  emit: number;
}

const _p = new THREE.Vector3();
const _w = v3();

/**
 * Visual damage for one mech: per-location scorch tint, smoke/sparks/fire
 * emitters from damaged locations, limbs detaching as tumbling debris.
 * Polls the sim's combat state; never mutates it.
 */
export class MechDamageView {
  private readonly materials = new Map<HitLocation, LocMaterial[]>();
  private readonly detached = new Set<HitLocation>();
  private readonly debris: Debris[] = [];
  private readonly timers = new Map<HitLocation, number>();
  private deathTime = -1;

  constructor(
    private readonly view: MechView,
    private readonly scene: THREE.Scene,
    private readonly effects: Effects,
    private readonly ground: (x: number, z: number) => number,
  ) {
    const rig = view.rig;
    const roots = new Map<THREE.Object3D, HitLocation>();
    for (const [loc, node] of Object.entries(rig.locations)) roots.set(node, loc as HitLocation);
    // Give each location its own material instances so it can be tinted independently.
    const visit = (o: THREE.Object3D, loc: HitLocation, cache: Map<THREE.Material, LocMaterial>): void => {
      const own = roots.get(o);
      if (own && own !== loc) return visit(o, own, new Map());
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
        let lm = cache.get(o.material);
        if (!lm) {
          const mat = o.material.clone();
          lm = { mat, base: mat.color.clone(), baseEmissive: mat.emissiveIntensity };
          cache.set(o.material, lm);
          const list = this.materials.get(loc) ?? [];
          list.push(lm);
          this.materials.set(loc, list);
        }
        o.material = lm.mat;
      }
      for (const c of o.children) visit(c, loc, cache);
    };
    visit(rig.pelvis, 'ct', new Map());
  }

  get dead(): boolean {
    return this.deathTime >= 0;
  }

  /** Seconds since death (−1 while alive). */
  get timeDead(): number {
    return this.deathTime;
  }

  update(dt: number): void {
    const combat = this.view.mech.combat;
    if (!combat.alive && this.deathTime < 0) this.deathTime = 0;
    if (this.deathTime >= 0) this.deathTime += dt;

    for (const loc of HIT_LOCATIONS) {
      const integrity = combat.integrity(loc);
      const k = combat.destroyed[loc] || this.dead ? 0.85 : (1 - integrity) * 0.7;
      for (const lm of this.materials.get(loc) ?? []) {
        lm.mat.color.copy(lm.base).lerp(SCORCH, k);
        lm.mat.emissiveIntensity = this.dead ? 0 : lm.baseEmissive;
      }
      if (combat.destroyed[loc] && DETACHABLE.includes(loc) && !this.detached.has(loc)) this.detach(loc);
      this.emit(loc, integrity, combat.destroyed[loc], dt);
    }
    if (this.dead && this.deathTime < 25) this.emitDeath(dt);
    this.updateDebris(dt);
  }

  /** World position of a location (centre of its first hit box). */
  private locationPos(loc: HitLocation, out: THREE.Vector3): THREE.Vector3 {
    const m = this.view.mech;
    const box = m.def.hitBoxes.find((b) => b.loc === loc);
    if (!box) return out.copy(this.view.position);
    const yaw = box.frame === 'torso' ? this.view.torsoYaw : this.view.legYaw;
    const p = this.view.position;
    localToWorld({ x: p.x, y: p.y, z: p.z }, yaw, box.c[0], box.c[1] - (this.dead ? Math.min(this.deathTime, 1.5) * 2.5 : 0), box.c[2], _w);
    return out.set(_w.x, _w.y, _w.z);
  }

  private emit(loc: HitLocation, integrity: number, destroyed: boolean, dt: number): void {
    if (integrity > 0.5 && !destroyed) return;
    if (destroyed && this.detached.has(loc)) return;
    const t = (this.timers.get(loc) ?? 0) + dt;
    const interval = destroyed ? 0.12 : integrity < 0.25 ? 0.18 : 0.35;
    if (t < interval) {
      this.timers.set(loc, t);
      return;
    }
    this.timers.set(loc, 0);
    this.locationPos(loc, _p);
    this.effects.puff(this.effects.smoke, _p, SMOKE_DARK, 0.5, 1.8, 2.2, 5, 0.8);
    if (integrity < 0.25 || destroyed) {
      if (Math.random() < 0.5) this.effects.burst(this.effects.sparks, _p, 5, 4, 12, 0.1, 0.2, SPARK, FIRE, 20);
      if (destroyed && Math.random() < 0.6) this.effects.puff(this.effects.fire, _p, FIRE_HOT, 0.5, 0.9, 0.4, 2, 0.4);
    }
  }

  private emitDeath(dt: number): void {
    const t = (this.timers.get('ct') ?? 0) + dt;
    if (t < 0.08) {
      this.timers.set('ct', t);
      return;
    }
    this.timers.set('ct', 0);
    this.locationPos('ct', _p);
    this.effects.puff(this.effects.smoke, _p, SMOKE_DARK, 0.8, 3.2, 4.5, 8, 1.5);
    if (this.deathTime < 8) this.effects.puff(this.effects.fire, _p, FIRE, 0.8, 1.6, 0.5, 3, 1);
  }

  private detach(loc: HitLocation): void {
    const node = this.view.rig.locations[loc as Exclude<HitLocation, 'ct'>];
    this.detached.add(loc);
    if (!node || !node.parent) return;
    // Legs stay attached (the mech needs them); everything else flies off.
    this.scene.attach(node);
    const outward = new THREE.Vector3().subVectors(node.getWorldPosition(_p), this.view.position).setY(0).normalize();
    this.debris.push({
      obj: node,
      vel: outward.multiplyScalar(4 + Math.random() * 4).setY(5 + Math.random() * 4),
      spin: new THREE.Vector3(Math.random() * 4 - 2, Math.random() * 3 - 1.5, Math.random() * 4 - 2),
      resting: false,
      age: 0,
      emit: 0,
    });
  }

  private updateDebris(dt: number): void {
    for (const d of this.debris) {
      d.age += dt;
      d.emit += dt;
      if (d.age < 30 && d.emit > 0.25) {
        d.emit = 0;
        d.obj.getWorldPosition(_p);
        if (Math.random() < 0.6) this.effects.puff(this.effects.smoke, _p, SMOKE_DARK, 0.4, 1.8, 2, 2.5, 0.5);
      }
      if (d.resting) continue;
      d.vel.y -= 22 * dt;
      d.obj.position.addScaledVector(d.vel, dt);
      d.obj.rotation.x += d.spin.x * dt;
      d.obj.rotation.y += d.spin.y * dt;
      d.obj.rotation.z += d.spin.z * dt;
      const g = this.ground(d.obj.position.x, d.obj.position.z);
      if (d.obj.position.y < g + 0.6) {
        d.obj.position.y = g + 0.6;
        if (Math.abs(d.vel.y) < 3) d.resting = true;
        d.vel.multiplyScalar(0.35);
        d.vel.y = Math.abs(d.vel.y);
        d.spin.multiplyScalar(0.4);
      }
    }
  }
}
