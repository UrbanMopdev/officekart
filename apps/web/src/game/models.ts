/**
 * Artist-made vehicle and driver models (Kenney's Car Kit and Racing Starter
 * Kit, both CC0; licence files sit next to the models in /public/models).
 *
 * Each vehicle file is taken apart once: bodywork, wheels (so they can spin
 * and steer) and, for the karts, the driver. Karts on screen then share those
 * geometries. The bodywork's main paint colour is found so it can be swapped
 * for each player's colour.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface KitWheel {
  geo: THREE.BufferGeometry;
  pos: THREE.Vector3;
  front: boolean;
  radius: number;
}

export interface KitVehicle {
  body: THREE.BufferGeometry;
  wheels: KitWheel[];
  /** The swatch that is replaced by the player's colour. */
  paint: Paint;
  material: THREE.MeshStandardMaterial;
  scale: number;
  /** Where a driver sits: x, y, z and size, in the model's own units. Null for closed cabs. */
  seat: [number, number, number, number] | null;
  /** Rear of the vehicle in game units, for exhaust flames. */
  tail: [number, number];
  labelY: number;
  /** Set for the realistic car: bodywork split by finish, with its own materials. */
  car?: CarKit;
  /** The motorbike: built around the car's wheels, with a rider in leathers. */
  bike?: boolean;
}

export type Finish = "paint1" | "paint2" | "glass" | "trim" | "head" | "tail" | "chrome" | "wheel_metal" | "wheel_dark" | "wheel_tire" | "leather" | "trimc";

/** How one version of the car is finished. */
export interface CarTrim {
  scale: number;
  /** Main paint: metallic flake under a clear coat, or matte. */
  metalness: number;
  roughness: number;
  clearcoat: number;
  /** The roof, sills and splitter: bare carbon, or the player's colour lightened. */
  second: "carbon" | "light";
  wing: boolean;
  /** Ride height offset in model units. */
  ride: number;
}

export interface CarKit {
  body: { geo: THREE.BufferGeometry; finish: Finish }[];
  wheel: { geo: THREE.BufferGeometry; finish: Finish }[];
  /** Wheel centres in model units: x, y, z. */
  wheels: { pos: THREE.Vector3; front: boolean; left: boolean }[];
  wheelRadius: number;
  /** How much the shared wheel model is scaled to fit this car: across, and in diameter. */
  wheelFit: [number, number];
  /** Shift along the car that centres the wheelbase on the kart. */
  offsetZ: number;
  /** Top of the bodywork and half its length, in model units. */
  top: number;
  rear: number;
  /** Nose position and half width; set for cars that need lamps added (their own are plain plastic). */
  lamps: { front: number; half: number } | null;
  trim: CarTrim;
}

/** Order matches VEHICLES: which model each vehicle uses. The motorbike (1) is built in code. */
const VEHICLE_CAR: (string | null)[] = ["concept", null, "concept", "fortuner", "concept", "corolla", "hondae", "prius"];
/** Everyday cars keep their factory trim: a plain glossy respray in the player's colour. */
const STOCK: CarTrim = { scale: 0.86, metalness: 0.45, roughness: 0.3, clearcoat: 1, second: "carbon", wing: false, ride: 0 };

/** Order matches VEHICLES; the motorbike (1) has no car trim. */
const CAR_TRIMS: (CarTrim | null)[] = [
  { scale: 0.88, metalness: 0.55, roughness: 0.28, clearcoat: 1, second: "carbon", wing: false, ride: 0 },
  null,
  { scale: 0.92, metalness: 0.75, roughness: 0.22, clearcoat: 1, second: "carbon", wing: true, ride: -0.025 },
  { scale: 1.0, metalness: 0.1, roughness: 0.62, clearcoat: 0, second: "carbon", wing: false, ride: 0.05 },
  { scale: 0.86, metalness: 0.4, roughness: 0.3, clearcoat: 1, second: "light", wing: true, ride: -0.01 },
];

