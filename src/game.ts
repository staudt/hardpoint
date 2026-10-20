import * as THREE from 'three';
import { Sfx, type SfxName } from './audio/sfx';
import { FixedStepLoop } from './core/loop';
import { Input } from './core/input';
import type { CameraMode, GameParams } from './core/params';
import { aimFromCamera, torsoAimPoint, type CameraAim } from './controls/aim';
import { PlayerController } from './controls/playerController';
import { HIT_LOCATIONS, getChassis, type ChassisDef, type HitLocation } from './data/chassis';
import { getWeapon } from './data/weapons';
import { dummyCommand, type Dummy, type DummyMode } from './sim/ai/dummy';
import { InstantAction } from './sim/mission/instantAction';
import { angleDiff } from './sim/angles';
import type { CombatEvent } from './sim/combat/events';
import type { Mech } from './sim/mech';
import { DesertTerrain, type HeightField } from './sim/terrain';
import { createTerrain } from './sim/terrains';
import { World } from './sim/world';
import { FreeRig, OrbitRig, type CameraRig } from './render/cameras';
import { Effects } from './render/effects/effects';
import { ChaseRig, CockpitRig } from './render/mechCameras';
import { MechDamageView } from './render/mechs/damageView';
import { MechView } from './render/mechs/mechView';
import { buildMechRig } from './render/mechs/registry';
import { Stage } from './render/stage';
import { FpsCounter } from './ui/fpsCounter';
import { Hud, type HudTarget } from './ui/hud';
import { buildDesert } from './world/desert/desert';
import { buildTestScene } from './world/testScene';
import type { Battlefield } from './world/types';

const LOC_NAMES: Record<HitLocation, string> = {
  head: 'HEAD', ct: 'CENTER TORSO', lt: 'LEFT TORSO', rt: 'RIGHT TORSO', la: 'LEFT ARM', ra: 'RIGHT ARM', ll: 'LEFT LEG', rl: 'RIGHT LEG',
};

/** Training range layout: [chassis, x, z, behaviour] relative to the spawn. */
const DUMMY_WAVE: [string, number, number, DummyMode][] = [
  ['warden', -50, -180, 'stand'],
  ['ironclaw', 80, -260, 'patrol'],
  ['warden', -140, -340, 'strafe'],
  ['ironclaw', 160, -430, 'stand'],
];

const FIRE_SOUND: Record<string, SfxName> = {
  llas: 'laser_light', mlas: 'laser_med', hlas: 'laser_heavy', pcan: 'pcannon', mg: 'mg',
  ac5: 'ac_light', ac20: 'ac_heavy', srm6: 'missile_launch', lrm15: 'missile_launch',
};

interface ViewEntry {
  view: MechView;
  damage: MechDamageView;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _camAim: CameraAim = { point: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 };
const _torsoPt = { x: 0, y: 0, z: 0 };

/** Wires simulation, rendering, input, cameras, audio and UI together. */
export class Game {
  readonly world: World;
  readonly stage: Stage;
  readonly input: Input;
  readonly loop: FixedStepLoop;
  readonly battlefield: Battlefield;
  readonly effects: Effects;
  readonly sfx = new Sfx();
  player!: Mech;
  playerView!: MechView;
  controller!: PlayerController;
  readonly views = new Map<number, ViewEntry>();
  private readonly dummies: Dummy[] = [];
  /** Instant Action mission (mode=instant). */
  mission: InstantAction | null = null;
  private readonly chassis: ChassisDef;
  private readonly container: HTMLElement;
  private hud!: Hud;
  private readonly cockpitFrame: HTMLDivElement;
  private readonly fps: FpsCounter;
  private mode: CameraMode = 'chase';
  private rig!: CameraRig;
  private frozen = false;
  private lastFrame = 0;
  private shake = 0;
  private waveTimer = -1;
  private lastIntegrity = 0;
  private hitSoundTimer = 0;
  private heatWarnTimer = 0;
  private lockToneTimer = 0;
  private wasLocked = false;
  frames = 0;

