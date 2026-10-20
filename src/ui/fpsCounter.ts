import type { Stage } from '../render/stage';

/** Small performance overlay: FPS, frame time, triangles, draw calls. Toggle with F3. */
export class FpsCounter {
  readonly el: HTMLDivElement;
  private frames = 0;
  private elapsed = 0;
  private worst = 0;

  constructor(
    parent: HTMLElement,
    private readonly stage: Stage,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'fps-counter';
    this.el.textContent = 'FPS --';
    parent.appendChild(this.el);
  }

  toggle(): void {
    this.el.hidden = !this.el.hidden;
  }

  /** Call once per rendered frame with wall-clock seconds since the previous frame. */
  frame(seconds: number): void {
    this.frames++;
    this.elapsed += seconds;
    this.worst = Math.max(this.worst, seconds);
    if (this.elapsed < 0.5) return;
    if (!this.el.hidden) {
      const fps = this.frames / this.elapsed;
      const avgMs = (this.elapsed / this.frames) * 1000;
      const { triangles, calls } = this.stage.stats();
      this.el.textContent =
        `FPS ${fps.toFixed(0).padStart(3)}  ${avgMs.toFixed(1)}ms (max ${(this.worst * 1000).toFixed(0)})  ` +
        `${(triangles / 1000).toFixed(0)}k tris  ${calls} calls`;
      this.el.classList.toggle('low', fps < 45);
    }
    this.frames = 0;
    this.elapsed = 0;
    this.worst = 0;
  }
}
