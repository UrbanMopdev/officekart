/**
 * Mountain environment for tracks with real elevation. The landscape is
 * generated from the circuit itself: the ground meets the road wherever it
 * goes, falls away into a ravine under gaps and off a cliff at open edges, and
 * rises into peaks further out. It is surfaced with photo-scanned ground and
 * rock, scattered with scanned boulders and planted with forest.
 * Scenery only; the road is the only thing karts touch.
 */
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Track } from "@office-kart/shared";
import type { Quality } from "../../store";
import { scannedModel } from "../assets";
import { disposeTree } from "../builder";
import { iceMaterial, lavaMaterial, snowCap, terrainMaterial, type TerrainLook } from "../materials";
import { strip } from "../TrackSurface";
import { mulberry, trackBounds } from "./placement";
import { barkMaterial, boughTexture, burntGeometry, coniferGeometry, foliageMaterial, type TreeKit } from "./trees";

interface TerrainPalette {
  look: TerrainLook;
  /** What fills the low ground. */
  liquid: "ice" | "lava" | "water";
  waterLevel: number;
  fog: string;
  fogRange: [number, number];
  trees: "conifer" | "burnt" | "none";
  treeCount: number;
  /** Trees stop growing above this height. */
  treeLine: number;
  foliageTint: string;
  barkTint: string;
  rockTint: string;
  /** 0..1: snow lying on rocks and branches. */
  snow: number;
  peaks: number;
  relief: number;
}

const ROCKY: TerrainLook = { ground: "ash", rock: "cliff", groundSize: 14, rockSize: 26, groundTint: "#c8c0a8", rockTint: "#ffffff", slope: [0.2, 0.42], groundRough: 0.96, rockRough: 0.9 };

const TERRAIN: Record<string, TerrainPalette> = {
  frozen: {
    look: { ground: "snow", rock: "cliff", groundSize: 11, rockSize: 30, groundTint: "#f4f7fb", rockTint: "#dde3ea", slope: [0.4, 0.66], groundRough: 0.82, rockRough: 0.9 },
    liquid: "ice",
    waterLevel: -6,
    fog: "#d3dde8",
    fogRange: [160, 1700],
    trees: "conifer",
    treeCount: 1500,
    treeLine: 46,
    foliageTint: "#c8d4cc",
    barkTint: "#8a8078",
    rockTint: "#f0f2f5",
    snow: 1,
    peaks: 1.15,
    relief: 1,
  },
  volcano: {
    look: { ground: "ash", rock: "basalt", groundSize: 13, rockSize: 24, groundTint: "#ece6e0", rockTint: "#e6e0dc", slope: [0.2, 0.42], groundRough: 0.97, rockRough: 0.82 },
    liquid: "lava",
    waterLevel: -9,
    fog: "#9a7a68",
    fogRange: [260, 2300],
    trees: "burnt",
    treeCount: 420,
    treeLine: 60,
    foliageTint: "#ffffff",
    barkTint: "#2a2422",
    rockTint: "#9a928e",
    snow: 0,
    peaks: 1.0,
    relief: 1.1,
  },
  forest: {
    look: { ground: "grass", rock: "cliff", groundSize: 9, rockSize: 26, groundTint: "#c9d1b4", rockTint: "#cfcabd", slope: [0.3, 0.52], groundRough: 0.93, rockRough: 0.9 },
    liquid: "water",
    waterLevel: -7,
    fog: "#c4d2de",
    fogRange: [200, 1800],
    trees: "conifer",
    treeCount: 1700,
    treeLine: 70,
    foliageTint: "#ffffff",
    barkTint: "#9a8a7a",
    rockTint: "#d8d2c8",
    snow: 0,
    peaks: 0.9,
    relief: 0.9,
  },
  night: {
    look: { ground: "grass", rock: "cliff", groundSize: 9, rockSize: 26, groundTint: "#aab4a2", rockTint: "#c4c8d0", slope: [0.3, 0.52], groundRough: 0.9, rockRough: 0.88 },
    liquid: "water",
    waterLevel: -7,
    fog: "#0d1320",
    fogRange: [120, 1500],
    trees: "conifer",
    treeCount: 1400,
    treeLine: 70,
    foliageTint: "#dfe6ee",
    barkTint: "#8a8078",
    rockTint: "#c8ccd4",
    snow: 0,
    peaks: 1.0,
    relief: 1.0,
  },
  alpine: { look: ROCKY, liquid: "water", waterLevel: -7, fog: "#cfe0ee", fogRange: [200, 1500], trees: "conifer", treeCount: 1500, treeLine: 55, foliageTint: "#ffffff", barkTint: "#8a7868", rockTint: "#b0aca6", snow: 0, peaks: 1, relief: 1 },
  jungle: { look: ROCKY, liquid: "water", waterLevel: -6, fog: "#bfe0c4", fogRange: [200, 1500], trees: "conifer", treeCount: 1700, treeLine: 80, foliageTint: "#ffffff", barkTint: "#8a7868", rockTint: "#9a9a8a", snow: 0, peaks: 0.8, relief: 1 },
  sea: { look: { ...ROCKY, groundTint: "#e6d7ae" }, liquid: "water", waterLevel: 0, fog: "#bfe3f7", fogRange: [200, 1500], trees: "none", treeCount: 0, treeLine: 0, foliageTint: "#ffffff", barkTint: "#8a7868", rockTint: "#b0aca6", snow: 0, peaks: 0.55, relief: 0.7 },
  chaos: { look: { ...ROCKY, groundTint: "#7a6aa8", rockTint: "#8a80b0" }, liquid: "lava", waterLevel: -4, fog: "#2a1050", fogRange: [150, 1300], trees: "burnt", treeCount: 400, treeLine: 60, foliageTint: "#ffffff", barkTint: "#2a2040", rockTint: "#5a5080", snow: 0, peaks: 1.2, relief: 1 },
};

