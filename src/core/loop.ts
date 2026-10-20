export interface LoopCallbacks {
  /** Advance the simulation by exactly `dt` seconds. */
  step(dt: number): void;
  /** Draw a frame; `alpha` ∈ [0,1) is the interpolation factor between the last two sim states. */
  render(alpha: number, frameSeconds: number): void;
}

/**
 * Fixed-timestep accumulator: the sim always advances in constant `dt` steps
 * (deterministic), while rendering runs at whatever rate the display allows.
 */
export class FixedStepLoop {
  readonly dt: number;
  /** Cap on catch-up steps per frame to avoid a spiral of death after a stall. */
  maxStepsPerFrame = 8;
  private accumulator = 0;

  constructor(
    private readonly callbacks: LoopCallbacks,
    hz = 60,
  ) {
    this.dt = 1 / hz;
  }

  /** Feed real elapsed time; returns the number of sim steps executed. */
  advance(frameSeconds: number): number {
    const clamped = Math.min(Math.max(frameSeconds, 0), 0.25);
    this.accumulator += clamped;
    let steps = 0;
    while (this.accumulator >= this.dt && steps < this.maxStepsPerFrame) {
      this.callbacks.step(this.dt);
      this.accumulator -= this.dt;
      steps++;
    }
    if (steps === this.maxStepsPerFrame) this.accumulator = Math.min(this.accumulator, this.dt);
    this.callbacks.render(this.accumulator / this.dt, clamped);
    return steps;
  }

  /** Run `seconds` of simulation synchronously (used for deterministic screenshots/tests). */
  fastForward(seconds: number): number {
    const steps = Math.round(seconds / this.dt);
    for (let i = 0; i < steps; i++) this.callbacks.step(this.dt);
    this.accumulator = 0;
    return steps;
  }
}
