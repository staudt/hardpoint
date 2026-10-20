import { describe, expect, it } from 'vitest';
import { FixedStepLoop } from '../../src/core/loop';

function makeLoop() {
  const calls = { steps: 0, renders: [] as number[] };
  const loop = new FixedStepLoop({
    step: () => calls.steps++,
    render: (alpha) => calls.renders.push(alpha),
  });
  return { loop, calls };
}

describe('FixedStepLoop', () => {
  it('runs whole steps and carries the remainder', () => {
    const { loop, calls } = makeLoop();
    loop.advance(1 / 60 + 1 / 120);
    expect(calls.steps).toBe(1);
    expect(calls.renders[0]).toBeCloseTo(0.5, 5);
    loop.advance(1 / 120);
    expect(calls.steps).toBe(2);
  });

  it('accumulates small frames', () => {
    const { loop, calls } = makeLoop();
    for (let i = 0; i < 4; i++) loop.advance(1 / 240);
    expect(calls.steps).toBe(1);
  });

  it('caps catch-up after a stall', () => {
    const { loop, calls } = makeLoop();
    loop.advance(10);
    expect(calls.steps).toBe(loop.maxStepsPerFrame);
  });

  it('fast-forwards deterministically', () => {
    const { loop, calls } = makeLoop();
    expect(loop.fastForward(2)).toBe(120);
    expect(calls.steps).toBe(120);
  });
});
