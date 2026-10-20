import type * as THREE from 'three';

/** A built battlefield: visuals already added to the scene, plus queries the game needs. */
export interface Battlefield {
  /** Terrain height at world (x, z). */
  heightAt(x: number, z: number): number;
  /** Where the player (and default cameras) start. */
  spawn: THREE.Vector3;
  /** Approximate playable radius in metres. */
  radius: number;
  /** Per-frame visual updates (e.g. keep shadow frustum / sky centred on the camera). */
  update(camera: THREE.Camera, simTime: number): void;
}
