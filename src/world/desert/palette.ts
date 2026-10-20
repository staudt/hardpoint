import * as THREE from 'three';
import { Simplex2, clamp01, smoothstep } from '../../sim/noise';
import { hash2 } from '../../sim/rng';
import type { FaceColorFn } from '../terrain/terrainChunks';

const c = (hex: number): THREE.Color => new THREE.Color(hex);

/** Sunset canyon palette (sRGB hex → linear via THREE.Color). */
export const DESERT = {
  sandLight: c(0xe9b47e),
  sand: c(0xd69b66),
  sandDark: c(0xbb8058),
  wash: c(0xb27a52),
  ledge: c(0xd08b5a),
  rockLight: c(0xda7442),
  rock: c(0xbb5632),
  rockDark: c(0x8e3c26),
  boulder: c(0xa85d3c),
  shrub: c(0x7a7f3a),
  shrubDark: c(0x5a6230),
  fog: c(0xd98a58),
  skyZenith: c(0x5a4a78),
  skyMid: c(0xc0704e),
  skyHorizon: c(0xf2a560),
  sun: c(0xffc27a),
  sunLight: c(0xffb070),
  hemiSky: c(0xffd2b0),
  hemiGround: c(0xa0583a),
} as const;

/** Face colouring for the desert terrain: sand floor, rust cliffs with strata, tan ledges. */
export function desertFaceColor(seed: number): FaceColorFn {
  const n = new Simplex2(hash2(seed, 77));
  const tmp = new THREE.Color();
  return (x, z, h, ny, out) => {
    // Floor sand with broad variation and dune-crest highlights.
    const v = n.fbm(x / 180, z / 180, 3);
    out.copy(DESERT.sand).lerp(v > 0 ? DESERT.sandLight : DESERT.sandDark, Math.abs(v) * 0.9);
    if (h < -0.8) out.lerp(DESERT.wash, smoothstep(-0.8, -2.5, h) * 0.8);

    // Raised flat ledges/tops of buttes.
    const raised = smoothstep(8, 22, h);
    if (raised > 0) out.lerp(DESERT.ledge, raised * 0.85);

    // Steep faces → rock with horizontal strata bands.
    const steep = smoothstep(0.86, 0.62, ny);
    if (steep > 0) {
      const band = 0.5 + 0.5 * Math.sin(h * 0.42 + n.noise(x / 90, z / 90) * 1.8);
      tmp.copy(DESERT.rock).lerp(band > 0.5 ? DESERT.rockLight : DESERT.rockDark, Math.abs(band - 0.5) * 1.6);
      out.lerp(tmp, steep);
    }

    // Per-face jitter for the faceted low-poly look.
    const j = (hash2(Math.floor(x * 7.31), Math.floor(z * 5.17)) / 4294967296 - 0.5) * 0.09;
    out.multiplyScalar(clamp01(1 + j));
  };
}
