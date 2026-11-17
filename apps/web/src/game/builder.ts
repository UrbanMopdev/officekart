/**
 * Static scenery builder. Thousands of small primitives are baked into a
 * handful of merged, vertex-coloured meshes (one per material per map cell),
 * so detailed scenery costs a few dozen draw calls instead of thousands and
 * anything off screen is culled a whole cell at a time.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type Bucket = "matte" | "gloss" | "metal" | "glow";

export interface PartOptions {
  bucket?: Bucket;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  /** Brightness multiplier for the glow bucket (values above 1 bloom). */
  glow?: number;
}

const tmpColor = new THREE.Color();
const tmpEuler = new THREE.Euler();
const tmpQuat = new THREE.Quaternion();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const tmpMat = new THREE.Matrix4();

/** Clone a primitive, drop its UVs, bake a transform and a flat colour into it. */
export function bake(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, color: THREE.ColorRepresentation, intensity = 1): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.deleteAttribute("uv");
  g.applyMatrix4(matrix);
  tmpColor.set(color);
  const n = g.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = tmpColor.r * intensity;
    col[i * 3 + 1] = tmpColor.g * intensity;
    col[i * 3 + 2] = tmpColor.b * intensity;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

export function compose(x: number, y: number, z: number, o: PartOptions = {}, out = new THREE.Matrix4()): THREE.Matrix4 {
  tmpEuler.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, "YXZ");
  tmpQuat.setFromEuler(tmpEuler);
  tmpPos.set(x, y, z);
  tmpScale.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
  return out.compose(tmpPos, tmpQuat, tmpScale);
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

export const MATERIALS = {
  matte: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 }),
  gloss: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 0.05 }),
  metal: () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.95 }),
  glow: () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
};

export class Builder {
  private cells = new Map<string, THREE.BufferGeometry[]>();
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];

  constructor(private readonly cellSize = 110) {}

  /** Start a prop at a world position; parts added until pop() are relative to it. */
  push(x: number, y: number, z: number, ry = 0, scale = 1): this {
    const m = compose(x, y, z, { ry, sx: scale, sy: scale, sz: scale });
    this.stack.push(new THREE.Matrix4().multiplyMatrices(this.stack[this.stack.length - 1], m));
    return this;
  }

  pop(): this {
    if (this.stack.length > 1) this.stack.pop();
    return this;
  }

  add(geo: THREE.BufferGeometry, x: number, y: number, z: number, color: THREE.ColorRepresentation, o: PartOptions = {}): this {
    const top = this.stack[this.stack.length - 1];
    tmpMat.multiplyMatrices(top, compose(x, y, z, o));
    const bucket = o.bucket ?? "matte";
    const baked = bake(geo, tmpMat, color, bucket === "glow" ? (o.glow ?? 2) : 1);
    // Cell is chosen by the prop's origin so one prop never straddles cells.
    const cx = Math.floor(top.elements[12] / this.cellSize);
    const cz = Math.floor(top.elements[14] / this.cellSize);
    const key = `${bucket}|${cx}|${cz}`;
    let list = this.cells.get(key);
    if (!list) this.cells.set(key, (list = []));
    list.push(baked);
    return this;
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, o?: PartOptions): this {
    return this.add(cached("box", () => new THREE.BoxGeometry(1, 1, 1)), x, y, z, color, { ...o, sx: w * (o?.sx ?? 1), sy: h * (o?.sy ?? 1), sz: d * (o?.sz ?? 1) });
  }

  /** Box with bevelled edges, which is what makes surfaces catch the light. */
  rbox(w: number, h: number, d: number, r: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, o?: PartOptions): this {
    const key = `rbox|${w}|${h}|${d}|${r}`;
    return this.add(cached(key, () => new RoundedBoxGeometry(w, h, d, 2, r)), x, y, z, color, o);
  }

  cyl(rTop: number, rBottom: number, h: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, o?: PartOptions & { seg?: number }): this {
    const seg = o?.seg ?? 18;
    return this.add(cached(`cyl|${rTop}|${rBottom}|${h}|${seg}`, () => new THREE.CylinderGeometry(rTop, rBottom, h, seg)), x, y, z, color, o);
  }

  sphere(r: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, o?: PartOptions & { seg?: number }): this {
    const seg = o?.seg ?? 16;
    return this.add(cached(`sph|${r}|${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7)))), x, y, z, color, o);
  }

  ico(r: number, detail: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, o?: PartOptions): this {
    return this.add(cached(`ico|${r}|${detail}`, () => new THREE.IcosahedronGeometry(r, detail)), x, y, z, color, o);
  }

  cone(r: number, h: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, o?: PartOptions & { seg?: number }): this {
    const seg = o?.seg ?? 16;
    return this.add(cached(`cone|${r}|${h}|${seg}`, () => new THREE.ConeGeometry(r, h, seg)), x, y, z, color, o);
  }

  torus(R: number, r: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, o?: PartOptions & { arc?: number }): this {
    const arc = o?.arc ?? Math.PI * 2;
    return this.add(cached(`tor|${R}|${r}|${arc}`, () => new THREE.TorusGeometry(R, r, 10, 28, arc)), x, y, z, color, o);
  }

  /** Merge everything into meshes. The builder is empty afterwards. */
  build(shadows = true): THREE.Group {
    const group = new THREE.Group();
    const mats: Partial<Record<Bucket, THREE.Material>> = {};
    for (const [key, list] of this.cells) {
      const bucket = key.split("|")[0] as Bucket;
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mat = (mats[bucket] ??= MATERIALS[bucket]());
      const mesh = new THREE.Mesh(merged, mat);
      if (bucket !== "glow") {
        mesh.castShadow = shadows;
        mesh.receiveShadow = shadows;
      }
      group.add(mesh);
    }
    this.cells.clear();
    return group;
  }
}

/** Free every geometry and material under an object. */
export function disposeTree(root: THREE.Object3D): void {
  const mats = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => mats.add(x));
    else if (mat) mats.add(mat);
  });
  for (const m of mats) m.dispose();
}
