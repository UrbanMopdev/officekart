/**
 * Loading and caching for the photo-scanned world assets in /public/world:
 * skies, ground textures, rocks, trees and trackside props (Poly Haven, CC0).
 * Everything is fetched once and shared between tracks.
 */
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";

const BASE = "/world/";
const textures = new Map<string, THREE.Texture>();
const models = new Map<string, Promise<GLTF>>();
const skies = new Map<string, Promise<THREE.DataTexture>>();
let gltf: GLTFLoader | null = null;

/**
 * A tiling texture. Returned at once and filled in when the file arrives, so
 * materials can be built synchronously; three re-uploads when it loads.
 */
export function worldTexture(file: string, colour: boolean, anisotropy = 8, flipY = true): THREE.Texture {
  const key = `${file}:${colour}:${flipY}`;
  let t = textures.get(key);
  if (!t) {
    t = new THREE.TextureLoader().load(BASE + file);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = anisotropy;
    // Textures made for a glTF model are stored the other way up.
    t.flipY = flipY;
    textures.set(key, t);
  }
  return t;
}

export function worldModel(file: string): Promise<GLTF> {
  let p = models.get(file);
  if (!p) {
    gltf ??= new GLTFLoader();
    p = gltf.loadAsync(BASE + file);
    p.catch(() => models.delete(file));
    models.set(file, p);
  }
  return p;
}

/** A small HDR panorama used to light the scene. */
export function worldSky(name: string): Promise<THREE.DataTexture> {
  let p = skies.get(name);
  if (!p) {
    p = new HDRLoader().loadAsync(`${BASE}sky/${name}.hdr`).then((t) => {
      t.mapping = THREE.EquirectangularReflectionMapping;
      return t;
    });
    p.catch(() => skies.delete(name));
    skies.set(name, p);
  }
  return p;
}

/** The same sky as a sharp picture for the background. Stored at a quarter brightness to keep its highlights. */
export function worldBackdrop(name: string): THREE.Texture {
  const key = `sky:${name}`;
  let t = textures.get(key);
  if (!t) {
    t = new THREE.TextureLoader().load(`${BASE}sky/${name}.jpg`);
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.colorSpace = THREE.SRGBColorSpace;
    textures.set(key, t);
  }
  return t;
}

/** The geometry of a single-mesh model and the two textures that go with it. */
export async function scannedModel(name: string): Promise<{ geometry: THREE.BufferGeometry; map: THREE.Texture; normalMap: THREE.Texture }> {
  const model = await worldModel(`models/${name}.glb`);
  const part = modelParts(model)[0];
  return { geometry: part.geometry, map: worldTexture(`models/${name}_d.jpg`, true, 8, false), normalMap: worldTexture(`models/${name}_n.jpg`, false, 8, false) };
}

/** One part of a model, flattened: geometry in the model's own space plus its material. */
export interface ModelPart {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  name: string;
}

/** Take a loaded model apart into world-space geometry per material. */
export function modelParts(model: GLTF): ModelPart[] {
  const parts: ModelPart[] = [];
  model.scene.updateMatrixWorld(true);
  model.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.geometry;
    // Quantised attributes are expanded to floats so instances can be scaled freely.
    const g = new THREE.BufferGeometry();
    for (const name of ["position", "normal", "uv"]) {
      const a = src.getAttribute(name) as THREE.BufferAttribute | undefined;
      if (!a) continue;
      const out = new Float32Array(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c);
      g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
    }
    if (src.index) g.setIndex(Array.from(src.index.array));
    g.applyMatrix4(mesh.matrixWorld);
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    const material = mesh.material as THREE.MeshStandardMaterial;
    parts.push({ geometry: g, material, name: material.name || mesh.name });
  });
  return parts;
}
