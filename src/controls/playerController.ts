import type { Action, Input } from '../core/input';
import { angleDiff, clamp, wrapAngle } from '../sim/angles';
import { MAX_GROUPS } from '../sim/combat/mechCombat';
import { IDLE_COMMAND, type Mech, type MechCommand } from '../sim/mech';
import type { World } from '../sim/world';

const MOUSE_SENSITIVITY = 0.0022; // rad per pixel
const FIRE_ACTIONS: Action[] = ['fireGroup1', 'fireGroup2', 'fireGroup3', 'fireGroup4', 'fireGroup5'];

/**
 * Modern control scheme: the mouse sets the desired aim (the torso follows at
 * its twist rate); WASD moves relative to the aim — the legs turn toward the
 * move direction automatically. Also owns weapon-group UI state (selected
 * group, config mode) and target selection.
 */
export class PlayerController {
  /** Look angles driven by the mouse (the camera's aim direction). */
  aimYaw: number;
  aimPitch = 0;
  /** Third person: mech aim derived from the camera ray (see aimFromCamera); null = use the look angles. */
  aimOverride: { yaw: number; pitch: number } | null = null;
  targetId = 0;
  override = false;
  /** Group the wheel / T / config act on (0-based). */
  selectedGroup = 0;
  /** Tab group-config mode: arrows pick a weapon, 1–5 toggle its membership. */
  configOpen = false;
  configWeapon = 0;
  private coolantPending = false;
  /** Debug autopilot (URL `walk`/`turn`/`fire`) for screenshots and demos. */
  autopilot: { walk: number; turn: number; fire: number } | null = null;
  /** UI feedback hook (e.g. click sound). */
  onUi: (() => void) | null = null;

  constructor(
    private readonly input: Input,
    readonly mech: Mech,
    private readonly world: World,
  ) {
    this.aimYaw = mech.state.torsoYaw;
  }

  /** Per rendered frame: mouse look and edge-triggered UI actions. */
  look(): void {
    const { dx, dy } = this.input.consumeMouseDelta();
    this.aimYaw = wrapAngle(this.aimYaw - dx * MOUSE_SENSITIVITY);
    const d = this.mech.def;
    this.aimPitch = clamp(this.aimPitch - dy * MOUSE_SENSITIVITY, d.pitchMin - 0.1, d.pitchMax + 0.1);

    const input = this.input;
    const c = this.mech.combat;
    const wheel = input.consumeWheel();
    if (wheel !== 0) {
      this.selectedGroup = (this.selectedGroup + wheel + MAX_GROUPS) % MAX_GROUPS;
      this.onUi?.();
    }
    if (input.consumePress('chainToggle')) {
      c.chainMode[this.selectedGroup] = !c.chainMode[this.selectedGroup];
      this.onUi?.();
    }
    if (input.consumePress('override')) this.override = !this.override;
    if (input.consumePress('coolant')) this.coolantPending = true;
    if (input.consumePress('targetNearest')) this.cycleTarget();
    if (input.consumePress('groupConfig')) {
      this.configOpen = !this.configOpen;
      // Discard presses queued while firing so they don't toggle groups.
      for (const a of FIRE_ACTIONS) input.consumePress(a);
      this.onUi?.();
    }
    if (this.configOpen) {
      const n = c.weapons.length;
      if (input.consumePress('menuUp')) this.configWeapon = (this.configWeapon - 1 + n) % n;
      if (input.consumePress('menuDown')) this.configWeapon = (this.configWeapon + 1) % n;
      for (let g = 0; g < MAX_GROUPS; g++) {
        if (input.consumePress(`fireGroup${g + 1}` as Action)) {
          c.toggleGroup(this.configWeapon, g);
          this.onUi?.();
        }
      }
    }
    // Drop the target once it's dead.
    const t = this.world.getMech(this.targetId);
    if (t && !t.combat.alive) this.targetId = 0;
  }

  /** Per sim tick: build the command. */
  command(dt: number): MechCommand {
    const aim = this.aimOverride ?? { yaw: this.aimYaw, pitch: this.aimPitch };
    const base = { ...IDLE_COMMAND, aimYaw: aim.yaw, aimPitch: aim.pitch, targetId: this.targetId, override: this.override };
    base.coolant = this.coolantPending;
    this.coolantPending = false;
    if (this.autopilot) {
      this.aimYaw = wrapAngle(this.aimYaw + this.autopilot.turn * dt);
      return { ...base, aimYaw: this.aimYaw, moveZ: this.autopilot.walk, fire: this.autopilot.fire };
    }
    let fire = 0;
    if (!this.configOpen && this.input.pointerLocked) {
      FIRE_ACTIONS.forEach((a, g) => {
        if (this.input.isDown(a)) fire |= 1 << g;
      });
    }
    return {
      ...base,
      moveX: this.input.axis('left', 'right'),
      moveZ: this.input.axis('back', 'forward'),
      fire,
      alpha: !this.configOpen && this.input.pointerLocked && this.input.isDown('alphaStrike'),
    };
  }

  /** E: target the enemy nearest the crosshair (within ~20°), else cycle by distance. */
  private cycleTarget(): void {
    const me = this.mech.state;
    const enemies = this.world.mechs
      .filter((m) => m.team !== this.mech.team && m.combat.alive)
      .map((m) => {
        const dx = m.state.x - me.x;
        const dz = m.state.z - me.z;
        const yaw = Math.atan2(-dx, -dz);
        return { m, dist: Math.hypot(dx, dz), off: Math.abs(angleDiff(this.aimYaw, yaw)) };
      })
      .sort((a, b) => a.dist - b.dist);
    if (enemies.length === 0) {
      this.targetId = 0;
      return;
    }
    const inSights = enemies.filter((e) => e.off < 0.35).sort((a, b) => a.off - b.off)[0];
    if (inSights && inSights.m.id !== this.targetId) {
      this.targetId = inSights.m.id;
      return;
    }
    const idx = enemies.findIndex((e) => e.m.id === this.targetId);
    this.targetId = enemies[(idx + 1) % enemies.length]!.m.id;
  }
}