const cars = new Map<string, Omit<CarKit, "trim">>();
let carsLoaded = 0;
/** Changes whenever another car model arrives, so karts on screen can swap to it. */
export const kitVersion = (): number => carsLoaded;
const finishes = new Map<Finish, THREE.Material>();

/** Materials every car shares. Paint is per car and made by the kart itself. */
export function carFinish(finish: Finish): THREE.Material {
  let m = finishes.get(finish);
  if (!m) {
    switch (finish) {
      case "glass":
        m = new THREE.MeshPhysicalMaterial({ color: "#06090d", metalness: 0.9, roughness: 0.06, envMapIntensity: 1.6 });
        break;
      case "head":
        m = new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 6.8, 6), toneMapped: false });
        break;
      case "tail":
        m = new THREE.MeshBasicMaterial({ color: new THREE.Color(4.5, 0.25, 0.15), toneMapped: false });
        break;
      case "chrome":
        m = new THREE.MeshStandardMaterial({ color: "#f0f2f4", metalness: 1, roughness: 0.04 });
        break;
      case "wheel_metal":
        m = new THREE.MeshStandardMaterial({ color: "#b9bec6", metalness: 1, roughness: 0.22 });
        break;
      case "wheel_dark":
        m = new THREE.MeshStandardMaterial({ color: "#16171a", metalness: 0.7, roughness: 0.4 });
        break;
      case "wheel_tire":
        m = new THREE.MeshStandardMaterial({ color: "#0c0c0d", metalness: 0, roughness: 0.88 });
        break;
      case "paint2":
        m = new THREE.MeshPhysicalMaterial({ color: "#0d0e11", metalness: 0.85, roughness: 0.34, clearcoat: 0.7, clearcoatRoughness: 0.12 });
        break;
      case "leather":
        m = new THREE.MeshStandardMaterial({ color: "#15161a", metalness: 0, roughness: 0.5 });
        break;
      case "trimc":
        m = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.25, roughness: 0.5 });
        break;
      default:
        m = new THREE.MeshStandardMaterial({ color: "#0b0b0d", metalness: 0.3, roughness: 0.62 });
    }
    finishes.set(finish, m);
  }
  return m;
}

export interface KitDriver {
  geo: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  /** The helmet's swatch, repainted in the player's colour so you can tell karts apart from behind. */
  paint: Paint;
}

/** Order matches AVATARS in the shared package. */
export const DRIVER_FILES = ["kart-oobi", "kart-oodi", "kart-ooli", "kart-oopi", "kart-oozi"];

/** Order matches VEHICLES. The go-kart uses the chosen driver's own kart. */
const VEHICLE_FILES: { dir: string; file: string | null; scale: number; seat: KitVehicle["seat"]; tail: [number, number]; labelY: number }[] = [
  { dir: "car", file: null, scale: 2.15, seat: [0, 0.28, -0.07, 1], tail: [0.5, -1.35], labelY: 3.1 },
  { dir: "racing", file: "vehicle-motorcycle", scale: 1.75, seat: [0, 0.5, -0.28, 0.95], tail: [0.55, -1.6], labelY: 3.3 },
  { dir: "car", file: "race", scale: 1.55, seat: [0, 0.2, -0.22, 0.82], tail: [0.55, -2.05], labelY: 2.6 },
  { dir: "car", file: "tractor-shovel", scale: 1.45, seat: null, tail: [0.7, -1.85], labelY: 3.7 },
  { dir: "car", file: "hatchback-sports", scale: 1.42, seat: null, tail: [0.55, -2.1], labelY: 2.9 },
];

const vehicles = new Map<string, KitVehicle>();
const drivers: KitDriver[] = [];
let state: "idle" | "loading" | "ready" | "failed" = "idle";

export const kitReady = (): boolean => state === "ready";

