/**
 * The kart model and its animation. Geometry is built once and shared by every
 * kart; each kart only owns its paint materials, so twelve karts cost little.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FLAG, FX, KART_COLORS } from "@office-kart/shared";
import { bake, compose, type PartOptions } from "./builder";
import { glowTexture, labelTexture } from "./textures";

interface Shared {
  cockpit: THREE.BufferGeometry;
  headMat: THREE.Material;
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
    .merge();

  const dark = new Parts()
    .box(1.5, 0.07, 3.0, 0, 0.27, 0.1)
    .box(0.07, 0.5, 0.1, -0.3, 1.18, -1.42)
    .box(0.07, 0.5, 0.1, 0.3, 1.18, -1.42)
    .cyl(0.055, 0.055, 1.72, 0, 0.42, 1.0, { rz: Math.PI / 2 }, "#fff", 10)
    .cyl(0.055, 0.055, 1.76, 0, 0.44, -0.95, { rz: Math.PI / 2 }, "#fff", 10)
    .rbox(1.34, 0.13, 0.15, 0.05, 0, 0.45, -1.52)
    .merge();

  // Seat, steering wheel and gloves: these travel with the driver.
  const cockpit = new Parts()
    .rbox(0.74, 0.72, 0.2, 0.08, 0, 0.95, -0.58, { rx: -0.2 })
    .rbox(0.72, 0.14, 0.62, 0.06, 0, 0.66, -0.25)
    .cyl(0.035, 0.035, 0.6, 0, 0.93, 0.44, { rx: 1.0 })
    .add(new THREE.TorusGeometry(0.2, 0.04, 10, 24), 0, 1.11, 0.25, "#fff", { rx: -0.55 })
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
    cockpit,
    headMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.1 }),
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

type WheelSpec = [x: number, y: number, z: number, scale: number];

interface VehicleParts {
  paint: THREE.BufferGeometry;
  accent: THREE.BufferGeometry;
  dark: THREE.BufferGeometry;
  metal: THREE.BufferGeometry;
  lights: THREE.BufferGeometry | null;
  wheels: WheelSpec[];
  /** How far the driver sits above and behind the go-kart's seat. */
  seat: [y: number, z: number];
  flames: [x: number, y: number, z: number];
}

const vehicleCache: (VehicleParts | undefined)[] = [];
const mirror = (list: WheelSpec[]): WheelSpec[] => list.flatMap(([x, y, z, k]) => [[-x, y, z, k], [x, y, z, k]] as WheelSpec[]);

