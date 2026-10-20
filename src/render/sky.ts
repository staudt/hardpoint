import * as THREE from 'three';

export interface SkyColors {
  zenith: THREE.Color;
  mid: THREE.Color;
  horizon: THREE.Color;
  sun: THREE.Color;
  cloud: THREE.Color;
}

const vertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // pin to far plane
}
`;

const fragment = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uSun;
uniform vec3 uCloud;
uniform vec3 uSunDir;
uniform float uTime;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float y = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.18, y));
  col = mix(col, uZenith, smoothstep(0.15, 0.7, y));
  if (d.y < 0.0) col = uHorizon;

  float sd = max(dot(d, uSunDir), 0.0);
  // Wide warm glow + tight bright disc (HDR > 1 so bloom picks it up).
  col += uSun * (pow(sd, 6.0) * 0.22 + pow(sd, 48.0) * 0.5);
  col += uSun * smoothstep(0.9993, 0.9997, sd) * 6.0;

  // Streaky sunset clouds on a virtual plane, lit from the sun side.
  if (d.y > 0.01) {
    vec2 uv = d.xz / (d.y + 0.08);
    float c = fbm(uv * vec2(0.9, 3.2) + vec2(uTime * 0.004, 0.0));
    c = smoothstep(0.52, 0.78, c) * smoothstep(0.02, 0.12, d.y) * (1.0 - smoothstep(0.35, 0.8, d.y));
    vec3 cloudCol = uCloud * (0.6 + 0.9 * pow(sd, 3.0));
    col = mix(col, cloudCol, c * 0.75);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Gradient sunset sky dome with sun glow and procedural streak clouds. Follows the camera. */
export class Sky {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(colors: SkyColors, sunDir: THREE.Vector3) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uZenith: { value: colors.zenith },
        uMid: { value: colors.mid },
        uHorizon: { value: colors.horizon },
        uSun: { value: colors.sun },
        uCloud: { value: colors.cloud },
        uSunDir: { value: sunDir.clone().normalize() },
        uTime: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), this.material);
    this.mesh.name = 'sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  update(camera: THREE.Camera, time: number): void {
    this.mesh.position.copy(camera.position);
    this.material.uniforms.uTime!.value = time;
  }
}
