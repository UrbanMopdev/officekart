/**
 * Mountain environment for tracks with real elevation. The landscape is
 * generated from the circuit itself: the ground meets the road wherever it
 * goes, falls away into a ravine under gaps and off a cliff at open edges, and
 * rises into peaks further out. Scenery only; the road is the only thing karts touch.
 */
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Track } from "@office-kart/shared";
import type { Quality } from "../../store";
import { bake, compose, disposeTree } from "../builder";
import { glowTexture } from "../textures";
import { strip } from "../TrackSurface";
import { mulberry, trackBounds } from "./placement";

type TreeKind = "pine" | "snowpine" | "palm" | "dead" | "coral" | "crystal";

interface TerrainPalette {
  ground: [string, string];
  rock: string;
  high: string;
  /** Height above which the high colour (snow, ash) takes over. */
  highLine: number;
  shore: string;
  water: string;
  /** Glowing liquid (lava, energy) rather than water. */
  waterGlow: number;
  waterLevel: number;
  skyTop: string;
  skyHorizon: string;
  fog: string;
  hemi: [string, string, number];
  tree: TreeKind;
  trees: number;
  peaks: number;
  sun: boolean;
}

const TERRAIN: Record<string, TerrainPalette> = {
  alpine: { ground: ["#5f9e45", "#7aa850"], rock: "#8a8d94", high: "#f3f6fb", highLine: 62, shore: "#d9c9a0", water: "#2f86c9", waterGlow: 0, waterLevel: -7, skyTop: "#3f8ff0", skyHorizon: "#d5ecff", fog: "#d3e8fb", hemi: ["#d6ebff", "#6f8552", 0.85], tree: "pine", trees: 1700, peaks: 1, sun: true },
  volcano: { ground: ["#3b3130", "#4b3a34"], rock: "#262021", high: "#6a3324", highLine: 70, shore: "#7a2a12", water: "#ff5a1c", waterGlow: 2.6, waterLevel: -9, skyTop: "#1c0d18", skyHorizon: "#e8703a", fog: "#5a3028", hemi: ["#ffc7a3", "#5a2418", 1.15], tree: "dead", trees: 500, peaks: 1.35, sun: false },
  frozen: { ground: ["#eef4fb", "#dde8f4"], rock: "#9db0c6", high: "#ffffff", highLine: 30, shore: "#cfe6f5", water: "#bfe4f8", waterGlow: 0, waterLevel: -6, skyTop: "#5a9be0", skyHorizon: "#eaf4ff", fog: "#e3eefb", hemi: ["#eef6ff", "#9db4cc", 1], tree: "snowpine", trees: 1300, peaks: 1.15, sun: true },
  jungle: { ground: ["#2f8a3a", "#44a64c"], rock: "#6c705b", high: "#7f8468", highLine: 90, shore: "#b9a66c", water: "#2a9c8c", waterGlow: 0, waterLevel: -6, skyTop: "#3f93d8", skyHorizon: "#d8f0d0", fog: "#bfe0c4", hemi: ["#e6ffd8", "#3d5a2c", 0.85], tree: "palm", trees: 1900, peaks: 0.8, sun: true },
  sea: { ground: ["#e3d09b", "#d6c188"], rock: "#8f9488", high: "#b9c0b0", highLine: 80, shore: "#e9dcae", water: "#1e80d2", waterGlow: 0, waterLevel: 0, skyTop: "#2f8df0", skyHorizon: "#d9f1ff", fog: "#bfe3f7", hemi: ["#e0f3ff", "#7a8f86", 0.9], tree: "coral", trees: 1500, peaks: 0.55, sun: true },
  chaos: { ground: ["#5b3396", "#7d45c8"], rock: "#241a44", high: "#f0abfc", highLine: 48, shore: "#22d3ee", water: "#22d3ee", waterGlow: 1.6, waterLevel: -4, skyTop: "#0c0420", skyHorizon: "#c026d3", fog: "#2a1050", hemi: ["#d8b4fe", "#1a0b33", 0.8], tree: "crystal", trees: 900, peaks: 1.2, sun: false },
};