// --- Smooth value noise, so hills roll rather than repeat
const hash = (ix: number, iz: number): number => {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (((h ^ (h >>> 16)) >>> 0) % 100000) / 100000;
};
function noise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
function fbm(x: number, z: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x, z);
    x = x * 2.03 + 17.1;
    z = z * 2.03 - 9.4;
    amp *= 0.5;
  }
  return sum;
}
const ridged = (x: number, z: number): number => 1 - Math.abs(fbm(x, z, 4) * 2 - 1);

interface Scatter {
  model: string;
  matrices: THREE.Matrix4[];
}

interface Built {
  root: THREE.Group;
  textures: THREE.Texture[];
  rocks: Scatter[];
  rockMaterial: (map: THREE.Texture, normalMap: THREE.Texture) => THREE.Material;
  tick: ((time: number) => void) | null;
}

function buildTerrain(track: Track, quality: Quality, pal: TerrainPalette): Built {
  const WATER_LEVEL = track.waterLevel > -Infinity ? track.waterLevel : Math.min(pal.waterLevel, track.minY - 5);
  const underwaterTrack = track.waterLevel > -Infinity;
  const r = mulberry(4242);
  const root = new THREE.Group();
  const textures: THREE.Texture[] = [];
  const wall = track.def.wallHalfWidth;
  const b = trackBounds(track);
  const pad = 320;
  const x0 = b.minX - pad;
  const z0 = b.minZ - pad;
  const W = b.maxX - b.minX + pad * 2;
  const D = b.maxZ - b.minZ + pad * 2;
  const cx = x0 + W / 2;
  const cz = z0 + D / 2;

  /** Ground height anywhere: the road's height near the road, hills and peaks away from it. */
  const info = { d: 0, idx: 0, lateral: 0 };
  const heightAt = (x: number, z: number): number => {
    let best = 0;
    let bestD = Infinity;
    // Coarse pass over every eighth sample, then refine around the winner.
    for (let i = 0; i < track.n; i += 8) {
      const dx = x - track.px[i];
      const dz = z - track.pz[i];
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const coarse = best;
    for (let o = -8; o <= 8; o++) {
      const i = (coarse + o + track.n) % track.n;
      const dx = x - track.px[i];
      const dz = z - track.pz[i];
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const d = Math.sqrt(bestD);
    const lateral = (x - track.px[best]) * track.nx[best] + (z - track.pz[best]) * track.nz[best];
    let road = track.hy[best] - 0.4;
    if (track.gap[best]) road = track.hy[best] - 34; // the ravine under a jump
    const o = track.open[best];
    if (o !== 0 && d > wall + 0.5 && ((lateral < 0 && (o & 1) !== 0) || (lateral > 0 && (o & 2) !== 0))) road -= Math.min(46, (d - wall) * 3.2);
    const hills = ((fbm(x * 0.0045, z * 0.0045, 4) - 0.47) * 70 + (fbm(x * 0.021 + 40, z * 0.021, 3) - 0.5) * 12) * pal.relief;
    // Mountains stand back from the circuit, so there is always sky above the road.
    const away = Math.max(0, Math.min(1, (d - 85) / 330));
    const peaks = Math.pow(away, 1.6) * 300 * pal.peaks * (0.3 + 1.15 * ridged(x * 0.0032 + 7, z * 0.0032));
    const t0 = Math.max(0, Math.min(1, (d - (wall + 3)) / 80));
    const t = t0 * t0 * (3 - 2 * t0);
    info.d = d;
    info.idx = best;
    info.lateral = lateral;
    return road * (1 - t) + (hills + peaks + track.hy[best] * 0.55 - 3 + (underwaterTrack ? 2 : 0)) * t;
  };

  // --- Terrain mesh: smooth, lit by its real slope, tinted in broad patches
  const N = quality === "low" ? 130 : quality === "medium" ? 190 : 250;
  const geo = new THREE.PlaneGeometry(W, D, N, N).rotateX(-Math.PI / 2).translate(cx, 0, cz);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);
    // Large soft patches of lighter and darker ground; darker and damper beside liquid.
    let k = 0.86 + fbm(x * 0.012 + 3, z * 0.012, 3) * 0.3;
    if (pal.liquid !== "ice" && y < WATER_LEVEL + 4) k *= 0.55 + 0.45 * Math.max(0, (y - WATER_LEVEL) / 4);
    col.set([k, k, k], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, terrainMaterial(pal.look));
  terrain.receiveShadow = true;
  root.add(terrain);

  // --- Rock under the road edges, so banked and raised sections look solid
  const white = new THREE.Color(1, 1, 1);
  const skirt = mergeGeometries([strip(track, wall + 1, 0, wall + 2.2, -9, { color: () => white }), strip(track, -wall - 2.2, -9, -wall - 1, 0, { color: () => white })], false)!;
  skirt.computeVertexNormals();
  const skirtMat = terrainMaterial({ ...pal.look, slope: [0, 0.01] });
  skirtMat.side = THREE.DoubleSide;
  const skirtMesh = new THREE.Mesh(skirt, skirtMat);
  skirtMesh.receiveShadow = true;
  root.add(skirtMesh);

  // --- Ice, lava or water in the low ground
  let tick: Built["tick"] = null;
  let liquidMat: THREE.Material;
  if (pal.liquid === "ice") liquidMat = iceMaterial();
  else if (pal.liquid === "lava") {
    const lava = lavaMaterial();
    liquidMat = lava.material;
    tick = lava.tick;
  } else liquidMat = new THREE.MeshStandardMaterial({ color: "#16506e", roughness: 0.06, metalness: 0.1, transparent: true, opacity: underwaterTrack ? 0.62 : 0.9, depthWrite: !underwaterTrack });
  liquidMat.side = THREE.DoubleSide;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(W, D), liquidMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(cx, WATER_LEVEL, cz);
  water.receiveShadow = pal.liquid !== "lava";
  root.add(water);

  // --- Forest. Trees stand in stands and thin out with height; a share of them line the road.
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();
  if (pal.trees !== "none") {
    const detail = quality === "low" ? 0.45 : quality === "medium" ? 0.75 : 1;
    const total = Math.round(pal.treeCount * (quality === "low" ? 0.4 : quality === "medium" ? 0.7 : 1));
    const variants = 3;
    const kits: TreeKit[] = [];
    for (let v = 0; v < variants; v++) kits.push(pal.trees === "conifer" ? coniferGeometry(11 + v * 7, detail) : burntGeometry(5 + v * 3));
    // Each variant is planted twice over: trees near the road cast shadows, the forest beyond does not.
    const spots: { x: number; y: number; z: number; s: number }[][] = [...kits, ...kits].map(() => []);
    const tryPlant = (x: number, z: number, crowd: number): boolean => {
      const y = heightAt(x, z);
      const d = info.d;
      if (d < wall + 6.5 || y > pal.treeLine || y < WATER_LEVEL + 1.2) return false;
      if (track.gap[info.idx] && d < wall + 30) return false;
      // Keep trees off cliffs: compare with the ground a few metres away.
      if (Math.abs(heightAt(x + 4, z) - y) > 3 || Math.abs(heightAt(x, z + 4) - y) > 3) return false;
      if (fbm(x * 0.011 + 90, z * 0.011, 3) < crowd) return false;
      const thin = Math.max(0, (y - pal.treeLine * 0.6) / (pal.treeLine * 0.4));
      if (r() < thin) return false;
      spots[Math.floor(r() * variants) + (d < wall + 75 ? 0 : variants)].push({ x, y, z, s: (0.7 + r() * r() * 1.0) * (1 - thin * 0.4) });
      return true;
    };
    let planted = 0;
    const lining = Math.round(total * 0.4);
    for (let tries = 0; tries < lining * 8 && planted < lining; tries++) {
      const i = Math.floor(r() * track.n);
      const lat = (r() < 0.5 ? -1 : 1) * (wall + 7 + r() * r() * 60);
      if (tryPlant(track.px[i] + track.nx[i] * lat, track.pz[i] + track.nz[i] * lat, 0.38)) planted++;
    }
    for (let tries = 0; tries < total * 10 && planted < total; tries++) {
      if (tryPlant(x0 + r() * W, z0 + r() * D, 0.47)) planted++;
    }
    const bough = pal.trees === "conifer" ? boughTexture(pal.snow) : null;
    if (bough) textures.push(bough);
    const foliage = bough ? foliageMaterial(bough, pal.foliageTint) : null;
    const bark = barkMaterial(pal.barkTint);
    spots.forEach((list, v) => {
      if (list.length === 0) return;
      const kit = kits[v % variants];
      const near = v < variants;
      const meshes: THREE.InstancedMesh[] = [new THREE.InstancedMesh(kit.wood, bark, list.length)];
      if (kit.foliage && foliage) meshes.push(new THREE.InstancedMesh(kit.foliage, foliage, list.length));
      list.forEach((sp, i) => {
        q.setFromAxisAngle(yAxis, r() * Math.PI * 2);
        m.compose(new THREE.Vector3(sp.x, sp.y - 0.35, sp.z), q, new THREE.Vector3(sp.s, sp.s * (0.9 + r() * 0.25), sp.s));
        const k = 0.72 + r() * 0.4;
        tint.setRGB(k, k * (0.96 + r() * 0.08), k * (0.92 + r() * 0.1));
        for (const mesh of meshes) {
          mesh.setMatrixAt(i, m);
          mesh.setColorAt(i, tint);
        }
      });
      for (const mesh of meshes) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.castShadow = near && quality !== "low";
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        root.add(mesh);
      }
    });
  }

  // --- Boulders and outcrops: positions are chosen now, the scanned models arrive a moment later
  const rocks: Scatter[] = [
    { model: "namaqualand_boulder_02", matrices: [] },
    { model: "rock_09", matrices: [] },
  ];
  const rockCount = quality === "low" ? 150 : 420;
  for (let tries = 0, placed = 0; tries < rockCount * 6 && placed < rockCount; tries++) {
    const near = r() < 0.45;
    let x: number;
    let z: number;
    if (near) {
      const i = Math.floor(r() * track.n);
      const lat = (r() < 0.5 ? -1 : 1) * (wall + 5 + r() * 45);
      x = track.px[i] + track.nx[i] * lat;
      z = track.pz[i] + track.nz[i] * lat;
    } else {
      x = x0 + r() * W;
      z = z0 + r() * D;
    }
    const y = heightAt(x, z);
    const kind = r() < 0.55 ? 0 : 1;
    // Size in metres across; big ones stand further back so none leans over the barrier.
    const size = 1.2 + r() * r() * (kind === 0 ? 9 : 6);
    if (info.d < wall + 4 + size * 0.9 || (y < WATER_LEVEL - 0.5 && !underwaterTrack)) continue;
    const native = kind === 0 ? 2.5 : 0.14;
    const s = size / native;
    q.setFromAxisAngle(yAxis, r() * Math.PI * 2);
    rocks[kind].matrices.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y - size * 0.08, z), q, new THREE.Vector3(s, s * (0.8 + r() * 0.5), s)));
    placed++;
  }
  const rockMaterial = (map: THREE.Texture, normalMap: THREE.Texture): THREE.Material => {
    const mat = new THREE.MeshStandardMaterial({ map, normalMap, color: pal.rockTint, roughness: 0.92 });
    return pal.snow > 0 ? snowCap(mat, pal.snow) : mat;
  };

  return { root, textures, rocks, rockMaterial, tick };
}