/** Bodywork for each entry in VEHICLES. Built the first time someone picks it. */
function vehicleParts(index: number): VehicleParts {
  const cached = vehicleCache[index];
  if (cached) return cached;
  const s = shared!;
  let v: VehicleParts;
  switch (index) {
    case 1: // Scooter: narrow and upright
      v = {
        paint: new Parts()
          .rbox(0.66, 0.2, 2.5, 0.08, 0, 0.5, 0)
          .rbox(0.74, 0.95, 0.16, 0.07, 0, 0.98, 1.06, { rx: -0.22 })
          .rbox(0.68, 0.44, 0.95, 0.14, 0, 0.74, -1.05)
          .rbox(0.34, 0.16, 0.74, 0.07, 0, 0.8, 1.5)
          .merge(),
        accent: new Parts().rbox(0.2, 0.04, 1.3, 0.02, 0, 0.61, 0.1).rbox(0.5, 0.3, 0.05, 0.02, 0, 1.2, 1.17, { rx: -0.22 }).rbox(0.7, 0.08, 0.3, 0.03, 0, 0.99, -1.3).merge(),
        dark: new Parts().box(0.98, 0.06, 1.0, 0, 0.4, 0.25).cyl(0.035, 0.035, 0.98, 0, 1.5, 0.9, { rz: Math.PI / 2 }, "#fff", 8).cyl(0.045, 0.045, 0.8, 0, 1.15, 0.98, { rx: -0.22 }, "#fff", 8).cyl(0.05, 0.05, 0.96, 0, 0.36, 1.25, { rz: Math.PI / 2 }, "#fff", 8).cyl(0.05, 0.05, 1.04, 0, 0.38, -1.1, { rz: Math.PI / 2 }, "#fff", 8).merge(),
        metal: new Parts().cyl(0.07, 0.09, 0.8, 0.36, 0.52, -1.35, { rx: Math.PI / 2 }, "#fff", 12).cyl(0.03, 0.03, 0.5, 0, 1.58, 0.9, {}, "#fff", 8).merge(),
        lights: new Parts().add(new THREE.SphereGeometry(0.1, 10, 8), 0, 1.3, 1.2, "#fff6d8", {}, 4).rbox(0.3, 0.08, 0.06, 0.02, 0, 0.8, -1.54, {}, "#ff2a2a", 4).merge(),
        wheels: mirror([[0.44, 0.36, 1.25, 0.86], [0.48, 0.38, -1.1, 0.9]]),
        seat: [0.12, -0.2],
        flames: [0.36, 0.52, -1.8],
      };
      break;
    case 2: // Hot Rod: long nose, big rear wheels, engine on show
      v = {
        paint: new Parts()
          .rbox(1.12, 0.44, 1.9, 0.14, 0, 0.64, -0.55)
          .rbox(0.82, 0.36, 1.5, 0.12, 0, 0.6, 1.05)
          .rbox(0.72, 0.42, 0.2, 0.08, 0, 0.6, 1.86)
          .rbox(0.5, 0.26, 1.15, 0.12, -0.92, 1.12, -1.0)
          .rbox(0.5, 0.26, 1.15, 0.12, 0.92, 1.12, -1.0)
          .rbox(1.0, 0.3, 0.5, 0.12, 0, 0.8, -1.6)
          .merge(),
        accent: new Parts().rbox(0.84, 0.04, 1.3, 0.02, 0, 0.785, 1.05).rbox(1.14, 0.05, 0.7, 0.02, 0, 0.865, -1.2).merge(),
        dark: new Parts().box(1.4, 0.07, 3.3, 0, 0.3, 0.1).box(0.6, 0.3, 0.06, 0, 0.6, 1.97).cyl(0.055, 0.055, 1.6, 0, 0.36, 1.35, { rz: Math.PI / 2 }, "#fff", 10).cyl(0.07, 0.07, 1.9, 0, 0.6, -1.0, { rz: Math.PI / 2 }, "#fff", 10).merge(),
        metal: new Parts()
          .rbox(0.5, 0.3, 0.62, 0.06, 0, 0.93, 1.0)
          .rbox(0.3, 0.2, 0.34, 0.05, 0, 1.16, 1.0)
          .cyl(0.08, 0.08, 2.0, -0.66, 0.42, -0.2, { rx: Math.PI / 2 }, "#fff", 12)
          .cyl(0.08, 0.08, 2.0, 0.66, 0.42, -0.2, { rx: Math.PI / 2 }, "#fff", 12)
          .merge(),
        lights: new Parts().add(new THREE.SphereGeometry(0.11, 10, 8), -0.52, 0.74, 1.8, "#fff6d8", {}, 4).add(new THREE.SphereGeometry(0.11, 10, 8), 0.52, 0.74, 1.8, "#fff6d8", {}, 4).rbox(0.8, 0.08, 0.06, 0.02, 0, 0.82, -1.86, {}, "#ff2a2a", 4).merge(),
        wheels: mirror([[0.78, 0.36, 1.35, 0.86], [0.98, 0.6, -1.0, 1.42]]),
        seat: [0.14, -0.35],
        flames: [0.66, 0.42, -1.3],
      };
      break;
    case 3: // Forklift: tall, square, roll cage and forks
      v = {
        paint: new Parts().rbox(1.5, 0.72, 2.2, 0.12, 0, 0.76, -0.3).rbox(1.5, 0.62, 0.62, 0.16, 0, 0.97, -1.45).rbox(1.4, 0.5, 0.14, 0.05, 0, 0.72, 0.92).merge(),
        accent: new Parts().rbox(1.46, 0.08, 1.6, 0.03, 0, 2.5, -0.4).rbox(1.52, 0.1, 0.64, 0.03, 0, 0.6, -1.45).rbox(1.52, 0.1, 2.0, 0.03, 0, 0.44, -0.3).merge(),
        dark: new Parts()
          .box(0.08, 1.4, 0.08, -0.66, 1.8, 0.3)
          .box(0.08, 1.4, 0.08, 0.66, 1.8, 0.3)
          .box(0.08, 1.4, 0.08, -0.66, 1.8, -1.1)
          .box(0.08, 1.4, 0.08, 0.66, 1.8, -1.1)
          .box(0.1, 2.0, 0.1, -0.45, 1.2, 1.05)
          .box(0.1, 2.0, 0.1, 0.45, 1.2, 1.05)
          .box(1.0, 0.08, 0.1, 0, 2.16, 1.05)
          .merge(),
        metal: new Parts().box(0.14, 0.06, 1.2, -0.4, 0.2, 1.65).box(0.14, 0.06, 1.2, 0.4, 0.2, 1.65).box(1.1, 0.5, 0.06, 0, 0.5, 1.12).merge(),
        lights: new Parts().add(new THREE.SphereGeometry(0.12, 10, 8), 0, 2.62, -0.4, "#fb923c", {}, 5).rbox(0.3, 0.1, 0.06, 0.02, -0.5, 1.0, -1.77, {}, "#ff2a2a", 4).rbox(0.3, 0.1, 0.06, 0.02, 0.5, 1.0, -1.77, {}, "#ff2a2a", 4).merge(),
        wheels: mirror([[0.82, 0.5, 0.72, 1.2], [0.82, 0.46, -1.1, 1.1]]),
        seat: [0.46, -0.12],
        flames: [0.4, 0.6, -1.75],
      };
      break;
    case 4: // Drifter: low and wide with a big wing
      v = {
        paint: new Parts()
          .rbox(1.5, 0.24, 2.7, 0.1, 0, 0.42, 0)
          .rbox(1.3, 0.2, 0.9, 0.08, 0, 0.4, 1.5, { rx: 0.1 })
          .rbox(0.3, 0.3, 1.3, 0.1, -0.62, 0.62, -0.25)
          .rbox(0.3, 0.3, 1.3, 0.1, 0.62, 0.62, -0.25)
          .rbox(0.96, 0.38, 0.9, 0.14, 0, 0.7, -1.1)
          .rbox(2.0, 0.07, 0.56, 0.03, 0, 1.6, -1.58, { rx: 0.2 })
          .rbox(1.96, 0.05, 0.4, 0.02, 0, 0.24, 1.98)
          .merge(),
        accent: new Parts().rbox(0.07, 0.5, 0.66, 0.025, -1.0, 1.44, -1.58).rbox(0.07, 0.5, 0.66, 0.025, 1.0, 1.44, -1.58).rbox(0.3, 0.04, 2.4, 0.02, 0, 0.545, 0.3).merge(),
        dark: new Parts().box(1.56, 0.06, 3.1, 0, 0.26, 0.1).box(0.07, 0.72, 0.1, -0.36, 1.22, -1.5).box(0.07, 0.72, 0.1, 0.36, 1.22, -1.5).cyl(0.055, 0.055, 1.74, 0, 0.38, 1.15, { rz: Math.PI / 2 }, "#fff", 10).cyl(0.055, 0.055, 1.8, 0, 0.44, -1.0, { rz: Math.PI / 2 }, "#fff", 10).merge(),
        metal: new Parts().cyl(0.1, 0.12, 0.5, -0.26, 0.5, -1.6, { rx: Math.PI / 2 }, "#fff", 12).cyl(0.1, 0.12, 0.5, 0.26, 0.5, -1.6, { rx: Math.PI / 2 }, "#fff", 12).merge(),
        lights: new Parts().rbox(1.2, 0.06, 0.05, 0.02, 0, 0.62, -1.56, {}, "#ff2a2a", 4).rbox(0.3, 0.06, 0.06, 0.02, -0.5, 0.46, 1.94, {}, "#fff6d8", 4).rbox(0.3, 0.06, 0.06, 0.02, 0.5, 0.46, 1.94, {}, "#fff6d8", 4).merge(),
        wheels: mirror([[0.88, 0.38, 1.15, 0.9], [0.92, 0.44, -1.0, 1.05]]),
        seat: [-0.08, 0],
        flames: [0.26, 0.5, -1.85],
      };
      break;
    default:
      v = { paint: s.paint, accent: s.accent, dark: s.dark, metal: s.metal, lights: s.lights, wheels: WHEELS, seat: [0, 0], flames: [0.3, 0.63, -1.88] };
  }
  vehicleCache[index] = v;
  return v;
}