export function kitVehicle(vehicle: number, avatar: number): KitVehicle | null {
  const fallback = vehicles.get("kart:0");
  const concept = cars.get("concept");
  if (fallback && concept && vehicle === 1) return { ...fallback, wheels: [], scale: 1.12, seat: null, tail: [0.14, -1.05], labelY: 3.1, car: { ...concept, trim: CAR_TRIMS[0]! }, bike: true };
  const which = VEHICLE_CAR[vehicle];
  // Until a car's own model has arrived it is shown as the concept car.
  const base = which ? (cars.get(which) ?? concept) : undefined;
  if (fallback && base) {
    const trim = base === concept ? (CAR_TRIMS[vehicle] ?? CAR_TRIMS[0]!) : STOCK;
    return { ...fallback, wheels: [], scale: trim.scale, seat: null, tail: [0.5 * trim.scale, -base.rear * trim.scale], labelY: base.top * trim.scale + 1.5, car: { ...base, trim } };
  }
  const key = vehicle === 0 ? `kart:${avatar % DRIVER_FILES.length}` : `v:${vehicle}`;
  return vehicles.get(key) ?? null;
}
export const kitDriver = (avatar: number): KitDriver | null => drivers[avatar % DRIVER_FILES.length] ?? null;

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Small local merge: every Kenney mesh has position, normal and uv, and an index.
  let verts = 0;
  for (const g of parts) verts += g.index ? g.index.count : g.getAttribute("position").count;
  const pos = new Float32Array(verts * 3);
  const nor = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  let o = 0;
  for (const g of parts) {
    const flat = g.index ? g.toNonIndexed() : g;
    const p = flat.getAttribute("position");
    const n = flat.getAttribute("normal");
    const t = flat.getAttribute("uv");
    for (let i = 0; i < p.count; i++, o++) {
      pos.set([p.getX(i), p.getY(i), p.getZ(i)], o * 3);
      if (n) nor.set([n.getX(i), n.getY(i), n.getZ(i)], o * 3);
      if (t) uv.set([t.getX(i), t.getY(i)], o * 2);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return out;
}

/** A swatch of the shared colour texture: its rectangle in UV space and its plain colour (linear). */
export interface Paint {
  cell: THREE.Vector4;
  base: THREE.Color;
}

/**
 * Kenney's models are coloured from one small texture laid out as a grid of swatches, 8 across and 4
 * down, each a plain colour beside a shaded version of it. The swatch covering the most surface,
 * leaving out black and plain grey, is the paint: that is what gets replaced by the player's colour.
 */
function findPaint(body: THREE.BufferGeometry, material: THREE.MeshStandardMaterial): Paint {
  const none: Paint = { cell: new THREE.Vector4(2, 2, 3, 3), base: new THREE.Color(1, 1, 1) };
  const image = material.map?.image as CanvasImageSource | undefined;
  if (!image) return none;
  const c = document.createElement("canvas");
  const w = (c.width = (image as HTMLImageElement).width || 512);
  const h = (c.height = (image as HTMLImageElement).height || 512);
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(image, 0, 0);
  const px = g.getImageData(0, 0, w, h).data;
  const pos = body.getAttribute("position");
  const uv = body.getAttribute("uv");
  const flip = material.map!.flipY;
  /** Plain colour of swatch (col, row), sampled a little inside its left half. */
  const swatch = (col: number, row: number): [number, number, number] => {
    const x = Math.floor(((col + 0.2) / 8) * w);
    const vy = (row + 0.5) / 4;
    const y = Math.floor((flip ? 1 - vy : vy) * h);
    const k = (y * w + x) * 4;
    return [px[k], px[k + 1], px[k + 2]];
  };
  const area = new Map<number, number>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1).sub(a);
    d.fromBufferAttribute(pos, i + 2).sub(a);
    const u = (uv.getX(i) + uv.getX(i + 1) + uv.getX(i + 2)) / 3;
    const v = (uv.getY(i) + uv.getY(i + 1) + uv.getY(i + 2)) / 3;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
    const key = Math.floor(v * 4) * 8 + Math.floor(u * 8);
    area.set(key, (area.get(key) ?? 0) + b.cross(d).length());
  }
  let best = -1;
  let most = 0;
  for (const [key, size] of area) {
    const [r, gg, bl] = swatch(key % 8, Math.floor(key / 8));
    const max = Math.max(r, gg, bl);
    const min = Math.min(r, gg, bl);
    if (max < 90 || (max < 215 && (max - min) / max < 0.16)) continue; // tyres, shadow and grey metal are not paint
    if (size > most) [best, most] = [key, size];
  }
  if (best < 0) return none;
  const col = best % 8;
  const row = Math.floor(best / 8);
  const [r, gg, bl] = swatch(col, row);
  return { cell: new THREE.Vector4(col / 8, row / 4, (col + 1) / 8, (row + 1) / 4), base: new THREE.Color().setRGB(r / 255, gg / 255, bl / 255, THREE.SRGBColorSpace) };
}

