import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** Owns the WebGL renderer, the root scene and the main camera. */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.info.autoReset = false; // composer renders several passes per frame
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(65, 1, 0.5, 6000);

    // HDR chain: scene → bloom (only very bright pixels) → tone map + sRGB.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0.55, 1.1);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  render(): void {
    this.renderer.info.reset();
    this.composer.render();
  }

  /** Per-frame render stats (all passes). */
  stats(): { triangles: number; calls: number; geometries: number; textures: number } {
    const { render, memory } = this.renderer.info;
    return { triangles: render.triangles, calls: render.calls, geometries: memory.geometries, textures: memory.textures };
  }

  /**
   * Render now and return the fraction of sampled pixels that aren't near-black.
   * Reads back synchronously after drawing, so preserveDrawingBuffer isn't needed. Test-only.
   */
  litFraction(): number {
    this.render();
    const gl = this.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let lit = 0;
    let total = 0;
    for (let i = 0; i < px.length; i += 4 * 97) {
      total++;
      if (px[i]! + px[i + 1]! + px[i + 2]! > 30) lit++;
    }
    return lit / total;
  }

  private readonly resize = (): void => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };
}
