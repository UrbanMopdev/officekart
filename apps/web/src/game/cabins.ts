/**
 * Real car interiors for the driver's view. Each is the cabin of the car's own model (dashboard,
 * wheel, seats, door cards, pillars, mirrors) together with the bodywork seen from the seat, rebuilt
 * as a compact model by tools outside the repo. Only your own car ever needs one, so they are
 * fetched on demand, the first time you sit in that car.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

export interface CabinSpec {
  /** The driver's eyes in the car's frame, in metres: +x is the car's left, +z is forwards. */
  eye: [number, number, number];
  /** Materials that are screens or lamps: kept glowing softly instead of blazing white. */
  screens?: RegExp;
  /** Colour fixes for materials that arrive plain black or plain white, by name. */
  tones?: Record<string, { color?: string; roughness?: number; metalness?: number; emissive?: string; glow?: number }>;
  /** Where a live speed readout goes when the car's own instruments are a still picture: centre, size, tilt. */
  readout?: { at: [number, number, number]; size: [number, number]; tilt: number; yaw?: number };
  /** The instrument display is a picture the game redraws (the concept car's panel). */
  livePanel?: boolean;
}

export const CABINS: Record<string, CabinSpec> = {
  concept: { eye: [0, 0.955, 0.3], livePanel: true },
  corolla: {
    eye: [0.34, 1.115, 0.02],
    tones: {
      m_e180_black: { color: "#1b1c1f", roughness: 0.78, metalness: 0 },
      m_e180_gray: { color: "#2a2b2f", roughness: 0.7, metalness: 0 },
      m_e180_intlight: { color: "#05070a", emissive: "#0c1f33", glow: 1 },
      m_e180_multi: { color: "#05070a", emissive: "#0c1f33", glow: 1 },
      m_e180_RL: { color: "#3a0d0d", roughness: 0.4 },
      m_e180_povl: { color: "#3a2a12", roughness: 0.4 },
      m_e180_povr: { color: "#3a2a12", roughness: 0.4 },
      m_e180_short: { color: "#d8d8d8", roughness: 0.3 },
      m_e180_long: { color: "#d8d8d8", roughness: 0.3 },
    },
    readout: { at: [0.34, 0.905, 0.705], size: [0.062, 0.05], tilt: 0.42 },
  },
  prius: {
    eye: [0.361, 1.155, -0.13],
    tones: {
      m_Carro_Interno: { color: "#2a2c30", roughness: 0.82, metalness: 0 },
      m_Carro_Plastico: { color: "#141518", roughness: 0.7, metalness: 0 },
      m_Carro_Plastico_Brilho: { color: "#0b0b0d", roughness: 0.2, metalness: 0.2 },
      m_Carro_Espelhos: { color: "#e9edf0", roughness: 0.03, metalness: 1 },
    },
  },
  hondae: { eye: [0.33, 1.165, -0.1] },
  fortuner: { eye: [-0.376, 1.45, -0.04], tones: { m_chrome_only: { color: "#e9edf0", roughness: 0.03, metalness: 1 } } },
  golf: {
    eye: [0.403, 1.1, 0.1],
    tones: {
      m_plastic: { color: "#1d1e22", roughness: 0.72, metalness: 0 },
      m_interior: { color: "#25262a", roughness: 0.8, metalness: 0 },
      m_seats: { color: "#3a3d45", roughness: 0.95, metalness: 0 },
      m_metal: { color: "#b9bdc4", roughness: 0.3, metalness: 1 },
      m_mirror: { color: "#e9edf0", roughness: 0.03, metalness: 1 },
    },
  },
};

/** Cars whose own model has no cabin borrow one of the same era. */
const BORROWED: Record<string, string> = { delorean: "golf", datsun: "golf", cadillac: "golf" };
export const cabinKey = (car: string | null): string | null => (car ? (BORROWED[car] ?? car) : null);

export interface Cabin {
  scene: THREE.Group;
  spec: CabinSpec;
  /** Turns with the steering wheel, about its own z axis. Null when the wheel is part of the dashboard. */
  spin: THREE.Object3D | null;
  wheelRadius: number;
  paint: THREE.Mesh[];
  paint2: THREE.Mesh[];
  accent: THREE.Mesh[];
  glass: THREE.Mesh[];
  mirrors: THREE.Mesh[];
  /** True once the mirror glass has been mapped to take the rear-view picture. */
  mirrorsMapped: boolean;
  panel: THREE.MeshStandardMaterial | null;
  /** Set while a car is using this cabin: hands it back (hands off the wheel, mirrors and panel restored). */
  release: (() => void) | null;
  /** The windscreen as seen from the front: its lower edge, its sides, and how far forward it starts. */
  screen: { low: number; left: number; right: number; from: number };
}

const cache = new Map<string, Cabin | "loading" | "failed">();
let version = 0;
/** Changes whenever a cabin finishes loading, so the car on screen can swap to it. */
export const cabinVersion = (): number => version;

/** Sunlight inside a car is mostly blocked by the roof: direct light is turned well down, sky light a little. */
export function shade(m: THREE.MeshStandardMaterial): void {
  m.envMapIntensity = 0.55;
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <lights_fragment_end>",
      "#include <lights_fragment_end>\nreflectedLight.directDiffuse *= 0.34; reflectedLight.directSpecular *= 0.34;",
    );
  };
  m.customProgramCacheKey = () => "cabin-shade";
}