function treeGeometry(kind: TreeKind): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (kind === "pine" || kind === "snowpine") {
    const greens = kind === "pine" ? ["#2f6b3a", "#3a7d44", "#48914f"] : ["#dfeaf4", "#eef4fb", "#ffffff"];
    parts.push(bake(new THREE.CylinderGeometry(0.5, 0.7, 3, 6), compose(0, 1.5, 0), "#6b4423"));
    parts.push(bake(new THREE.ConeGeometry(3.4, 6, 7), compose(0, 5.2, 0), greens[0]));
    parts.push(bake(new THREE.ConeGeometry(2.6, 5, 7), compose(0, 8.4, 0), greens[1]));
    parts.push(bake(new THREE.ConeGeometry(1.7, 4, 7), compose(0, 11.2, 0), greens[2]));
  } else if (kind === "palm") {
    parts.push(bake(new THREE.CylinderGeometry(0.45, 0.7, 11, 6), compose(0.6, 5.5, 0, { rz: -0.1 }), "#7a5a34"));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      parts.push(bake(new THREE.ConeGeometry(1.5, 7.5, 4), compose(1.1 + Math.cos(a) * 3, 10.6, Math.sin(a) * 3, { ry: -a, rz: -1.15, sz: 0.35 }), i % 2 ? "#2f9a3e" : "#3fb34f"));
    }
  } else if (kind === "dead") {
    parts.push(bake(new THREE.CylinderGeometry(0.3, 0.7, 9, 5), compose(0, 4.5, 0), "#1c1616"));
    parts.push(bake(new THREE.CylinderGeometry(0.15, 0.3, 4.5, 4), compose(1.3, 7, 0, { rz: -0.9 }), "#1c1616"));
    parts.push(bake(new THREE.CylinderGeometry(0.12, 0.26, 3.8, 4), compose(-1.1, 5.6, 0.4, { rz: 1 }), "#1c1616"));
  } else if (kind === "coral") {
    const cols = ["#ff6b8b", "#ff9e4a", "#c084fc", "#fde047"];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      parts.push(bake(new THREE.CylinderGeometry(0.25, 0.6, 3 + (i % 3), 5), compose(Math.cos(a) * 1.1, 1.6 + (i % 3) * 0.5, Math.sin(a) * 1.1, { rz: Math.cos(a) * 0.5, rx: Math.sin(a) * 0.5 }), cols[i % 4]));
    }
    parts.push(bake(new THREE.SphereGeometry(1.3, 7, 5), compose(0, 0.7, 0, { sy: 0.6 }), "#fb7185"));
  } else {
    const cols = ["#67e8f9", "#f0abfc", "#a5b4fc"];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      parts.push(bake(new THREE.ConeGeometry(0.9 + (i % 2) * 0.5, 6 + i * 1.5, 5), compose(Math.cos(a) * 1.2, 3 + i * 0.7, Math.sin(a) * 1.2, { rz: Math.cos(a) * 0.35, rx: Math.sin(a) * 0.35 }), cols[i % 3], 1.6));
    }
  }
  return mergeGeometries(parts, false)!;
}