  constructor(
    container: HTMLElement,
    readonly params: GameParams,
  ) {
    this.container = container;
    const terrain = createTerrain(params.scene, params.seed);
    this.world = new World(params.seed, terrain);
    if (params.scene === 'desert') this.world.ambientCooling = 0.85;
    this.stage = new Stage(container);
    this.input = new Input(this.stage.canvas);
    this.battlefield = buildBattlefield(params, this.stage.scene, terrain);
    const ground = (x: number, z: number): number => terrain.heightAt(x, z);
    this.effects = new Effects(ground);
    this.stage.scene.add(this.effects.group);
    this.effects.onEvent = (e) => this.onCombatEvent(e);

    this.chassis = getChassis(params.mech);
    this.cockpitFrame = document.createElement('div');
    this.cockpitFrame.className = 'cockpit-frame';
    container.appendChild(this.cockpitFrame);
    this.fps = new FpsCounter(container, this.stage);
    this.spawnPlayer();
    if (params.mode === 'range') this.spawnWave();
    if (params.mode === 'instant') {
      this.mission = new InstantAction(this.world, this.player);
      void this.world.nav; // build the nav grid up front, not on the first AI think
    }
    this.setMode(params.scene === 'viewer' && !params.camPos ? 'orbit' : params.camPos ? 'free' : params.cam);

    this.stage.canvas.addEventListener('mousedown', () => this.sfx.unlock());
    window.addEventListener('keydown', () => this.sfx.unlock(), { once: true });

    this.loop = new FixedStepLoop({
      step: (dt) => this.step(dt),
      render: (alpha, frameSeconds) => this.render(alpha, frameSeconds),
    });

    if (params.freezeAt !== null) {
      // Advance sim and visuals together so frozen frames show real poses and effects.
      const steps = Math.round(params.freezeAt / this.loop.dt);
      for (let i = 0; i < steps; i++) {
        this.step(this.loop.dt);
        this.updateVisuals(1, this.loop.dt);
      }
      this.frozen = true;
    }
  }

