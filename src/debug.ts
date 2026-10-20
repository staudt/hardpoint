import type { Game } from './game';

/** Surface exposed to automated tests and screenshot tooling via `window.__game`. */
export interface DebugHandle {
  ready: boolean;
  errors: string[];
  game?: Game;
  /** Rendered frame count — tests wait for this to advance to confirm the loop runs. */
  frames(): number;
  /** Fraction of non-black pixels in a freshly rendered frame. */
  litFraction(): number;
  stats(): ReturnType<Game['stage']['stats']> | null;
}

declare global {
  interface Window {
    __game: DebugHandle;
  }
}

export function installDebugHandle(): DebugHandle {
  const handle: DebugHandle = {
    ready: false,
    errors: [],
    frames: () => handle.game?.frames ?? 0,
    litFraction: () => handle.game?.stage.litFraction() ?? 0,
    stats: () => handle.game?.stage.stats() ?? null,
  };
  window.__game = handle;
  window.addEventListener('error', (e) => handle.errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => handle.errors.push(String(e.reason)));
  return handle;
}