async function loadFile(loader: GLTFLoader, dir: string, file: string): Promise<{ body: THREE.BufferGeometry; wheels: KitWheel[]; driver: THREE.BufferGeometry | null; driverAt: THREE.Vector3; material: THREE.MeshStandardMaterial }> {
  const gltf = await loader.loadAsync(`/models/${dir}/${file}.glb`);
  gltf.scene.updateMatrixWorld(true);
  const body: THREE.BufferGeometry[] = [];
  const wheels: KitWheel[] = [];
  let driver: THREE.BufferGeometry | null = null;
  const driverAt = new THREE.Vector3();
  let material: THREE.MeshStandardMaterial | null = null;
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    material ??= m.material as THREE.MeshStandardMaterial;
    if (o.name.startsWith("wheel")) {
      m.geometry.computeBoundingBox();
      const box = m.geometry.boundingBox!;
      const pos = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
      wheels.push({ geo: m.geometry, pos, front: /front/.test(o.name), radius: Math.max(0.05, (box.max.y - box.min.y) / 2) });
    } else if (o.name === "character") {
      driver = m.geometry;
      driverAt.setFromMatrixPosition(o.matrixWorld);
    } else {
      body.push(m.geometry.clone().applyMatrix4(o.matrixWorld));
    }
  });
  if (!material || body.length === 0) throw new Error(`models: ${file} has no bodywork`);
  return { body: merge(body), wheels, driver, driverAt, material };
}

/**
 * A car rebuilt as a light game model by tools outside the repo: bodywork grouped by finish, plus
 * where its wheels go. The concept car brings its own wheel; the others borrow it, scaled to fit.
 */
async function loadCar(loader: GLTFLoader, file: string, concept: Omit<CarKit, "trim"> | null): Promise<Omit<CarKit, "trim">> {
  const gltf = await loader.loadAsync(`/world/models/${file}.glb`);
  const body: CarKit["body"] = [];
  const wheel: CarKit["wheel"] = [];
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const name = (o.name || o.parent?.name || "") as Finish;
    if (name.startsWith("wheel")) wheel.push({ geo: m.geometry, finish: name });
    else body.push({ geo: m.geometry, finish: m.geometry.getAttribute("color") ? "trimc" : name });
  });
  const extras = (gltf.asset as { extras?: { wheels?: Record<string, { c: number[]; size?: number[] }>; wheelRadius?: number; wheelWidth?: number; body?: { min: number[]; max: number[] } } }).extras;
  const w = extras?.wheels;
  if (!w || body.length === 0 || (!concept && wheel.length === 0)) throw new Error(`${file}.glb is missing parts`);
  const wheels = Object.entries(w).map(([name, v]) => ({ pos: new THREE.Vector3(v.c[0], v.c[1], v.c[2]), front: name.startsWith("F") || name.includes("Front"), left: v.c[0] > 0 }));
  const top = extras?.body?.max[1] ?? 1.2;
  const rear = Math.abs(extras?.body?.min[2] ?? 2);
  if (!concept) return { body, wheel, wheels, wheelRadius: w.WheelRearL.size![1] / 2, wheelFit: [1, 1], offsetZ: -0.09, top, rear, lamps: null };
  const radius = extras?.wheelRadius ?? 0.33;
  return { body, wheel: concept.wheel, wheels, wheelRadius: radius, wheelFit: [Math.min(1.05, (extras?.wheelWidth ?? 0.25) / 0.284), radius / concept.wheelRadius], offsetZ: 0, top, rear, lamps: { front: extras?.body?.max[2] ?? 2, half: extras?.body?.max[0] ?? 0.9 } };
}

