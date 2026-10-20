import type { SceneId } from '../core/params';
import { DesertTerrain, type HeightField } from './terrain';

/** Perfectly flat ground (test scene, model viewer). */
export class FlatTerrain implements HeightField {
  readonly cell = 6;
  readonly halfSize = 2000;
  rawHeight(): number {
    return 0;
  }
  heightAt(): number {
    return 0;
  }
}

export function createTerrain(scene: SceneId, seed: number): HeightField {
  switch (scene) {
    case 'desert':
      return new DesertTerrain({ seed });
    case 'test':
    case 'viewer':
      return new FlatTerrain();
  }
}
