import * as THREE from 'three';
import type { DesertTerrain } from '../../sim/terrain';
import { Sky } from '../../render/sky';
import { TerrainChunks } from '../terrain/terrainChunks';
import type { Battlefield } from '../types';
import { DESERT, desertFaceColor } from './palette';
import { buildDesertProps } from './props';

/** Low golden-hour sun (elevation ≈ 13°), coming from the north-west. */
const SUN_DIR = new THREE.Vector3(-0.62, 0.23, -0.75).normalize();
const SHADOW_EXTENT = 260;

export function buildDesert(scene: THREE.Scene, terrain: DesertTerrain): Battlefield & { chunks: TerrainChunks } {
  const seed = terrain.seed;

  scene.background = DESERT.skyHorizon.clone();
  scene.fog = new THREE.FogExp2(DESERT.fog.getHex(), 0.00062);

  const sky = new Sky(
    { zenith: DESERT.skyZenith, mid: DESERT.skyMid, horizon: DESERT.skyHorizon, sun: DESERT.sun, cloud: new THREE.Color(0xffb27a) },
    SUN_DIR,
  );
  scene.add(sky.mesh);

  scene.add(new THREE.HemisphereLight(DESERT.hemiSky, DESERT.hemiGround, 1.6));
  const sun = new THREE.DirectionalLight(DESERT.sunLight, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -SHADOW_EXTENT;
  sc.right = sc.top = SHADOW_EXTENT;
  sc.near = 10;
  sc.far = 1600;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);

  const chunks = new TerrainChunks(terrain, desertFaceColor(seed), {
    chunkCells: terrain.chunkCells,
    chunksPerSide: terrain.chunksPerSide,
    lodDistances: [600, 1200, 2200],
    skirtDepth: 25,
  });
  scene.add(chunks.group);
  scene.add(buildDesertProps(terrain, seed));

  const focus = new THREE.Vector3();
  const texel = (SHADOW_EXTENT * 2) / sun.shadow.mapSize.x;
  let primed = false;

  return {
    chunks,
    heightAt: (x, z) => terrain.heightAt(x, z),
    spawn: new THREE.Vector3(0, 0, 0),
    radius: terrain.basinRadius,
    update(camera, simTime) {
      chunks.update(camera.position, primed ? 4 : Infinity);
      primed = true;
      sky.update(camera, simTime);

      // Keep the shadow frustum centred ahead of the camera, snapped to texels to avoid shimmer.
      camera.getWorldDirection(focus);
      focus.y = 0;
      focus.normalize().multiplyScalar(SHADOW_EXTENT * 0.6).add(camera.position);
      focus.x = Math.round(focus.x / texel) * texel;
      focus.z = Math.round(focus.z / texel) * texel;
      focus.y = terrain.heightAt(focus.x, focus.z);
      sun.target.position.copy(focus);
      sun.position.copy(focus).addScaledVector(SUN_DIR, 800);
    },
  };
}
