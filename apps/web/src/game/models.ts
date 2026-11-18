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
      state = drivers.length === DRIVER_FILES.length ? "ready" : "failed";
      console.info(`Vehicle models: ${state} (${vehicles.size} vehicles, ${drivers.filter(Boolean).length} drivers)`);
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
