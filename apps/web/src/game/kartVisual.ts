/**
 * The kart model and its animation. Geometry is built once and shared by every
 * kart; each kart only owns its paint materials, so twelve karts cost little.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FLAG, KART_COLORS } from "@office-kart/shared";
import { bake, compose, type PartOptions } from "./builder";
import { glowTexture, labelTexture } from "./textures";

interface Shared {
  paint: THREE.BufferGeometry;
  accent: THREE.BufferGeometry;
  dark: THREE.BufferGeometry;
  metal: THREE.BufferGeometry;
  suit: THREE.BufferGeometry;
  visor: THREE.BufferGeometry;
  lights: THREE.BufferGeometry;
  wheel: THREE.BufferGeometry;
  flame: THREE.BufferGeometry;
  blob: THREE.BufferGeometry;
  glowPlane: THREE.BufferGeometry;
  darkMat: THREE.Material;
  metalMat: THREE.Material;
  suitMat: THREE.Material;
  visorMat: THREE.Material;
  lightsMat: THREE.Material;
  wheelMat: THREE.Material;
  blobMat: THREE.Material;
  glowTex: THREE.Texture;
}

let shared: Shared | null = null;

class Parts {
  private list: THREE.BufferGeometry[] = [];
  add(geo: THREE.BufferGeometry, x: number, y: number, z: number, color: THREE.ColorRepresentation = "#ffffff", o: PartOptions = {}, intensity = 1): this {
    this.list.push(bake(geo, compose(x, y, z, o), color, intensity));
    geo.dispose();
    return this;
  }
  rbox(w: number, h: number, d: number, r: number, x: number, y: number, z: number, o?: PartOptions, color?: THREE.ColorRepresentation, intensity?: number): this {
    return this.add(new RoundedBoxGeometry(w, h, d, 3, r), x, y, z, color, o, intensity);
  }
  box(w: number, h: number, d: number, x: number, y: number, z: number, o?: PartOptions, color?: THREE.ColorRepresentation, intensity?: number): this {
    return this.add(new THREE.BoxGeometry(w, h, d), x, y, z, color, o, intensity);
  }
  cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, o?: PartOptions, color?: THREE.ColorRepresentation, seg = 18): this {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, color, o);
  }
  merge(): THREE.BufferGeometry {
    const g = mergeGeometries(this.list, false)!;
    for (const p of this.list) p.dispose();
    g.computeBoundingSphere();
    return g;
  }
}

/** Kart faces +z. About 1.9 wide across the wheels and 3.6 long. */
function buildShared(): Shared {
  const paint = new Parts()
    .rbox(1.22, 0.3, 2.3, 0.12, 0, 0.47, -0.05)
    .rbox(0.74, 0.27, 1.05, 0.11, 0, 0.5, 1.22)
    .add(new THREE.SphereGeometry(0.37, 22, 16), 0, 0.5, 1.7, "#fff", { sy: 0.56, sz: 1.15 })
    .rbox(0.44, 0.36, 1.3, 0.14, -0.74, 0.52, -0.1)
    .rbox(0.44, 0.36, 1.3, 0.14, 0.74, 0.52, -0.1)
    .rbox(0.88, 0.48, 0.84, 0.16, 0, 0.8, -1.0)
    .rbox(0.36, 0.3, 0.52, 0.11, 0, 1.13, -0.86)
    .rbox(1.74, 0.07, 0.48, 0.03, 0, 1.44, -1.44, { rx: 0.14 })
    .rbox(1.84, 0.06, 0.44, 0.025, 0, 0.27, 1.84)
    .merge();

  const accent = new Parts()
    .rbox(0.07, 0.44, 0.6, 0.025, -0.88, 1.33, -1.44)
    .rbox(0.07, 0.44, 0.6, 0.025, 0.88, 1.33, -1.44)
    .rbox(0.07, 0.24, 0.48, 0.025, -0.92, 0.34, 1.84)
    .rbox(0.07, 0.24, 0.48, 0.025, 0.92, 0.34, 1.84)
    .rbox(0.22, 0.05, 1.6, 0.02, 0, 0.642, 1.0)
    .rbox(0.1, 0.05, 1.2, 0.02, -0.74, 0.705, -0.1)
    .rbox(0.1, 0.05, 1.2, 0.02, 0.74, 0.705, -0.1)
    .add(new THREE.SphereGeometry(0.35, 24, 18), 0, 1.52, -0.28)
    .merge();

  const dark = new Parts()
    .box(1.5, 0.07, 3.0, 0, 0.27, 0.1)
    .rbox(0.74, 0.72, 0.2, 0.08, 0, 0.95, -0.58, { rx: -0.2 })
    .rbox(0.72, 0.14, 0.62, 0.06, 0, 0.66, -0.25)
    .box(0.07, 0.5, 0.1, -0.3, 1.18, -1.42)
    .box(0.07, 0.5, 0.1, 0.3, 1.18, -1.42)
    .cyl(0.035, 0.035, 0.6, 0, 0.93, 0.44, { rx: 1.0 })
    .add(new THREE.TorusGeometry(0.2, 0.04, 10, 24), 0, 1.11, 0.25, "#fff", { rx: -0.55 })
    .cyl(0.055, 0.055, 1.72, 0, 0.42, 1.0, { rz: Math.PI / 2 }, "#fff", 10)
    .cyl(0.055, 0.055, 1.76, 0, 0.44, -0.95, { rz: Math.PI / 2 }, "#fff", 10)
    .rbox(1.34, 0.13, 0.15, 0.05, 0, 0.45, -1.52)
    .add(new THREE.SphereGeometry(0.095, 12, 10), -0.2, 1.11, 0.25)
    .add(new THREE.SphereGeometry(0.095, 12, 10), 0.2, 1.11, 0.25)
    .merge();

  const metal = new Parts()
    .cyl(0.095, 0.115, 0.62, -0.3, 0.63, -1.58, { rx: Math.PI / 2 }, "#fff", 14)
    .cyl(0.095, 0.115, 0.62, 0.3, 0.63, -1.58, { rx: Math.PI / 2 }, "#fff", 14)
    .cyl(0.17, 0.17, 0.56, 0, 0.56, -1.27, { rz: Math.PI / 2 }, "#fff", 14)
    .cyl(0.03, 0.03, 0.5, -0.86, 0.9, -1.44, {}, "#fff", 8)
    .cyl(0.03, 0.03, 0.5, 0.86, 0.9, -1.44, {}, "#fff", 8)
    .merge();

  const suit = new Parts()
    .add(new THREE.CapsuleGeometry(0.25, 0.34, 6, 14), 0, 1.03, -0.3)
    .add(new THREE.CapsuleGeometry(0.078, 0.44, 4, 10), -0.24, 1.15, -0.02, "#fff", { rx: Math.PI / 2 - 0.12, rz: 0.1 })
    .add(new THREE.CapsuleGeometry(0.078, 0.44, 4, 10), 0.24, 1.15, -0.02, "#fff", { rx: Math.PI / 2 - 0.12, rz: -0.1 })
    .merge();

  // Front band of the helmet. In three's sphere, +z is at phi = PI / 2.
  const visor = new Parts().add(new THREE.SphereGeometry(0.362, 24, 12, Math.PI / 2 - 1.0, 2.0, 1.12, 0.52), 0, 1.52, -0.28).merge();

  const lights = new Parts()
    .rbox(0.26, 0.09, 0.06, 0.02, -0.42, 0.5, -1.6, {}, "#ff2a2a", 4)
    .rbox(0.26, 0.09, 0.06, 0.02, 0.42, 0.5, -1.6, {}, "#ff2a2a", 4)
    .add(new THREE.SphereGeometry(0.07, 10, 8), -0.24, 0.56, 1.98, "#fff6d8", {}, 4)
    .add(new THREE.SphereGeometry(0.07, 10, 8), 0.24, 0.56, 1.98, "#fff6d8", {}, 4)
    .merge();

  const wheelParts = new Parts()
    .add(new THREE.TorusGeometry(0.27, 0.155, 12, 26), 0, 0, 0, "#0d0e12", { ry: Math.PI / 2 })
    .cyl(0.205, 0.205, 0.27, 0, 0, 0, { rz: Math.PI / 2 }, "#c7ccd6", 20)
    .cyl(0.09, 0.09, 0.31, 0, 0, 0, { rz: Math.PI / 2 }, "#f59e0b", 12);
  for (let k = 0; k < 3; k++) wheelParts.box(0.285, 0.39, 0.055, 0, 0, 0, { rx: (k * Math.PI) / 3 }, "#1f2937");
  const wheel = wheelParts.merge();

  return {
    paint,
    accent,
    dark,
    metal,
    suit,
    visor,
    lights,
    wheel,
    flame: new THREE.ConeGeometry(0.2, 1.5, 12, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.75),
    blob: new THREE.CircleGeometry(1.9, 24).rotateX(-Math.PI / 2),
    glowPlane: new THREE.PlaneGeometry(6, 8.5).rotateX(-Math.PI / 2),
    darkMat: new THREE.MeshStandardMaterial({ color: "#14171d", roughness: 0.55, metalness: 0.2 }),
    metalMat: new THREE.MeshStandardMaterial({ color: "#cfd4dc", roughness: 0.22, metalness: 1 }),
    suitMat: new THREE.MeshStandardMaterial({ color: "#f1f5f9", roughness: 0.8 }),
    visorMat: new THREE.MeshStandardMaterial({ color: "#0b1020", roughness: 0.06, metalness: 0.9 }),
    lightsMat: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    wheelMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.15 }),
    blobMat: new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.28, depthWrite: false }),
    glowTex: glowTexture(),
  };
}

