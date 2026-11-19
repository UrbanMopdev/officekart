/**
 * Something in the air on every circuit: snow on the lake, embers on the
 * volcano, dust in the office light, glowing motes over the neon city. The
 * flakes live in a box that follows the camera and wrap round its edges, so a
 * few hundred points fill the whole track.
 */
import * as THREE from "three";

export type WeatherKind = "snow" | "embers" | "dust" | "motes" | "rain";

const LOOK: Record<WeatherKind, { count: number; size: number; opacity: number; additive: boolean; fall: number; wind: [number, number]; sway: number; colors: string[]; box: [number, number, number] }> = {
  snow: { count: 900, size: 0.34, opacity: 0.9, additive: false, fall: -3.2, wind: [1.6, 0.5], sway: 1.2, colors: ["#ffffff", "#eaf4ff"], box: [46, 22, 46] },
  embers: { count: 420, size: 0.3, opacity: 0.95, additive: true, fall: 1.9, wind: [0.9, 0.3], sway: 1.6, colors: ["#ff7a1a", "#ffb347", "#ff4d1a"], box: [44, 20, 44] },
  rain: { count: 2400, size: 0.11, opacity: 0.7, additive: false, fall: -30, wind: [3.5, 1.2], sway: 0.2, colors: ["#c9d6e2", "#aebccb"], box: [30, 16, 30] },
  dust: { count: 260, size: 0.16, opacity: 0.4, additive: true, fall: -0.12, wind: [0.15, 0.1], sway: 0.35, colors: ["#fff3d6", "#ffffff"], box: [26, 10, 26] },
  motes: { count: 380, size: 0.26, opacity: 0.85, additive: true, fall: 0.5, wind: [0.4, -0.3], sway: 0.9, colors: ["#22d3ee", "#e879f9", "#a78bfa", "#f472b6"], box: [42, 18, 42] },
};

function dot(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.85)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function weatherFor(theme: string): WeatherKind | null {
  return theme === "frozen" ? "snow" : theme === "volcano" ? "embers" : theme === "office" ? "dust" : theme === "neon" ? "motes" : null;
}

export class Weather {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly seed: Float32Array;
  private readonly look: (typeof LOOK)[WeatherKind];
  private readonly map = dot();

  constructor(kind: WeatherKind, scale = 1) {
    const look = (this.look = LOOK[kind]);
    const n = Math.round(look.count * scale);
    this.pos = new Float32Array(n * 3);
    this.seed = new Float32Array(n);
    const col = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      this.pos[i * 3] = (Math.random() * 2 - 1) * look.box[0];
      this.pos[i * 3 + 1] = (Math.random() * 2 - 1) * look.box[1];
      this.pos[i * 3 + 2] = (Math.random() * 2 - 1) * look.box[2];
      this.seed[i] = Math.random() * 100;
      c.set(look.colors[i % look.colors.length]).multiplyScalar(look.additive ? 1.8 : 1);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ map: this.map, size: look.size, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: look.opacity, depthWrite: false, blending: look.additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: !look.additive }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  /** Drift every flake and keep the cloud centred on the camera. `local` positions are relative to it. */
  update(dt: number, time: number, cam: THREE.Vector3): void {
    const { box, fall, wind, sway } = this.look;
    const p = this.pos;
    // The cloud is parked at the camera; flakes move inside it and the camera's own motion slides them past.
    const dx = cam.x - this.points.position.x;
    const dy = cam.y - this.points.position.y;
    const dz = cam.z - this.points.position.z;
    this.points.position.copy(cam);
    for (let i = 0, n = this.seed.length; i < n; i++) {
      const s = this.seed[i];
      let x = p[i * 3] - dx + (wind[0] + Math.sin(time * 0.7 + s) * sway) * dt;
      let y = p[i * 3 + 1] - dy + fall * (0.7 + (s % 1) * 0.6) * dt;
      let z = p[i * 3 + 2] - dz + (wind[1] + Math.cos(time * 0.6 + s * 1.3) * sway) * dt;
      if (x > box[0]) x -= box[0] * 2;
      else if (x < -box[0]) x += box[0] * 2;
      if (y > box[1]) y -= box[1] * 2;
      else if (y < -box[1]) y += box[1] * 2;
      if (z > box[2]) z -= box[2] * 2;
      else if (z < -box[2]) z += box[2] * 2;
      p[i * 3] = x;
      p[i * 3 + 1] = y;
      p[i * 3 + 2] = z;
    }
    (this.points.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.map.dispose();
  }
}
