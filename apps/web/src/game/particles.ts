/**
 * Pooled GPU point particles for drift sparks, tyre smoke, dust and exhaust
 * flames. Simulated on the CPU (a few hundred points), drawn in one call.
 */
import * as THREE from "three";

const VERT = /* glsl */ `
  attribute vec4 aColor;
  attribute float aSize;
  uniform float uScale;
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  varying vec4 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.15, d) * vColor.a;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor.rgb, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface Emit {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size: number;
  /** Size multiplier reached at the end of life. */
  grow: number;
  r: number;
  g: number;
  b: number;
  alpha: number;
  gravity: number;
  drag: number;
  /** Height the particle bounces on (the road under the kart). */
  floor?: number;
}

export class ParticleSystem {
  readonly points: THREE.Points;
  private readonly cap: number;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly vel: Float32Array;
  private readonly meta: Float32Array; // life, maxLife, size0, grow, alpha0, gravity, drag
  private cursor = 0;
  private readonly material: THREE.ShaderMaterial;
  private readonly geometry = new THREE.BufferGeometry();

  constructor(capacity: number, additive: boolean) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.size = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.meta = new Float32Array(capacity * 8);
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("aColor", new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 11 : 10;
  }

  emit(e: Emit): void {
    const i = this.cursor;
    this.cursor = (i + 1) % this.cap;
    this.pos[i * 3] = e.x;
    this.pos[i * 3 + 1] = e.y;
    this.pos[i * 3 + 2] = e.z;
    this.vel[i * 3] = e.vx;
    this.vel[i * 3 + 1] = e.vy;
    this.vel[i * 3 + 2] = e.vz;
    this.col[i * 4] = e.r;
    this.col[i * 4 + 1] = e.g;
    this.col[i * 4 + 2] = e.b;
    this.col[i * 4 + 3] = e.alpha;
    const m = i * 8;
    this.meta[m + 7] = (e.floor ?? 0) + 0.06;
    this.meta[m] = e.life;
    this.meta[m + 1] = e.life;
    this.meta[m + 2] = e.size;
    this.meta[m + 3] = e.grow;
    this.meta[m + 4] = e.alpha;
    this.meta[m + 5] = e.gravity;
    this.meta[m + 6] = e.drag;
    this.size[i] = e.size;
  }

  /** `pixelsPerUnit` is viewportHeight / (2 * tan(fov / 2)), so sizes are in world units. */
  update(dt: number, pixelsPerUnit: number): void {
    this.material.uniforms.uScale.value = pixelsPerUnit;
    const { pos, vel, col, size, meta } = this;
    for (let i = 0; i < this.cap; i++) {
      const m = i * 8;
      if (meta[m] <= 0) continue;
      meta[m] -= dt;
      if (meta[m] <= 0) {
        col[i * 4 + 3] = 0;
        size[i] = 0;
        continue;
      }
      const k = 1 - meta[m] / meta[m + 1]; // 0 -> 1 over the particle's life
      const drag = Math.max(0, 1 - meta[m + 6] * dt);
      vel[i * 3] *= drag;
      vel[i * 3 + 1] = vel[i * 3 + 1] * drag - meta[m + 5] * dt;
      vel[i * 3 + 2] *= drag;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (pos[i * 3 + 1] < meta[m + 7]) {
        pos[i * 3 + 1] = meta[m + 7];
        vel[i * 3 + 1] *= -0.35;
      }
      col[i * 4 + 3] = meta[m + 4] * (1 - k) * (1 - k * 0.3);
      size[i] = meta[m + 2] * (1 + (meta[m + 3] - 1) * k);
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aColor.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