interface AvatarParts {
  /** Painted in the kart's accent colour (helmets). */
  tint: THREE.BufferGeometry | null;
  /** Has its own colours (hats, ears, whole heads). */
  fixed: THREE.BufferGeometry | null;
  visor: boolean;
}

const avatarCache: (AvatarParts | undefined)[] = [];
const HEAD_Y = 1.52;
const HEAD_Z = -0.28;

/** Head and headgear for each entry in AVATARS. */
function avatarParts(index: number): AvatarParts {
  const cached = avatarCache[index];
  if (cached) return cached;
  const helmet = () => new Parts().add(new THREE.SphereGeometry(0.35, 24, 18), 0, HEAD_Y, HEAD_Z).merge();
  const y = HEAD_Y;
  const z = HEAD_Z;
  let a: AvatarParts;
  switch (index) {
    case 1: // Cat
      a = { tint: new Parts().add(new THREE.SphereGeometry(0.35, 24, 18), 0, y, z).add(new THREE.ConeGeometry(0.12, 0.24, 10), -0.2, y + 0.36, z, "#fff", { rz: 0.3 }).add(new THREE.ConeGeometry(0.12, 0.24, 10), 0.2, y + 0.36, z, "#fff", { rz: -0.3 }).merge(), fixed: new Parts().add(new THREE.ConeGeometry(0.06, 0.13, 8), -0.2, y + 0.35, z + 0.03, "#f9a8d4", { rz: 0.3 }).add(new THREE.ConeGeometry(0.06, 0.13, 8), 0.2, y + 0.35, z + 0.03, "#f9a8d4", { rz: -0.3 }).cyl(0.05, 0.03, 0.5, 0, 1.05, -0.78, { rx: -0.9 }, "#e5e7eb", 8).merge(), visor: true };
      break;
    case 2: // Robot
      a = { tint: null, fixed: new Parts().rbox(0.58, 0.5, 0.56, 0.07, 0, y, z, {}, "#9ca3af").rbox(0.46, 0.16, 0.05, 0.02, 0, y + 0.05, z + 0.285, {}, "#0f172a").add(new THREE.SphereGeometry(0.055, 10, 8), -0.11, y + 0.05, z + 0.3, "#22d3ee", {}, 3).add(new THREE.SphereGeometry(0.055, 10, 8), 0.11, y + 0.05, z + 0.3, "#22d3ee", {}, 3).cyl(0.02, 0.02, 0.24, 0, y + 0.36, z, {}, "#6b7280", 6).add(new THREE.SphereGeometry(0.06, 10, 8), 0, y + 0.5, z, "#ef4444", {}, 2.5).cyl(0.07, 0.07, 0.1, -0.33, y, z, { rz: Math.PI / 2 }, "#6b7280", 10).cyl(0.07, 0.07, 0.1, 0.33, y, z, { rz: Math.PI / 2 }, "#6b7280", 10).merge(), visor: false };
      break;
    case 3: // Boss: top hat
      a = { tint: helmet(), fixed: new Parts().cyl(0.44, 0.44, 0.04, 0, y + 0.3, z, {}, "#111827", 24).cyl(0.26, 0.28, 0.38, 0, y + 0.5, z, {}, "#111827", 24).cyl(0.285, 0.285, 0.08, 0, y + 0.36, z, {}, "#dc2626", 24).merge(), visor: true };
      break;
    case 4: // Intern: cap and headphones
      a = { tint: helmet(), fixed: new Parts().add(new THREE.SphereGeometry(0.365, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2.4), 0, y + 0.02, z, "#2563eb").rbox(0.4, 0.04, 0.3, 0.015, 0, y + 0.2, z + 0.42, { rx: 0.15 }, "#1d4ed8").cyl(0.11, 0.11, 0.09, -0.37, y - 0.02, z, { rz: Math.PI / 2 }, "#111827", 14).cyl(0.11, 0.11, 0.09, 0.37, y - 0.02, z, { rz: Math.PI / 2 }, "#111827", 14).merge(), visor: true };
      break;
    case 5: { // Royal: crown
      const crown = new Parts().add(new THREE.CylinderGeometry(0.25, 0.23, 0.14, 20, 1, true), 0, y + 0.37, z, "#facc15");
      for (let i = 0; i < 6; i++) {
        const t = (i / 6) * Math.PI * 2;
        crown.add(new THREE.ConeGeometry(0.06, 0.16, 8), Math.cos(t) * 0.24, y + 0.5, z + Math.sin(t) * 0.24, "#facc15");
        crown.add(new THREE.SphereGeometry(0.035, 8, 6), Math.cos(t) * 0.24, y + 0.59, z + Math.sin(t) * 0.24, i % 2 ? "#ef4444" : "#38bdf8", {}, 2);
      }
      a = { tint: helmet(), fixed: crown.merge(), visor: true };
      break;
    }
    case 6: // Alien
      a = { tint: null, fixed: new Parts().add(new THREE.SphereGeometry(0.34, 22, 16), 0, y + 0.03, z, "#4ade80", { sy: 1.18 }).add(new THREE.SphereGeometry(0.11, 12, 10), -0.14, y + 0.06, z + 0.26, "#0f172a", { sy: 1.4, rz: 0.35 }).add(new THREE.SphereGeometry(0.11, 12, 10), 0.14, y + 0.06, z + 0.26, "#0f172a", { sy: 1.4, rz: -0.35 }).cyl(0.015, 0.015, 0.3, -0.14, y + 0.5, z, { rz: 0.3 }, "#22c55e", 6).cyl(0.015, 0.015, 0.3, 0.14, y + 0.5, z, { rz: -0.3 }, "#22c55e", 6).add(new THREE.SphereGeometry(0.05, 8, 6), -0.19, y + 0.65, z, "#fde047", {}, 3).add(new THREE.SphereGeometry(0.05, 8, 6), 0.19, y + 0.65, z, "#fde047", {}, 3).merge(), visor: false };
      break;
    case 7: { // Unicorn
      const u = new Parts().add(new THREE.SphereGeometry(0.35, 22, 16), 0, y, z, "#f8fafc").add(new THREE.ConeGeometry(0.07, 0.42, 10), 0, y + 0.5, z + 0.12, "#facc15", { rx: 0.25 }).add(new THREE.ConeGeometry(0.08, 0.18, 8), -0.2, y + 0.36, z - 0.02, "#f8fafc").add(new THREE.ConeGeometry(0.08, 0.18, 8), 0.2, y + 0.36, z - 0.02, "#f8fafc");
      ["#f472b6", "#a78bfa", "#38bdf8", "#34d399"].forEach((c, i) => u.add(new THREE.SphereGeometry(0.13, 10, 8), 0, y + 0.3 - i * 0.17, z - 0.24 - i * 0.07, c));
      a = { tint: null, fixed: u.merge(), visor: true };
      break;
    }
    case 8: // Astronaut
      a = { tint: null, fixed: new Parts().add(new THREE.SphereGeometry(0.41, 24, 18), 0, y + 0.02, z, "#f1f5f9").add(new THREE.SphereGeometry(0.415, 24, 12, Math.PI / 2 - 1.05, 2.1, 0.95, 0.85), 0, y + 0.02, z, "#f59e0b", {}, 1.4).cyl(0.08, 0.08, 0.1, -0.42, y, z, { rz: Math.PI / 2 }, "#94a3b8", 10).cyl(0.08, 0.08, 0.1, 0.42, y, z, { rz: Math.PI / 2 }, "#94a3b8", 10).cyl(0.012, 0.012, 0.3, 0.3, y + 0.5, z - 0.1, {}, "#94a3b8", 6).merge(), visor: false };
      break;
    case 9: // Chef
      a = { tint: helmet(), fixed: new Parts().cyl(0.25, 0.25, 0.24, 0, y + 0.42, z, {}, "#f8fafc", 20).add(new THREE.SphereGeometry(0.2, 12, 10), -0.14, y + 0.62, z, "#f8fafc").add(new THREE.SphereGeometry(0.2, 12, 10), 0.14, y + 0.62, z, "#f8fafc").add(new THREE.SphereGeometry(0.21, 12, 10), 0, y + 0.66, z + 0.08, "#f8fafc").add(new THREE.SphereGeometry(0.2, 12, 10), 0, y + 0.62, z - 0.12, "#f8fafc").merge(), visor: true };
      break;
    default: // Racer
      a = { tint: helmet(), fixed: null, visor: true };
  }
  avatarCache[index] = a;
  return a;
}

