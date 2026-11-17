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

const WATER_LEVEL = -7;

function buildAlpine(track: Track, quality: Quality): { root: THREE.Group; textures: THREE.Texture[] } {
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
    const peaks = Math.pow(Math.max(0, rim - 0.5) * 2, 1.7) * 210 * (0.75 + 0.25 * Math.sin(x * 0.02) * Math.cos(z * 0.017));
    const t0 = Math.max(0, Math.min(1, (d - (wall + 3)) / 75));
    const t = t0 * t0 * (3 - 2 * t0);
    info.d = d;
    info.near = t;
    return road * (1 - t) + (hills + peaks + track.hy[best] * 0.55 - 3) * t;
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
  const grass = new THREE.Color("#5f9e45");
  const grass2 = new THREE.Color("#7aa850");
  const dirt = new THREE.Color("#9a8562");
  const rock = new THREE.Color("#8a8d94");
  const snow = new THREE.Color("#f3f6fb");
  const sand = new THREE.Color("#d9c9a0");
  const c = new THREE.Color();
  for (let i = 0; i < fp.count; i += 3) {
    const y = (fp.getY(i) + fp.getY(i + 1) + fp.getY(i + 2)) / 3;
    const steep = 1 - fn.getY(i);
    const noise = Math.sin(fp.getX(i) * 0.9) * Math.cos(fp.getZ(i) * 0.7) * 0.5 + 0.5;
    if (y < WATER_LEVEL + 2.5) c.copy(sand);
    else if (steep > 0.28) c.copy(rock).multiplyScalar(0.85 + noise * 0.25);
    else if (y > 62 + noise * 14) c.copy(snow);
    else if (y > 40) c.copy(rock).lerp(snow, Math.min(1, (y - 40) / 30) * noise);
    else c.copy(grass).lerp(grass2, noise);
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
  }
  void dirt;
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
  const water = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: "#2f86c9", roughness: 0.08, metalness: 0.35, transparent: true, opacity: 0.86 }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(cx, WATER_LEVEL, cz);
  root.add(water);

  // --- Pines and boulders, instanced
  const m = new THREE.Matrix4();
  const treeGeo = mergeGeometries(
    [
      bake(new THREE.CylinderGeometry(0.5, 0.7, 3, 6), compose(0, 1.5, 0), "#6b4423"),
      bake(new THREE.ConeGeometry(3.4, 6, 7), compose(0, 5.2, 0), "#2f6b3a"),
      bake(new THREE.ConeGeometry(2.6, 5, 7), compose(0, 8.4, 0), "#3a7d44"),
      bake(new THREE.ConeGeometry(1.7, 4, 7), compose(0, 11.2, 0), "#48914f"),
    ],
    false,
  )!;
  const treeCount = quality === "low" ? 700 : 1700;
  const trees = new THREE.InstancedMesh(treeGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), treeCount);
  let placed = 0;
  for (let tries = 0; tries < treeCount * 6 && placed < treeCount; tries++) {
    const x = x0 + r() * W;
    const z = z0 + r() * D;
    const y = heightAt(x, z);
    if (info.d < wall + 7 || y < WATER_LEVEL + 1.5 || y > 58) continue;
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
  const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: "#8d9097", roughness: 0.95, flatShading: true }), rockCount);
  placed = 0;
  for (let tries = 0; tries < rockCount * 5 && placed < rockCount; tries++) {
    const x = x0 + r() * W;
    const z = z0 + r() * D;
    const y = heightAt(x, z);
    if (info.d < wall + 5 || y < WATER_LEVEL) continue;
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
  const top = new THREE.Color("#3f8ff0");
  const horizon = new THREE.Color("#d5ecff");
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
  root.add(sun);

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
  root.add(clouds);

  return { root, textures };
}

export function AlpineTheme({ track, quality }: { track: Track; quality: Quality }) {
  const built = useMemo(() => buildAlpine(track, quality), [track, quality]);
  useEffect(
    () => () => {
      disposeTree(built.root);
      for (const t of built.textures) t.dispose();
    },
    [built],
  );
  return (
    <>
      <color attach="background" args={["#cfe6fb"]} />
      <fog attach="fog" args={["#d3e8fb", 320, 1500]} />
      <hemisphereLight args={["#d6ebff", "#6f8552", 0.85]} />
      <primitive object={built.root} />
    </>
  );
}