/**
 * Lay the mirror glass out flat so it can show the rear-view picture: the interior mirror takes the
 * whole picture, each door mirror the half on its own side. The glass of all three is usually one
 * mesh, so vertices are sorted by where they are across the car.
 */
function mapMirrors(cabin: Cabin): void {
  cabin.scene.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  for (const mesh of cabin.mirrors) {
    const pos = mesh.geometry.getAttribute("position");
    const zone = (x: number): number => (x > 0.55 ? 0 : x < -0.55 ? 2 : 1);
    const lo = [new THREE.Vector2(1e9, 1e9), new THREE.Vector2(1e9, 1e9), new THREE.Vector2(1e9, 1e9)];
    const hi = [new THREE.Vector2(-1e9, -1e9), new THREE.Vector2(-1e9, -1e9), new THREE.Vector2(-1e9, -1e9)];
    const world: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      world.push(v.x, v.y);
      const z = zone(v.x);
      lo[z].min(new THREE.Vector2(v.x, v.y));
      hi[z].max(new THREE.Vector2(v.x, v.y));
    }
    const uv = new Float32Array(pos.count * 2);
    // Which slice of the picture each mirror shows: left door, interior, right door.
    const slice: [number, number][] = [[0, 0.42], [0, 1], [0.58, 1]];
    for (let i = 0; i < pos.count; i++) {
      const x = world[i * 2];
      const y = world[i * 2 + 1];
      const z = zone(x);
      const w = Math.max(1e-4, hi[z].x - lo[z].x);
      const h = Math.max(1e-4, hi[z].y - lo[z].y);
      // The driver's left (+x) is the left of the picture.
      const across = (hi[z].x - x) / w;
      uv[i * 2] = slice[z][0] + across * (slice[z][1] - slice[z][0]);
      uv[i * 2 + 1] = (y - lo[z].y) / h;
    }
    mesh.geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    cabin.mirrorsMapped = true;
  }
}

function prepare(key: string, gltf: { scene: THREE.Group }, spec: CabinSpec): Cabin {
  const cabin: Cabin = { scene: gltf.scene, spec, spin: gltf.scene.getObjectByName("steerSpin") ?? null, wheelRadius: 0.185, paint: [], paint2: [], accent: [], glass: [], mirrors: [], mirrorsMapped: false, panel: null, release: null, screen: { low: 0, left: 0.7, right: -0.7, from: spec.eye[2] + 0.3 } };
  const done = new Set<THREE.Material>();
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as THREE.MeshStandardMaterial;
    const name = m.name ?? "";
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    if (name === "paint") cabin.paint.push(mesh);
    else if (name === "paint2") cabin.paint2.push(mesh);
    else if (name === "glass") cabin.glass.push(mesh);
    else {
      if (name === "accent") cabin.accent.push(mesh);
      if (/mirror|espelho|retrovis|chrome_only/i.test(name)) cabin.mirrors.push(mesh);
      if (done.has(m)) return;
      done.add(m);
      const tone = spec.tones?.[name];
      if (tone) {
        if (tone.color) m.color.set(tone.color);
        if (tone.roughness !== undefined) m.roughness = tone.roughness;
        if (tone.metalness !== undefined) m.metalness = tone.metalness;
        if (tone.emissive) {
          m.emissive.set(tone.emissive);
          m.emissiveIntensity = tone.glow ?? 1;
          m.emissiveMap = null;
        }
      }
      if (name === "m_Dashboard") cabin.panel = m;
      shade(m);
    }
  });
  mapMirrors(cabin);
  let lowest = 1e9;
  let left = -1e9;
  let right = 1e9;
  // Glass remembers where each point sits in the cabin, so rain can bead on it and stay put as the car moves.
  for (const mesh of cabin.glass) {
    const pos = mesh.geometry.getAttribute("position");
    const at = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      at.set([v.x, v.y, v.z], i * 3);
    }
    mesh.geometry.setAttribute("cabinPos", new THREE.BufferAttribute(at, 3));
    // The windscreen is the glass ahead of the driver: note where it sits, for the wipers.
    for (let i = 0; i < pos.count; i++) {
      if (at[i * 3 + 2] < cabin.screen.from + 0.1) continue;
      lowest = Math.min(lowest, at[i * 3 + 1]);
      left = Math.max(left, at[i * 3]);
      right = Math.min(right, at[i * 3]);
    }
  }
  if (lowest < 1e8) cabin.screen = { low: lowest, left, right, from: cabin.screen.from };
  if (cabin.spin) {
    const box = new THREE.Box3().setFromObject(cabin.spin);
    const size = box.getSize(new THREE.Vector3());
    cabin.wheelRadius = Math.max(0.15, Math.min(0.21, Math.max(size.x, size.y) / 2));
  }
  console.info(`Cabin ${key}: ready`);
  return cabin;
}

/** The cabin for a car, if it has one and it has arrived. Asking starts the download. */
export function cabinFor(key: string | null): Cabin | null {
  if (!key || !CABINS[key]) return null;
  const have = cache.get(key);
  if (have && typeof have !== "string") return have;
  if (have) return null;
  cache.set(key, "loading");
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.loadAsync(`/world/models/cabin_${key}.glb`).then(
    (gltf) => {
      cache.set(key, prepare(key, gltf, CABINS[key]));
      version++;
    },
    (err) => {
      console.warn(`Cabin ${key} could not be loaded; using the built interior.`, err);
      cache.set(key, "failed");
    },
  );
  return null;
}