export function TerrainTheme({ track, quality }: { track: Track; quality: Quality }) {
  const pal = TERRAIN[track.def.theme] ?? TERRAIN.alpine;
  const built = useMemo(() => buildTerrain(track, quality, pal), [track, quality, pal]);
  useEffect(() => {
    let alive = true;
    for (const scatter of built.rocks) {
      if (scatter.matrices.length === 0) continue;
      void scannedModel(scatter.model)
        .then((model) => {
          if (!alive) return;
          const mesh = new THREE.InstancedMesh(model.geometry, built.rockMaterial(model.map, model.normalMap), scatter.matrices.length);
          scatter.matrices.forEach((mat, i) => mesh.setMatrixAt(i, mat));
          mesh.instanceMatrix.needsUpdate = true;
          mesh.castShadow = quality !== "low";
          mesh.receiveShadow = true;
          mesh.frustumCulled = false;
          built.root.add(mesh);
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
      // Shared scans and photo textures stay cached for the next race; only what this track built is freed.
      built.root.traverse((o) => {
        const mesh = o as THREE.InstancedMesh;
        if (mesh.isInstancedMesh) mesh.dispose();
      });
      disposeTree(built.root);
      for (const t of built.textures) t.dispose();
    };
  }, [built, quality]);
  useFrame(({ clock }) => built.tick?.(clock.elapsedTime));
  return (
    <>
      <fog attach="fog" args={[pal.fog, pal.fogRange[0], pal.fogRange[1]]} />
      <primitive object={built.root} />
    </>
  );
}