function buildTerrain(track: Track, quality: Quality, pal: TerrainPalette): { root: THREE.Group; textures: THREE.Texture[] } {
  const WATER_LEVEL = track.waterLevel > -Infinity ? track.waterLevel : Math.min(pal.waterLevel, track.minY - 5);
  const underwaterTrack = track.waterLevel > -Infinity;
  const r = mulberry(4242);
  const root = new THREE.Group();
  const textures: THREE.Texture[] = [];
  const wall = track.def.wallHalfWidth;
  const b = trackBounds(track);
  const pad = 300;
  const x0 = b.minX - pad;
  const z0 = b.minZ - pad;
  const W = b.maxX - b.minX + pad * 2;
  const D = b.maxZ - b.minZ + pad * 2;
  const cx = x0 + W / 2;
  const cz = z0 + D / 2;

  /** Ground height anywhere: the road's height near the road, hills and peaks away from it. */
  const info = { d: 0, near: 0 };
  const heightAt = (x: number, z: number): number => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < track.n; i += 2) {
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
    const rim = Math.hypot((x - cx) / (W * 0.5), (z - cz) / (D * 0.5));
    const hills = 9 * Math.sin(x * 0.011 + 1.3) * Math.cos(z * 0.013 - 0.4) + 5 * Math.sin(x * 0.029 + z * 0.021) + 2.5 * Math.sin(x * 0.07 - z * 0.05);
    const peaks = Math.pow(Math.max(0, rim - 0.5) * 2, 1.7) * 210 * pal.peaks * (0.75 + 0.25 * Math.sin(x * 0.02) * Math.cos(z * 0.017));
    const t0 = Math.max(0, Math.min(1, (d - (wall + 3)) / 75));
    const t = t0 * t0 * (3 - 2 * t0);
    info.d = d;
    info.near = t;
    return road * (1 - t) + (hills + peaks + track.hy[best] * 0.55 - 3 + (underwaterTrack ? 2 : 0)) * t;
  };

  // --- Terrain mesh, faceted, coloured by height and steepness
  const N = quality === "low" ? 110 : 170;
  const geo = new THREE.PlaneGeometry(W, D, N, N).rotateX(-Math.PI / 2).translate(cx, 0, cz);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const nearRoad = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
    nearRoad[i] = info.d;
  }
  const flat = geo.toNonIndexed();
  geo.dispose();
  flat.computeVertexNormals();
  const fp = flat.getAttribute("position");
  const fn = flat.getAttribute("normal");
  const col = new Float32Array(fp.count * 3);
  const grass = new THREE.Color(pal.ground[0]);
  const grass2 = new THREE.Color(pal.ground[1]);
  const rock = new THREE.Color(pal.rock);
  const snow = new THREE.Color(pal.high);
  const sand = new THREE.Color(pal.shore);
  const c = new THREE.Color();
  for (let i = 0; i < fp.count; i += 3) {
    const y = (fp.getY(i) + fp.getY(i + 1) + fp.getY(i + 2)) / 3;
    const steep = 1 - fn.getY(i);
    const noise = Math.sin(fp.getX(i) * 0.9) * Math.cos(fp.getZ(i) * 0.7) * 0.5 + 0.5;
    if (y < WATER_LEVEL + 2.5) c.copy(sand);
    else if (steep > 0.28) c.copy(rock).multiplyScalar(0.85 + noise * 0.25);
    else if (y > pal.highLine + noise * 14) c.copy(snow);
    else if (y > pal.highLine - 22) c.copy(rock).lerp(snow, Math.min(1, (y - pal.highLine + 22) / 30) * noise);
    else c.copy(grass).lerp(grass2, noise);
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
  }
  void nearRoad;
  flat.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const terrain = new THREE.Mesh(flat, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, flatShading: true }));
  terrain.receiveShadow = true;
  root.add(terrain);

  // --- Rock skirts under the road edges, so banked and raised sections look solid
  const stone = new THREE.Color("#6f6a66");
  const skirt = mergeGeometries([strip(track, wall + 1, 0, wall + 2.2, -9, { color: () => stone }), strip(track, -wall - 2.2, -9, -wall - 1, 0, { color: () => stone })], false)!;
  skirt.computeVertexNormals();
  const skirtMesh = new THREE.Mesh(skirt, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));
  skirtMesh.receiveShadow = true;
  root.add(skirtMesh);

  // --- Water
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(W, D),
    pal.waterGlow > 0
      ? new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.water).multiplyScalar(pal.waterGlow), toneMapped: false, side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({ color: pal.water, roughness: 0.08, metalness: 0.35, transparent: true, opacity: underwaterTrack ? 0.62 : 0.86, side: THREE.DoubleSide, depthWrite: !underwaterTrack }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(cx, WATER_LEVEL, cz);
  root.add(water);

  // --- Pines and boulders, instanced
  const m = new THREE.Matrix4();
  const treeGeo = treeGeometry(pal.tree);
  const treeCount = quality === "low" ? Math.round(pal.trees * 0.4) : pal.trees;
  const trees = new THREE.InstancedMesh(treeGeo, pal.tree === "crystal" ? new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), treeCount);
  let placed = 0;
  for (let tries = 0; tries < treeCount * 6 && placed < treeCount; tries++) {
    const x = x0 + r() * W;
    const z = z0 + r() * D;
    const y = heightAt(x, z);
    const wet = y < WATER_LEVEL + 1.5;
    // Coral grows under water; everything else on dry land.
    if (info.d < wall + 7 || y > 58 || (pal.tree === "coral" ? !wet : wet)) continue;
    // Keep trees off cliffs: compare with the ground a few metres away.
    if (Math.abs(heightAt(x + 4, z) - y) > 3.2 || Math.abs(heightAt(x, z + 4) - y) > 3.2) continue;
    const s = 0.8 + r() * 1.3;
    m.compose(new THREE.Vector3(x, y - 0.3, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28), new THREE.Vector3(s, s * (0.85 + r() * 0.4), s));
    trees.setMatrixAt(placed++, m);
  }
  trees.count = placed;
  trees.instanceMatrix.needsUpdate = true;
  trees.castShadow = true;
  trees.receiveShadow = true;
  trees.frustumCulled = false;
  root.add(trees);

  const rockCount = 260;
  const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: pal.rock, roughness: 0.95, flatShading: true }), rockCount);
  placed = 0;
  for (let tries = 0; tries < rockCount * 5 && placed < rockCount; tries++) {
    const x = x0 + r() * W;
    const z = z0 + r() * D;
    const y = heightAt(x, z);
    if (info.d < wall + 5 || (y < WATER_LEVEL && !underwaterTrack)) continue;
    const s = 1 + r() * 4.5;
    m.compose(new THREE.Vector3(x, y + s * 0.2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3)), new THREE.Vector3(s, s * (0.6 + r() * 0.5), s * (0.8 + r() * 0.6)));
    rocks.setMatrixAt(placed++, m);
  }
  rocks.count = placed;
  rocks.instanceMatrix.needsUpdate = true;
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  rocks.frustumCulled = false;
  root.add(rocks);

  // --- Sky dome, sun and clouds
  const skyGeo = new THREE.SphereGeometry(1500, 32, 18);
  const sp = skyGeo.getAttribute("position");
  const sc = new Float32Array(sp.count * 3);
  const top = new THREE.Color(pal.skyTop);
  const horizon = new THREE.Color(pal.skyHorizon);
  for (let i = 0; i < sp.count; i++) {
    const t = Math.max(0, Math.min(1, sp.getY(i) / 700));
    c.copy(horizon).lerp(top, Math.pow(t, 0.6));
    sc.set([c.r, c.g, c.b], i * 3);
  }
  skyGeo.setAttribute("color", new THREE.BufferAttribute(sc, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  root.add(sky);

  const glow = glowTexture();
  textures.push(glow);
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color(6, 5.4, 4), transparent: true, depthWrite: false, fog: false, toneMapped: false }));
  sun.position.set(cx + 0.52 * 1300, 0.72 * 1300, cz + 0.32 * 1300);
  sun.scale.set(260, 260, 1);
  if (pal.sun) root.add(sun);

  const cloudCount = 46;
  const clouds = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: "#ffffff", fog: false, transparent: true, opacity: 0.92 }), cloudCount * 4);
  let ci = 0;
  for (let k = 0; k < cloudCount; k++) {
    const x = cx + (r() - 0.5) * 2400;
    const z = cz + (r() - 0.5) * 2400;
    const y = 230 + r() * 160;
    for (let p = 0; p < 4; p++) {
      const s = 26 + r() * 34;
      m.compose(new THREE.Vector3(x + (p - 1.5) * 30 + r() * 12, y + r() * 8, z + r() * 26), new THREE.Quaternion(), new THREE.Vector3(s * 1.5, s * 0.5, s));
      clouds.setMatrixAt(ci++, m);
    }
  }
  clouds.instanceMatrix.needsUpdate = true;
  clouds.frustumCulled = false;
  if (pal.sun) root.add(clouds);

  return { root, textures };
}

export function TerrainTheme({ track, quality }: { track: Track; quality: Quality }) {
  const pal = TERRAIN[track.def.theme] ?? TERRAIN.alpine;
  const built = useMemo(() => buildTerrain(track, quality, pal), [track, quality, pal]);
  useEffect(
    () => () => {
      disposeTree(built.root);
      for (const t of built.textures) t.dispose();
    },
    [built],
  );
  return (
    <>
      <color attach="background" args={[pal.fog]} />
      <fog attach="fog" args={[pal.fog, 320, 1500]} />
      <hemisphereLight args={pal.hemi} />
      <primitive object={built.root} />
    </>
  );
}
