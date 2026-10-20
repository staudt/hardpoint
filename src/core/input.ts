/**
 * Keyboard/mouse input with rebindable actions. Edge-triggered presses are
 * latched until consumed so fixed-step sim ticks never miss a tap.
 */
export const DEFAULT_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['Space'],
  down: ['ControlLeft'],
  boost: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  toggleView: ['KeyV'],
  cycleCamera: ['F1'],
  toggleStats: ['F3'],
  centerTorso: ['KeyX'],
  fireGroup1: ['Mouse0', 'Digit1'],
  fireGroup2: ['Mouse2', 'Digit2'],
  fireGroup3: ['Mouse1', 'KeyQ', 'Digit3'],
  fireGroup4: ['Digit4'],
  fireGroup5: ['Digit5'],
  alphaStrike: ['KeyF'],
  chainToggle: ['KeyT'],
  override: ['KeyO'],
  coolant: ['KeyC'],
  groupConfig: ['Tab'],
  menuUp: ['ArrowUp'],
  menuDown: ['ArrowDown'],
  targetNearest: ['KeyE'],
  respawn: ['KeyR'],
  mute: ['KeyM'],
  zoom: ['KeyZ'],
  pause: ['Escape', 'KeyP'],
} satisfies Record<string, string[]>;

export type Action = keyof typeof DEFAULT_BINDINGS;
export type Bindings = Record<Action, string[]>;

export class Input {
  private readonly down = new Set<string>();
  private readonly latched = new Set<string>();
  private mouseDx = 0;
  private mouseDy = 0;
  private wheel = 0;
  bindings: Bindings;

  constructor(private readonly target: HTMLElement) {
    this.bindings = structuredClone(DEFAULT_BINDINGS);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    target.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    target.addEventListener('wheel', this.onWheel, { passive: true });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.target;
  }

  requestPointerLock(): void {
    if (!this.pointerLocked) void this.target.requestPointerLock?.();
  }

  isDown(action: Action): boolean {
    return this.bindings[action].some((code) => this.down.has(code));
  }

  /** True once per physical press (consumes the latch). */
  consumePress(action: Action): boolean {
    let hit = false;
    for (const code of this.bindings[action]) {
      if (this.latched.delete(code)) hit = true;
    }
    return hit;
  }

  /** -1..1 axis from two actions. */
  axis(negative: Action, positive: Action): number {
    return (this.isDown(positive) ? 1 : 0) - (this.isDown(negative) ? 1 : 0);
  }

  consumeMouseDelta(): { dx: number; dy: number } {
    const d = { dx: this.mouseDx, dy: this.mouseDy };
    this.mouseDx = 0;
    this.mouseDy = 0;
    return d;
  }

  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  private press(code: string): void {
    if (!this.down.has(code)) this.latched.add(code);
    this.down.add(code);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'F1' || e.code === 'F3' || e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    this.press(e.code);
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };
  private readonly onBlur = (): void => {
    this.down.clear();
  };
  private readonly onMouseDown = (e: MouseEvent): void => {
    if (e.button === 1) e.preventDefault(); // no autoscroll on middle click
    this.requestPointerLock();
    this.press(`Mouse${e.button}`);
  };
  private readonly onMouseUp = (e: MouseEvent): void => {
    this.down.delete(`Mouse${e.button}`);
  };
  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked) return;
    this.mouseDx += e.movementX;
    this.mouseDy += e.movementY;
  };
  private readonly onWheel = (e: WheelEvent): void => {
    this.wheel += Math.sign(e.deltaY);
  };
}