/** Start loading. Safe to call more than once; the game draws its built-in karts until this finishes (or if it fails). */
export function loadKit(): void {
  if (state !== "idle") return;
  state = "loading";
  const loader = new GLTFLoader();
  void (async () => {
    try {
      const karts = await Promise.all(DRIVER_FILES.map((f) => loadFile(loader, "car", f)));
      karts.forEach((k, i) => {
        const cfg = VEHICLE_FILES[0];
        k.material.roughness = 0.55;
        k.material.metalness = 0.05;
        vehicles.set(`kart:${i}`, { body: k.body, wheels: k.wheels, paint: findPaint(k.body, k.material), material: k.material, scale: cfg.scale, seat: [k.driverAt.x, k.driverAt.y, k.driverAt.z, 1], tail: cfg.tail, labelY: cfg.labelY });
        if (k.driver) {
          const geo = (k.driver as THREE.BufferGeometry).index ? (k.driver as THREE.BufferGeometry).toNonIndexed() : k.driver;
          drivers[i] = { geo: k.driver, material: k.material, paint: findPaint(geo, k.material) };
        }
      });
      await Promise.all(
        VEHICLE_FILES.map(async (cfg, v) => {
          if (!cfg.file) return;
          const m = await loadFile(loader, cfg.dir, cfg.file);
          m.material.roughness = 0.55;
          m.material.metalness = 0.05;
          vehicles.set(`v:${v}`, { body: m.body, wheels: m.wheels, paint: findPaint(m.body, m.material), material: m.material, scale: cfg.scale, seat: cfg.seat, tail: cfg.tail, labelY: cfg.labelY });
        }),
      );
      try {
        cars.set("concept", await loadCar(loader, "car", null));
        carsLoaded++;
      } catch (err) {
        console.warn("The car model could not be loaded; using the kit vehicles.", err);
      }
      state = drivers.length === DRIVER_FILES.length ? "ready" : "failed";
      console.info(`Vehicle models: ${state} (${vehicles.size} vehicles, ${drivers.filter(Boolean).length} drivers)`);
      // Everyday cars follow in the background; each appears as soon as it is in.
      const concept = cars.get("concept");
      for (const name of new Set(VEHICLE_CAR)) {
        if (!name || name === "concept" || !concept) continue;
        try {
          cars.set(name, await loadCar(loader, `car_${name}`, concept));
          carsLoaded++;
        } catch (err) {
          console.warn(`Car model ${name} could not be loaded.`, err);
        }
      }
      console.info(`Car models: ${cars.size}`);
    } catch (err) {
      console.warn("Vehicle models could not be loaded; using the built-in karts.", err);
      state = "failed";
    }
  })();
}

/**
 * A copy of a kit material that shows one swatch in the player's colour, keeping the swatch's own
 * shading. The returned `tint` can be changed at any time.
 */
export function tintedMaterial(base: THREE.MeshStandardMaterial, paint: Paint): { material: THREE.MeshStandardMaterial; tint: THREE.Color } {
  const material = base.clone();
  const tint = new THREE.Color(1, 1, 1);
  const uniforms = { uCell: { value: paint.cell }, uBase: { value: paint.base }, uTint: { value: tint } };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec4 uCell;\nuniform vec3 uBase;\nuniform vec3 uTint;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        #ifdef USE_MAP
        if (vMapUv.x > uCell.x && vMapUv.x < uCell.z && vMapUv.y > uCell.y && vMapUv.y < uCell.w) {
          const vec3 kLuma = vec3(0.2126, 0.7152, 0.0722);
          float shade = clamp(dot(diffuseColor.rgb, kLuma) / max(0.05, dot(uBase, kLuma)), 0.35, 1.25);
          diffuseColor.rgb = uTint * shade;
        }
        #endif`,
      );
  };
  material.customProgramCacheKey = () => "kit-tint-2";
  return { material, tint };
}