const WHEELS: [number, number, number, number][] = [
  // x, y, z, scale
  [-0.84, 0.42, 1.0, 1],
  [0.84, 0.42, 1.0, 1],
  [-0.88, 0.46, -0.95, 1.1],
  [0.88, 0.46, -0.95, 1.1],
];

/** Local positions of the rear wheels' contact patches and the two exhaust tips. */
export const REAR_LEFT = new THREE.Vector3(-0.88, 0.15, -1.05);
export const REAR_RIGHT = new THREE.Vector3(0.88, 0.15, -1.05);
export const EXHAUST = new THREE.Vector3(0, 0.63, -1.95);

export interface KartLook {
  shadows: boolean;
  underglow: boolean;
}

export class KartVisual {
  readonly group = new THREE.Group();
  /** Smoothed steering (-1 left .. 1 right), derived from how fast the kart is turning. */
  steer = 0;
  private readonly body = new THREE.Group();
  private readonly wheels: THREE.Mesh[] = [];
  private readonly pivots: THREE.Group[] = [];
  private readonly flames: THREE.Mesh[] = [];
  private readonly flameMat: THREE.MeshBasicMaterial;
  private readonly label: THREE.Sprite;
  private readonly blob: THREE.Mesh;
  private readonly glow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly paint: THREE.MeshPhysicalMaterial;
  private readonly accent: THREE.MeshPhysicalMaterial;
  private readonly meshes: THREE.Mesh[] = [];
  private slide = 0;
  private hop = 0;
  private roll = 0;
  private pitch = 0;
  private wasDrifting = false;
  private lastHeading = 0;
  private lastSpeed = 0;
  private started = false;
  private colorIndex = -1;
  private labelText = "";