  start(): void {
    this.lastFrame = performance.now();
    const frame = (now: number): void => {
      const seconds = (now - this.lastFrame) / 1000;
      this.lastFrame = now;
      if (this.frozen) this.render(1, 0);
      else this.loop.advance(seconds);
      this.fps.frame(seconds);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ setup
  private spawnPlayer(): void {
    const spawn = this.battlefield.spawn;
    this.player = this.world.spawnMech(this.chassis, spawn.x, spawn.z, 0, 0);
    this.playerView = this.addView(this.player);
    this.playerView.gait.onFootfall = (_i, strength) => {
      this.shake = Math.max(this.shake, strength * 0.15);
      this.sfx.play(this.chassis.tonnage >= 70 ? 'footstep_heavy' : 'footstep_medium', undefined, { volume: 0.5 + strength * 0.5 });
    };
    this.controller = new PlayerController(this.input, this.player, this.world);
    this.controller.onUi = () => this.sfx.play('ui_click');
    const p = this.params;
    if (p.walk !== 0 || p.turn !== 0 || p.fire !== 0) this.controller.autopilot = { walk: p.walk, turn: p.turn, fire: p.fire };
    this.hud?.el.remove();
    this.hud = new Hud(this.container, this.chassis, { theatre: 'DESERT FRONT', operation: 'OPERATION TALON' });
    this.lastIntegrity = this.totalIntegrity();
  }

  private spawnWave(): void {
    const s = this.battlefield.spawn;
    for (const [id, dx, dz, mode] of DUMMY_WAVE) {
      const m = this.world.spawnMech(getChassis(id), s.x + dx, s.z + dz, Math.PI, 1);
      this.dummies.push({ mech: m, mode, homeYaw: Math.PI });
    }
  }

  private addHostileView(m: Mech): void {
    const view = this.addView(m);
    view.gait.onFootfall = (_i, strength) => {
      this.sfx.play(m.def.tonnage >= 70 ? 'footstep_heavy' : 'footstep_medium', this.posOf(m, 0), { volume: strength });
    };
  }

  private addView(mech: Mech): MechView {
    const terrain = this.world.terrain;
    const ground = (x: number, z: number): number => terrain.heightAt(x, z);
    const view = new MechView(mech, buildMechRig(mech.def.id), ground);
    this.stage.scene.add(view.object);
    this.views.set(mech.id, { view, damage: new MechDamageView(view, this.stage.scene, this.effects, ground) });
    return view;
  }

  private setMode(mode: CameraMode): void {
    this.mode = mode;
    const bf = this.battlefield;
    const pv = this.playerView;
    const ground = (x: number, z: number): number => bf.heightAt(x, z);
    switch (mode) {
      case 'chase':
        this.rig = new ChaseRig(pv, this.controller, ground);
        break;
      case 'cockpit':
        this.rig = new CockpitRig(pv);
        break;
      case 'orbit': {
        const focus = pv.position.clone().setY(pv.position.y + pv.rig.height * 0.5);
        this.rig = this.params.scene === 'viewer' ? new OrbitRig(focus, 24, 4, 0.25, -2.2) : new OrbitRig(focus, 140, 55);
        break;
      }
      case 'free': {
        const { camPos, camLook } = this.params;
        const focus = pv.position.clone().setY(pv.position.y + 5);
        const start = camPos
          ? new THREE.Vector3(camPos[0], bf.heightAt(camPos[0], camPos[2]) + camPos[1], camPos[2])
          : this.stage.camera.position.clone();
        const look = camLook ? new THREE.Vector3(camLook[0], bf.heightAt(camLook[0], camLook[2]) + camLook[1], camLook[2]) : focus;
        this.rig = new FreeRig(this.input, start, look, ground);
        break;
      }
    }
    const piloting = mode === 'chase' || mode === 'cockpit';
    this.hud.visible = piloting;
    this.cockpitFrame.hidden = mode !== 'cockpit';
    for (const o of pv.rig.cockpitHide) o.visible = mode !== 'cockpit';
    this.stage.camera.fov = mode === 'cockpit' ? 72 : 65;
    this.stage.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ loop
  private step(dt: number): void {
    if (this.controller.autopilot?.fire) this.autopilotAim();
    this.player.command = this.controller.command(dt);
    for (const d of this.dummies) d.mech.command = dummyCommand(d, this.world.time);
    this.mission?.step(dt);
    this.world.step(dt);

    // Training range: a fresh wave a few seconds after the last dummy falls.
    if (this.params.mode === 'range' && this.dummies.length && this.dummies.every((d) => !d.mech.combat.alive)) {
      if (this.waveTimer < 0) this.waveTimer = 6;
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        this.waveTimer = -1;
        this.dummies.length = 0;
        this.spawnWave();
        this.hud.message('NEW WAVE INBOUND', 'bad');
      }
    }
  }

  /** Debug autopilot: target the nearest live enemy and aim at its centre. */
  private autopilotAim(): void {
    const me = this.player.state;
    let enemy = this.world.getMech(this.controller.targetId);
    if (!enemy || !enemy.combat.alive) {
      enemy = this.world.mechs
        .filter((m) => m.team !== this.player.team && m.combat.alive)
        .sort((a, b) => Math.hypot(a.state.x - me.x, a.state.z - me.z) - Math.hypot(b.state.x - me.x, b.state.z - me.z))[0];
      this.controller.targetId = enemy?.id ?? 0;
    }
    if (!enemy) return;
    const dx = enemy.state.x - me.x;
    const dz = enemy.state.z - me.z;
    const dy = enemy.state.y + enemy.def.eyeHeight * 0.8 - (me.y + this.player.def.eyeHeight);
    this.controller.aimYaw = Math.atan2(-dx, -dz);
    this.controller.aimPitch = Math.atan2(dy, Math.hypot(dx, dz));
  }

  private updateVisuals(alpha: number, dt: number): void {
    // Units spawned by the mission get views on their first frame.
    for (const m of this.world.mechs) if (!this.views.has(m.id)) this.addHostileView(m);
    for (const { view, damage } of this.views.values()) {
      view.update(alpha, dt);
      damage.update(dt);
    }
    this.effects.update(this.world, alpha, dt);
  }

  private render(alpha: number, frameSeconds: number): void {
    const input = this.input;
    if (input.consumePress('toggleView')) this.setMode(this.mode === 'chase' ? 'cockpit' : 'chase');
    if (input.consumePress('cycleCamera')) this.setMode(this.mode === 'free' ? 'chase' : 'free');
    if (input.consumePress('toggleStats')) this.fps.toggle();
    if (input.consumePress('mute')) this.sfx.muted = !this.sfx.muted;
    if (input.consumePress('respawn') && !this.player.combat.alive) {
      if (this.mission) {
        window.location.reload(); // Instant Action restarts from scratch
        return;
      }
      this.spawnPlayer();
      this.setMode(this.mode === 'cockpit' ? 'cockpit' : 'chase');
    }
    const piloting = this.mode === 'chase' || this.mode === 'cockpit';
    if (piloting) this.controller.look();

    if (!this.frozen) this.updateVisuals(alpha, frameSeconds);
    this.rig.update(this.stage.camera, this.world.time, frameSeconds);
    this.updateAim();
    this.applyShake(frameSeconds);
    this.battlefield.update(this.stage.camera, this.world.time);

    const cam = this.stage.camera;
    cam.getWorldDirection(_v);
    this.sfx.setListener(cam.position, _v);
    this.playerFeedback(frameSeconds);
    if (piloting) this.updateHud(frameSeconds);

    this.stage.render();
    this.frames++;
  }

  /**
   * Third person: aim along the camera ray and point the mech at what it hits
   * (no crosshair parallax). Cockpit: the camera is at the eye, so the look
   * angles are used directly.
   */
  private updateAim(): void {
    const c = this.controller;
    if (this.mode !== 'chase' || c.autopilot) {
      c.aimOverride = null;
      return;
    }
    const cp = Math.cos(c.aimPitch);
    const look = { x: -Math.sin(c.aimYaw) * cp, y: Math.sin(c.aimPitch), z: -Math.cos(c.aimYaw) * cp };
    aimFromCamera(this.world, this.player, this.stage.camera.position, look, _camAim);
    c.aimOverride = { yaw: _camAim.yaw, pitch: _camAim.pitch };
  }

  private applyShake(dt: number): void {
    if (this.shake <= 0.001) return;
    const s = this.shake;
    const cam = this.stage.camera;
    cam.position.x += (Math.random() - 0.5) * s;
    cam.position.y += (Math.random() - 0.5) * s;
    cam.rotateZ((Math.random() - 0.5) * s * 0.02);
    this.shake *= Math.exp(-dt * 7);
  }

  // ------------------------------------------------------------------ feedback
  private totalIntegrity(): number {
    const c = this.player.combat;
    return HIT_LOCATIONS.reduce((s, l) => s + c.armor[l] + c.structure[l], 0);
  }

  /** Damage taken, heat alarms and lock tones for the player. */
  private playerFeedback(dt: number): void {
    const c = this.player.combat;
    const integrity = this.totalIntegrity();
    this.hitSoundTimer -= dt;
    if (integrity < this.lastIntegrity - 1e-6) {
      const lost = this.lastIntegrity - integrity;
      this.shake = Math.max(this.shake, Math.min(1.2, 0.2 + lost * 0.08));
      if (this.hitSoundTimer <= 0) {
        this.sfx.play('hit_taken', undefined, { volume: Math.min(1, 0.4 + lost * 0.1) });
        this.hitSoundTimer = 0.15;
      }
      if (c.lastHitFrom) {
        const yaw = Math.atan2(-c.lastHitFrom.x, -c.lastHitFrom.z);
        this.hud.hit(angleDiff(this.viewYaw(), yaw));
      }
    }
    this.lastIntegrity = integrity;

    this.heatWarnTimer -= dt;
    if (c.alive && !c.shutdown && c.heatFrac >= 0.85 && this.heatWarnTimer <= 0) {
      this.sfx.play('heat_warning');
      this.heatWarnTimer = c.heatFrac >= 0.95 ? 0.6 : 1.4;
    }

    const lock = c.lock;
    this.lockToneTimer -= dt;
    if (lock > 0 && lock < 1 && this.lockToneTimer <= 0) {
      this.sfx.play('lock_tone', undefined, { pitch: 0.8 + lock * 0.6 });
      this.lockToneTimer = 0.3 - lock * 0.15;
    }
    if (lock >= 1 && !this.wasLocked) this.sfx.play('locked');
    this.wasLocked = lock >= 1;
  }

  private viewYaw(): number {
    return this.mode === 'cockpit' ? this.playerView.torsoYaw : this.controller.aimYaw;
  }

  private posOf(m: Mech, yOffset = 5): THREE.Vector3 {
    return new THREE.Vector3(m.state.x, m.state.y + yOffset, m.state.z);
  }

  private onCombatEvent(e: CombatEvent): void {
    const isPlayer = 'mechId' in e && e.mechId === this.player.id;
    switch (e.type) {
      case 'fire': {
        const w = getWeapon(e.weaponId);
        const name = FIRE_SOUND[e.weaponId];
        if (name) this.sfx.play(name, isPlayer ? undefined : new THREE.Vector3(e.x, e.y, e.z), { volume: isPlayer ? 0.7 : 1, duration: w.beamDuration });
        if (isPlayer && (w.delivery === 'shell' || w.delivery === 'bolt')) this.shake = Math.max(this.shake, w.damage * 0.02);
        break;
      }
      case 'impact':
        this.sfx.play(e.damage >= 8 ? 'impact_large' : 'impact_small', new THREE.Vector3(e.x, e.y, e.z), { volume: e.weaponId === 'mg' ? 0.3 : 1 });
        break;
      case 'locDestroyed': {
        const m = this.world.getMech(e.mechId);
        if (m) this.sfx.play('impact_large', this.posOf(m));
        if (isPlayer) this.hud.message(`${LOC_NAMES[e.loc]} DESTROYED`, 'bad');
        else if (e.mechId === this.controller.targetId) this.hud.message(`TARGET ${LOC_NAMES[e.loc]} DESTROYED`, 'good');
        break;
      }
      case 'ammoExplosion': {
        const m = this.world.getMech(e.mechId);
        if (m) this.sfx.play('ammo_explosion', this.posOf(m));
        if (isPlayer) {
          this.hud.message('AMMO EXPLOSION', 'bad');
          this.shake = 2;
        }
        break;
      }
      case 'crit':
        if (isPlayer) {
          const what = e.what === 'weapon' ? `${this.player.combat.weapons[e.weapon ?? 0]?.def.name ?? 'WEAPON'} DESTROYED` : e.what === 'heatsink' ? 'HEAT SINK DAMAGED' : 'AMMO BIN HIT';
          this.hud.message(`CRITICAL: ${what}`, 'bad');
        }
        break;
      case 'mechDestroyed': {
        this.mission?.onDestroyed(e.mechId, e.killerId);
        const m = this.world.getMech(e.mechId);
        if (m) this.sfx.play('explosion', this.posOf(m), { volume: 1.2 });
        if (isPlayer) this.shake = 2.5;
        else if (e.killerId === this.player.id) this.hud.message(`${m?.def.name.toUpperCase() ?? 'TARGET'} DESTROYED`, 'good');
        break;
      }
      case 'shutdown':
        if (isPlayer) this.sfx.play('shutdown');
        break;
      case 'startup':
        if (isPlayer) this.sfx.play('startup');
        break;
      case 'coolant':
        if (isPlayer) this.sfx.play('coolant');
        break;
    }
  }

  private updateHud(dt: number): void {
    const pv = this.playerView;
    const c = this.player.combat;
    torsoAimPoint(this.world, this.player, _torsoPt);
    const torsoAim = new THREE.Vector3(_torsoPt.x, _torsoPt.y, _torsoPt.z);
    const chaseAim = this.mode === 'chase' && this.controller.aimOverride;
    const aimPt = chaseAim ? _camAim.point : c.aimPoint;
    let target: HudTarget | null = null;
    const tm = this.world.getMech(this.controller.targetId);
    if (tm && tm.combat.alive) {
      const tv = this.views.get(tm.id)!.view;
      target = {
        mech: tm,
        distance: _w.copy(tv.position).distanceTo(pv.position),
        bottom: tv.position.clone(),
        top: tv.position.clone().setY(tv.position.y + tv.rig.height),
      };
    }
    this.hud.update({
      viewYaw: this.viewYaw(),
      legYaw: pv.legYaw,
      torsoYaw: pv.torsoYaw,
      speed: this.player.state.speed,
      maxSpeed: this.player.def.maxSpeed,
      torsoAimPoint: torsoAim,
      aimPoint: new THREE.Vector3(aimPt.x, aimPt.y, aimPt.z),
      camera: this.stage.camera,
      pointerLocked: this.input.pointerLocked || this.controller.autopilot !== null,
      combat: c,
      selectedGroup: this.controller.selectedGroup,
      configOpen: this.controller.configOpen,
      configWeapon: this.controller.configWeapon,
      override: this.controller.override,
      target,
      mission: this.mission
        ? { phase: this.mission.phase, wave: this.mission.wave, timer: this.mission.timer, remaining: this.mission.remaining, waveSize: this.mission.waveSize, kills: this.mission.kills }
        : null,
      radar: {
        x: this.player.state.x,
        z: this.player.state.z,
        blips: this.world.mechs
          .filter((m) => m !== this.player)
          .map((m) => ({ x: m.state.x, z: m.state.z, hostile: m.team !== this.player.team, alive: m.combat.alive, targeted: m.id === this.controller.targetId })),
      },
      dt,
    });
  }
}

function buildBattlefield(params: GameParams, scene: THREE.Scene, terrain: HeightField): Battlefield {
  switch (params.scene) {
    case 'test':
      return buildTestScene(scene);
    case 'viewer':
      return buildTestScene(scene, true);
    case 'desert':
      if (!(terrain instanceof DesertTerrain)) throw new Error('desert scene needs DesertTerrain');
      return buildDesert(scene, terrain);
  }
}
