import { describe, expect, it } from 'vitest';
import { IRONCLAW } from '../../src/data/chassis';
import { DEG, angleDiff, approachAngle, wrapAngle } from '../../src/sim/angles';
import { IDLE_COMMAND, Mech } from '../../src/sim/mech';
import { FlatTerrain } from '../../src/sim/terrains';
import type { HeightField } from '../../src/sim/terrain';

const flat = new FlatTerrain();
const DT = 1 / 60;

function run(m: Mech, seconds: number, terrain: HeightField = flat): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) m.step(DT, terrain);
}

describe('angles', () => {
  it('wraps and diffs along the shortest arc', () => {
    expect(Math.abs(wrapAngle(3 * Math.PI))).toBeCloseTo(Math.PI, 6);
    expect(angleDiff(170 * DEG, -170 * DEG)).toBeCloseTo(20 * DEG, 6);
    expect(approachAngle(170 * DEG, -170 * DEG, 5 * DEG)).toBeCloseTo(175 * DEG, 6);
  });
});

describe('Mech movement (modern controls)', () => {
  it('walks forward along the aim and reaches max speed', () => {
    const m = new Mech(1, IRONCLAW, 0, 0, 0, flat);
    m.command = { ...IDLE_COMMAND, moveX: 0, moveZ: 1, aimYaw: 0, aimPitch: 0 };
    run(m, 5);
    expect(m.state.speed).toBeCloseTo(IRONCLAW.maxSpeed, 3);
    expect(m.state.z).toBeLessThan(-30); // yaw 0 faces −Z
    expect(Math.abs(m.state.x)).toBeLessThan(1e-6);
  });

  it('torso tracks the aim within the twist limit while legs catch up', () => {
    const m = new Mech(1, IRONCLAW, 0, 0, 0, flat);
    m.command = { ...IDLE_COMMAND, moveX: 0, moveZ: 0, aimYaw: 170 * DEG, aimPitch: 0 };
    m.step(DT, flat);
    expect(Math.abs(m.twist)).toBeLessThanOrEqual(IRONCLAW.twistLimit + 1e-9);
    run(m, 0.6);
    expect(Math.abs(m.twist)).toBeLessThanOrEqual(IRONCLAW.twistLimit + 1e-9);
    run(m, 6);
    expect(angleDiff(m.state.torsoYaw, 170 * DEG)).toBeCloseTo(0, 3);
    // Legs turned in place to relieve the twist.
    expect(Math.abs(m.twist)).toBeLessThanOrEqual(IRONCLAW.twistLimit * 0.86);
  });

  it('strafe input turns the legs toward the move direction', () => {
    const m = new Mech(1, IRONCLAW, 0, 0, 0, flat);
    m.command = { ...IDLE_COMMAND, moveX: 1, moveZ: 0, aimYaw: 0, aimPitch: 0 };
    run(m, 4);
    expect(angleDiff(m.state.legYaw, -90 * DEG)).toBeCloseTo(0, 3); // right = −yaw
    expect(m.state.x).toBeGreaterThan(5);
    expect(m.state.torsoYaw).toBeCloseTo(0, 3); // still aiming forward
  });

  it('backs up while facing the aim', () => {
    const m = new Mech(1, IRONCLAW, 0, 0, 0, flat);
    m.command = { ...IDLE_COMMAND, moveX: 0, moveZ: -1, aimYaw: 0, aimPitch: 0 };
    run(m, 4);
    expect(m.state.speed).toBeLessThan(0);
    expect(m.state.z).toBeGreaterThan(5);
    expect(angleDiff(m.state.legYaw, 0)).toBeCloseTo(0, 3);
  });

  it('is blocked by cliffs', () => {
    const wall: HeightField = { cell: 6, halfSize: 2000, rawHeight: () => 0, heightAt: (_x, z) => (z < -20 ? 50 : 0) };
    const m = new Mech(1, IRONCLAW, 0, 0, 0, wall);
    m.command = { ...IDLE_COMMAND, moveX: 0, moveZ: 1, aimYaw: 0, aimPitch: 0 };
    run(m, 5, wall);
    expect(m.state.z).toBeGreaterThan(-21);
    expect(m.state.y).toBe(0);
  });

  it('is deterministic', () => {
    const a = new Mech(1, IRONCLAW, 0, 0, 0, flat);
    const b = new Mech(1, IRONCLAW, 0, 0, 0, flat);
    for (const m of [a, b]) {
      m.command = { ...IDLE_COMMAND, moveX: 0.3, moveZ: 0.8, aimYaw: 0.7, aimPitch: 0.1 };
      run(m, 3);
    }
    expect(a.state).toEqual(b.state);
  });
});