const WHEELS: WheelSpec[] = [
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
  private readonly driver = new THREE.Group();
  private bodyMeshes: THREE.Mesh[] = [];
  private helmet!: THREE.Mesh;
  private headgear!: THREE.Mesh;
  private visor!: THREE.Mesh;
  private vehicle = 0;
  private avatar = 0;
  private readonly wheels: THREE.Mesh[] = [];
  private readonly pivots: THREE.Group[] = [];
  private readonly wheelPivots: THREE.Group[] = [];
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
    this.bodyMeshes = [add(s.paint, this.paint), add(s.accent, this.accent), add(s.dark, s.darkMat), add(s.metal, s.metalMat), add(s.lights, s.lightsMat, false)];
    // The driver, seat and steering wheel sit in their own group so each vehicle can place them.
    const addDriver = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = shadow;
      this.driver.add(m);
      this.meshes.push(m);
      return m;
    };
    addDriver(s.cockpit, s.darkMat);
    addDriver(s.suit, s.suitMat);
    const racer = avatarParts(0);
    this.helmet = addDriver(racer.tint!, this.accent);
    this.headgear = addDriver(racer.tint!, s.headMat);
    this.headgear.visible = false;
    this.visor = addDriver(s.visor, s.visorMat, false);
    b.add(this.driver);

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
      this.wheelPivots.push(pivot);
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

    this.bubble = new THREE.Mesh(new THREE.SphereGeometry(2.3, 20, 14), new THREE.MeshPhysicalMaterial({ color: "#7dd3fc", transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.1, depthWrite: false }));
    this.bubble.position.y = 0.9;
    this.bubble.visible = false;
    this.group.add(this.bubble);

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

  /** Swap the bodywork and the driver's look. Cheap to call every frame: it only acts on a change. */
  setStyle(vehicle: number, avatar: number): void {
    if (vehicle !== this.vehicle) {
      this.vehicle = vehicle;
      const v = vehicleParts(vehicle);
      const geos = [v.paint, v.accent, v.dark, v.metal, v.lights];
      this.bodyMeshes.forEach((m, i) => {
        m.visible = geos[i] !== null;
        if (geos[i]) m.geometry = geos[i]!;
      });
      v.wheels.forEach(([x, y, z, scale], i) => {
        this.wheelPivots[i].position.set(x, y, z);
        this.wheels[i].scale.setScalar(scale);
      });
      this.driver.position.set(0, v.seat[0], v.seat[1]);
      this.flames.forEach((f, i) => f.position.set(i === 0 ? -v.flames[0] : v.flames[0], v.flames[1], v.flames[2]));
      this.label.position.y = 3.3 + Math.max(0, v.seat[0]) * 1.4;
    }
    if (avatar !== this.avatar) {
      this.avatar = avatar;
      const a = avatarParts(avatar);
      this.helmet.visible = a.tint !== null;
      if (a.tint) this.helmet.geometry = a.tint;
      this.headgear.visible = a.fixed !== null;
      if (a.fixed) this.headgear.geometry = a.fixed;
      this.visor.visible = a.visor;
    }
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

  /** Search hint for finding this kart's place on the track. */
  hint = -1;
  wasAir = false;
  private sizeNow = 1;
  private spinAngle = 0;
  private trickAngle = 0;
  private ghost = false;
  private readonly bubble: THREE.Mesh;
  private tiltX = 0;
  private tiltZ = 0;
  private lastY = 0;

  /** `pitch` and `roll` are the slope of the ground under the kart (nose-up and right-side-up, radians). */
  update(x: number, y: number, z: number, heading: number, speed: number, flags: number, pitch: number, roll: number, dt: number, time: number, fx = 0): void {
    this.group.position.set(x, y, z);
    // Status effects: size, spin-out, bubble, ghost.
    const size = fx & FX.GIANT ? 1.9 : fx & FX.MINI ? 0.6 : 1;
    this.sizeNow += (size - this.sizeNow) * (1 - Math.exp(-dt * 8));
    this.group.scale.setScalar(this.sizeNow);
    this.spinAngle = fx & FX.SPIN ? this.spinAngle + dt * 15 : 0;
    // A jump trick is one quick barrel roll.
    this.trickAngle = fx & FX.TRICK ? Math.min(Math.PI * 2, this.trickAngle + dt * 13) : 0;
    this.bubble.visible = (fx & FX.SHIELD) !== 0;
    const ghost = (fx & FX.PHANTOM) !== 0;
    if (ghost !== this.ghost) {
      this.ghost = ghost;
      for (const m of [this.paint, this.accent]) {
        m.transparent = ghost;
        m.opacity = ghost ? 0.35 : 1;
        m.needsUpdate = true;
      }
    }
    const airborne = (flags & FLAG.AIRBORNE) !== 0;
    if (airborne && dt > 0) {
      // In the air the nose follows the arc of the jump.
      pitch = Math.max(-0.5, Math.min(0.5, Math.atan2((y - this.lastY) / dt, Math.max(8, Math.abs(speed)))));
      roll = 0;
    }
    this.lastY = y;
    const kt = 1 - Math.exp(-dt * (airborne ? 6 : 14));
    this.tiltX += (-pitch - this.tiltX) * kt;
    this.tiltZ += (-roll - this.tiltZ) * kt;
    this.group.rotation.set(this.tiltX, heading, this.tiltZ, "YXZ");
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
    this.body.rotation.set(this.pitch, this.slide + this.spinAngle, this.roll + this.trickAngle);
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
    out.y = this.group.position.y + local.y;
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