  constructor() {
    const s = (shared ??= buildShared());
    this.paint = new THREE.MeshPhysicalMaterial({ color: "#ffffff", roughness: 0.42, metalness: 0.12, clearcoat: 1, clearcoatRoughness: 0.12 });
    this.accent = new THREE.MeshPhysicalMaterial({ color: "#ffffff", roughness: 0.3, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.1 });
    const b = this.body;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = shadow;
      b.add(m);
      this.meshes.push(m);
      return m;
    };
    add(s.paint, this.paint);
    add(s.accent, this.accent);
    add(s.dark, s.darkMat);
    add(s.metal, s.metalMat);
    add(s.suit, s.suitMat);
    add(s.visor, s.visorMat, false);
    add(s.lights, s.lightsMat, false);

    WHEELS.forEach(([x, y, z, scale], i) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);
      const w = new THREE.Mesh(s.wheel, s.wheelMat);
      w.scale.setScalar(scale);
      w.castShadow = true;
      this.meshes.push(w);
      pivot.add(w);
      b.add(pivot);
      this.wheels.push(w);
      if (i < 2) this.pivots.push(pivot);
    });

    this.flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.2, 0.5), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    for (const x of [-0.3, 0.3]) {
      const f = new THREE.Mesh(s.flame, this.flameMat);
      f.position.set(x, 0.63, -1.88);
      f.visible = false;
      b.add(f);
      this.flames.push(f);
    }
    this.group.add(b);

    this.blob = new THREE.Mesh(s.blob, s.blobMat);
    this.blob.position.y = 0.09;
    this.blob.scale.set(0.8, 1, 1.25);
    this.group.add(this.blob);

    // Neon underglow: a soft pool of the kart's colour on the road beneath it.
    this.glow = new THREE.Mesh(s.glowPlane, new THREE.MeshBasicMaterial({ map: s.glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0.55 }));
    this.glow.position.y = 0.1;
    this.glow.visible = false;
    this.group.add(this.glow);

    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, toneMapped: false }));
    this.label.scale.set(5.5, 1.2, 1);
    this.label.position.y = 3.3;
    this.label.renderOrder = 20;
    this.group.add(this.label);
  }

  setLook(look: KartLook): void {
    for (const m of this.meshes) m.castShadow = look.shadows && m.material !== shared!.visorMat && m.material !== shared!.lightsMat;
    this.blob.visible = !look.shadows;
    this.glow.visible = look.underglow;
  }

  setIdentity(name: string, colorIndex: number, showLabel: boolean): void {
    if (colorIndex !== this.colorIndex) {
      this.colorIndex = colorIndex;
      const base = new THREE.Color(KART_COLORS[colorIndex % KART_COLORS.length]);
      // Slightly deepened so the paint stays saturated under bright light.
      this.paint.color.copy(base).multiplyScalar(0.82);
      this.accent.color.copy(base).lerp(new THREE.Color("#ffffff"), 0.55);
      this.glow.material.color.copy(base).multiplyScalar(2.2);
      this.labelText = "";
    }
    if (name !== this.labelText) {
      this.labelText = name;
      const mat = this.label.material;
      mat.map?.dispose();
      mat.map = labelTexture(name, KART_COLORS[colorIndex % KART_COLORS.length]);
      mat.needsUpdate = true;
    }
    this.label.visible = showLabel;
  }

  update(x: number, z: number, heading: number, speed: number, flags: number, dt: number, time: number): void {
    this.group.position.set(x, 0, z);
    this.group.rotation.y = heading;
    if (!this.started) {
      this.started = true;
      this.lastHeading = heading;
      this.lastSpeed = speed;
    }

    const drift = flags & FLAG.DRIFT_LEFT ? -1 : flags & FLAG.DRIFT_RIGHT ? 1 : 0;
    const boosting = (flags & FLAG.BOOST) !== 0;
    const k = 1 - Math.exp(-dt * 10);

    // Steering and weight transfer are read off the motion itself, so remote
    // karts animate exactly like the local one.
    let dh = heading - this.lastHeading;
    if (dh > Math.PI) dh -= Math.PI * 2;
    else if (dh < -Math.PI) dh += Math.PI * 2;
    const yawRate = dt > 0 ? dh / dt : 0;
    const accel = dt > 0 ? (speed - this.lastSpeed) / dt : 0;
    this.lastHeading = heading;
    this.lastSpeed = speed;
    const steerTarget = Math.max(-1, Math.min(1, -yawRate / 1.7)) * (speed < 0 ? -1 : 1);
    this.steer += (steerTarget - this.steer) * k;

    if (drift !== 0 && !this.wasDrifting) this.hop = 1;
    this.wasDrifting = drift !== 0;
    this.hop = Math.max(0, this.hop - dt * 3.4);

    // Body attitude: slide into drifts, lean out of corners, squat under power.
    const grip = Math.min(1, Math.abs(speed) / 22);
    this.slide += (-drift * 0.42 - this.slide) * k;
    this.roll += (this.steer * grip * 0.075 + this.slide * 0.22 - this.roll) * k;
    this.pitch += (Math.max(-0.05, Math.min(0.05, -accel * 0.0022)) - this.pitch) * k;
    this.body.rotation.set(this.pitch, this.slide, this.roll);
    const rumble = Math.abs(speed) > 1 ? Math.sin(time * 47 + x) * 0.006 * Math.min(1, Math.abs(speed) / 20) : 0;
    this.body.position.y = Math.sin(this.hop * Math.PI) * 0.6 + rumble + (boosting ? Math.sin(time * 70) * 0.012 : 0);

    const spin = (speed * dt) / 0.42;
    for (const w of this.wheels) w.rotation.x += spin;
    for (const p of this.pivots) p.rotation.y = -this.steer * 0.42;

    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      f.visible = boosting;
      if (boosting) {
        const flick = 0.75 + Math.abs(Math.sin(time * 53 + i * 1.7)) * 0.6;
        f.scale.set(1 + flick * 0.25, 1 + flick * 0.25, flick);
      }
    }
    if (this.glow.visible) this.glow.material.opacity = 0.45 + (boosting ? 0.3 : 0) + Math.sin(time * 5 + x) * 0.04;
  }

  /** Convert a point in kart space to world space (ignores body roll and slide). */
  toWorld(local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const h = this.group.rotation.y;
    const s = Math.sin(h);
    const c = Math.cos(h);
    out.x = this.group.position.x + local.x * c + local.z * s;
    out.y = local.y;
    out.z = this.group.position.z - local.x * s + local.z * c;
    return out;
  }

  dispose(): void {
    this.label.material.map?.dispose();
    this.label.material.dispose();
    this.glow.material.dispose();
    this.paint.dispose();
    this.accent.dispose();
    this.flameMat.dispose();
  }
}
