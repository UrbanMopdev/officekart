/**
 * Everything that belongs to the circuit itself, in any environment: road,
 * kerbs, run-off, barriers with light strips, start gantry with countdown
 * lights, boost pads and corner warning boards.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { scannedModel } from "./assets";
import { glowTexture } from "./textures";
import { groundMaterial, kerbMaterial, roadMaterial, snowCap } from "./materials";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Track, TrackTheme } from "@office-kart/shared";
import { net } from "../net/connection";
import { useStore } from "../store";
import { Builder, disposeTree } from "./builder";
import { bannerTexture, boostTexture, checkerTexture, chevronBoardTexture, roadTexture, surfaceTexture, turfTexture, type RoadStyle } from "./textures";

interface Palette {
  road: RoadStyle;
  roadRoughness: number;
  roadMetalness: number;
  turf: [string, string];
  turfRoughness: number;
  kerb: [string, string];
  barrier: [string, string];
  led: string;
  ledGlow: number;
  pad: [string, string];
  board: [string, string];
  gantry: string;
  banner: [string, string, string];
}

/** Welded mesh for debris fencing: fine diagonal wires, see-through between them. */
function fenceTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = "rgba(196,202,210,0.85)";
  g.lineWidth = 1.6;
  for (let k = -256; k <= 512; k += 16) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + 256, 256);
    g.moveTo(k, 256);
    g.lineTo(k + 256, 0);
    g.stroke();
  }
  // Horizontal tension cables.
  g.lineWidth = 3;
  for (const y of [6, 128, 250]) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** A packed stand seen from the track: rows of heads and jackets over grey seats. */
function crowdTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#3b3f46";
  g.fillRect(0, 0, 1024, 256);
  const jackets = ["#b23a32", "#27496d", "#e0d9c8", "#2f6f4f", "#d98f2b", "#1d1f24", "#7a6a9a", "#c9ced6", "#4f7fae", "#8a3b5c"];
  const skin = ["#e2b594", "#c68e6a", "#8d5a3c", "#f0cdb0", "#6b4530"];
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rows = 16;
  for (let row = 0; row < rows; row++) {
    const y = (row + 0.5) * (256 / rows);
    g.fillStyle = "#2a2d33";
    g.fillRect(0, y + 5, 1024, 3);
    for (let x = 3; x < 1024; x += 7 + r() * 3) {
      if (r() < 0.14) continue; // empty seat
      g.fillStyle = jackets[Math.floor(r() * jackets.length)];
      g.fillRect(x - 2.6, y - 2, 5.2, 7);
      g.fillStyle = skin[Math.floor(r() * skin.length)];
      g.beginPath();
      g.arc(x, y - 4.5, 2.1, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Asphalt differs by place: sun-bleached, frost-pale, ash-dark. */
const ROAD_TINT: Record<string, string> = { frozen: "#e4e6ea", volcano: "#c4bcb8", neon: "#b9c0d2", office: "#d2d2d2", forest: "#dcdad6", night: "#c9ccd6" };

/** Themes with a photographic landscape get matching verges and scanned concrete barriers. */
const VERGE: Record<string, { texture: string; size: number; tint: string; roughness: number; snow?: number; barrierTint?: string; lamps?: boolean }> = {
  frozen: { texture: "snow", size: 7, tint: "#e9eef4", roughness: 0.8, snow: 1 },
  volcano: { texture: "ash", size: 9, tint: "#d6cec8", roughness: 0.97, barrierTint: "#cfc4be" },
  forest: { texture: "grass", size: 6, tint: "#c2cbaa", roughness: 0.95 },
  night: { texture: "grass", size: 6, tint: "#a9b3a0", roughness: 0.92, lamps: true },
};

/** Per-theme tweaks on top of the default outdoor palette. */
const TINTS: Record<string, Partial<Palette>> = {
  sky: {
    road: { base: "#2a2f3d", edge: "#f8fafc", centre: "#67e8f9", speckle: 0.6 },
    roadRoughness: 0.45,
    roadMetalness: 0.2,
    turf: ["#3b4660", "#343e56"],
    turfRoughness: 0.5,
    kerb: ["#0ea5e9", "#f8fafc"],
    barrier: ["#f8fafc", "#0ea5e9"],
    led: "#67e8f9",
    ledGlow: 2.4,
    gantry: "#0369a1",
    banner: ["#0369a1", "#f8fafc", "#67e8f9"],
  },
  volcano: { turf: ["#3a2a26", "#30221f"], kerb: ["#b3261e", "#e7e2dc"], barrier: ["#1c1917", "#f97316"], gantry: "#7c2d12", banner: ["#7c2d12", "#fed7aa", "#f97316"] },
  frozen: { turf: ["#e8f0f8", "#dbe6f2"], kerb: ["#b3261e", "#ecebe8"], barrier: ["#f8fafc", "#38bdf8"], gantry: "#0c4a6e", banner: ["#0c4a6e", "#f8fafc", "#7dd3fc"] },
  jungle: { turf: ["#6b5a36", "#5f4f2f"], kerb: ["#ca8a04", "#fef3c7"], barrier: ["#a8a29e", "#57534e"], gantry: "#3f6212", banner: ["#3f6212", "#fef9c3", "#facc15"] },
  sea: { turf: ["#dcc891", "#d0bb82"], kerb: ["#f97316", "#f8fafc"], barrier: ["#f8fafc", "#f97316"], gantry: "#0e7490", banner: ["#0e7490", "#f8fafc", "#fde047"] },
  chaos: { road: { base: "#1a1230", edge: "#f0abfc", centre: "#67e8f9", speckle: 0.5 }, turf: ["#2a1a4a", "#24163f"], kerb: ["#f0abfc", "#22d3ee"], barrier: ["#1e1b4b", "#c026d3"], led: "#f0abfc", ledGlow: 3, gantry: "#581c87", banner: ["#581c87", "#f0abfc", "#67e8f9"] },
};

/** Overlay colour for each surface type (index matches SURFACE_TYPES). */

const PALETTES: Record<string, Palette> = {
  alpine: {
    road: { base: "#33363f", edge: "#f1f5f9", centre: "#f8fafc", speckle: 1 },
    roadRoughness: 0.88,
    roadMetalness: 0,
    turf: ["#8f7d5d", "#857456"],
    turfRoughness: 1,
    kerb: ["#dc2626", "#f8fafc"],
    barrier: ["#f8fafc", "#dc2626"],
    led: "#ffffff",
    ledGlow: 0,
    pad: ["#ea580c", "#fde047"],
    board: ["#111827", "#facc15"],
    gantry: "#b91c1c",
    banner: ["#b91c1c", "#f8fafc", "#fbbf24"],
  },
  office: {
    road: { base: "#2d313c", edge: "#f1f5f9", centre: "#facc15", speckle: 1 },
    roadRoughness: 0.86,
    roadMetalness: 0,
    turf: ["#3f9a58", "#378c4f"],
    turfRoughness: 0.95,
    kerb: ["#e11d48", "#f8fafc"],
    barrier: ["#f8fafc", "#2563eb"],
    led: "#fff1c9",
    ledGlow: 1.6,
    pad: ["#ea580c", "#fde047"],
    board: ["#111827", "#facc15"],
    gantry: "#4338ca",
    banner: ["#4338ca", "#f8fafc", "#fbbf24"],
  },
  neon: {
    road: { base: "#12141d", edge: "#67e8f9", centre: "#f0abfc", speckle: 0.5 },
    roadRoughness: 0.28,
    roadMetalness: 0.35,
    turf: ["#141826", "#0f1320"],
    turfRoughness: 0.4,
    kerb: ["#d946ef", "#1e1b4b"],
    barrier: ["#0f172a", "#1e1b4b"],
    led: "#22d3ee",
    ledGlow: 5,
    pad: ["#7c3aed", "#67e8f9"],
    board: ["#0b1020", "#f0abfc"],
    gantry: "#0f172a",
    banner: ["#0b1020", "#67e8f9", "#f0abfc"],
  },
};

interface StripOptions {
  uvScale?: number;
  color?: (i: number) => THREE.Color;
  /** Leave out the stretch starting at sample i (on top of gaps, which are always left out). */
  skip?: (i: number) => boolean;
  /** Draw stretches that a hazard owns (collapsing sections, moving platforms). */
  includeDyn?: boolean;
  /** Put the second edge at this absolute height instead of following the road. */
  absB?: number;
}

/** A band of quads following the track between two (lateral, height) offsets. */
export function strip(track: Track, latA: number, yA: number, latB: number, yB: number, opts: StripOptions = {}): THREE.BufferGeometry {
  const { n, px, pz, nx, nz, spacing } = track;
  const pos = new Float32Array(n * 18);
  const uv = opts.uvScale ? new Float32Array(n * 12) : null;
  const col = opts.color ? new Float32Array(n * 18) : null;
  let p = 0;
  let u = 0;
  let c = 0;
  const put = (i: number, lat: number, y: number, uu: number, vv: number, color?: THREE.Color) => {
    pos[p++] = px[i] + nx[i] * lat;
    pos[p++] = uu === 1 && opts.absB !== undefined ? opts.absB : y + track.hy[i] + lat * track.bankT[i];
    pos[p++] = pz[i] + nz[i] * lat;
    if (uv) {
      uv[u++] = uu;
      uv[u++] = vv;
    }
    if (col && color) {
      col[c++] = color.r;
      col[c++] = color.g;
      col[c++] = color.b;
    }
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (track.gap[i] || (track.dyn[i] && !opts.includeDyn) || opts.skip?.(i)) continue;
    const v0 = opts.uvScale ? (i * spacing) / opts.uvScale : 0;
    const v1 = opts.uvScale ? ((i + 1) * spacing) / opts.uvScale : 0;
    const color = opts.color?.(i);
    put(i, latA, yA, 0, v0, color);
    put(i, latB, yB, 1, v0, color);
    put(j, latA, yA, 0, v1, color);
    put(i, latB, yB, 1, v0, color);
    put(j, latB, yB, 1, v1, color);
    put(j, latA, yA, 0, v1, color);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos.subarray(0, p), 3));
  if (uv) geo.setAttribute("uv", new THREE.BufferAttribute(uv.subarray(0, u), 2));
  if (col) geo.setAttribute("color", new THREE.BufferAttribute(col.subarray(0, c), 3));
  return geo;
}

/** How each surface type is lit. Index matches SURFACE_TYPES. */
const SURFACE_LOOK: { rough: number; metal: number; glow?: boolean; scroll?: boolean }[] = [
  { rough: 0.8, metal: 0 },
  { rough: 0.95, metal: 0 }, // dirt
  { rough: 0.3, metal: 0 }, // mud: wet
  { rough: 0.07, metal: 0.15 }, // ice
  { rough: 0.9, metal: 0 }, // snow
  { rough: 0.95, metal: 0 }, // sand
  { rough: 0.4, metal: 0, glow: true, scroll: true }, // boost road
  { rough: 0.05, metal: 0.55 }, // oil
  { rough: 0.6, metal: 0.2, scroll: true }, // conveyor
  { rough: 0.6, metal: 0.2, scroll: true }, // conveyor, backward
];

/**
 * One surface patch: a textured band on the road that fades out at its ends and along any edge
 * that is not the edge of the road, so it reads as part of the surface instead of a painted block.
 */
function zoneGeometry(track: Track, z: { i0: number; i1: number; latMin: number; latMax: number; type: number }, road: number): THREE.BufferGeometry {
  const { n, px, pz, nx, nz, spacing } = track;
  const a = Math.max(-road + 0.35, z.latMin);
  const b = Math.min(road - 0.35, z.latMax);
  const count = (((z.i1 - z.i0) % n) + n) % n;
  const feather = Math.min(1.4, (b - a) / 4);
  // Lateral stops: [offset, alpha]. Edges that sit on the road's own edge stay solid.
  const stops: [number, number][] = [[a, z.latMin <= -road + 0.5 ? 1 : 0], [a + feather, 1], [b - feather, 1], [b, z.latMax >= road - 0.5 ? 1 : 0]];
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const tile = 7.5;
  const back = z.type === 9;
  const put = (i: number, s: [number, number], along: number, fade: number) => {
    pos.push(px[i] + nx[i] * s[0], 0.078 + track.hy[i] + s[0] * track.bankT[i], pz[i] + nz[i] * s[0]);
    uv.push((s[0] - a) / tile, ((back ? -1 : 1) * along * spacing) / tile);
    col.push(1, 1, 1, s[1] * fade);
  };
  for (let k = 0; k < count; k++) {
    const i = (z.i0 + k) % n;
    const j = (i + 1) % n;
    if (track.gap[i] || track.dyn[i]) continue;
    const f0 = Math.min(1, k / 3, (count - k) / 3);
    const f1 = Math.min(1, (k + 1) / 3, (count - k - 1) / 3);
    for (let s = 0; s < 3; s++) {
      const l = stops[s];
      const r = stops[s + 1];
      put(i, l, k, f0);
      put(i, r, k, f0);
      put(j, l, k + 1, f1);
      put(i, r, k, f0);
      put(j, r, k + 1, f1);
      put(j, l, k + 1, f1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
  return geo;
}

/** Sweep a cross-section along both sides of the track and smooth it. */
function sweep(track: Track, profile: [number, number][], color: (i: number) => THREE.Color, respectOpenSides = false): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    // Barriers are left out where the track definition says the edge is open.
    const skip = respectOpenSides ? (i: number) => (track.open[i] & (side > 0 ? 2 : 1)) !== 0 : undefined;
    for (let k = 0; k < profile.length - 1; k++) {
      const [la, ya] = profile[k];
      const [lb, yb] = profile[k + 1];
      parts.push(strip(track, la * side, ya, lb * side, yb, { color, skip }));
    }
  }
  const merged = mergeVertices(mergeGeometries(parts, false)!, 1e-3);
  for (const g of parts) g.dispose();
  merged.computeVertexNormals();
  return merged;
}

function StartLights({ x, y, z, heading }: { x: number; y: number; z: number; heading: number }) {
  const mats = useMemo(() => [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ color: "#1b1f2a", toneMapped: false })), []);
  useEffect(() => () => mats.forEach((m) => m.dispose()), [mats]);
  useFrame(() => {
    const room = useStore.getState().room;
    const left = room && (room.phase === "countdown" || room.phase === "racing") ? room.raceStartAt - net.serverNow() : Infinity;
    for (let i = 0; i < 3; i++) {
      const m = mats[i];
      if (left <= 0 && left > -2500) m.color.setRGB(0.2, 5, 0.6);
      else if (left > 0 && left <= (3 - i) * 1000) m.color.setRGB(6, 0.25, 0.2);
      else m.color.setRGB(0.09, 0.1, 0.13);
    }
  });
  return (
    <group position={[x, y, z]} rotation-y={heading}>
      {[-3.2, 0, 3.2].map((lx, i) => (
        <mesh key={i} position={[lx, 0, -0.75]} material={mats[i]}>
          <sphereGeometry args={[0.62, 20, 14]} />
        </mesh>
      ))}
    </group>
  );
}

export function TrackSurface({ track, theme }: { track: Track; theme: TrackTheme }) {
  const scrollers = useRef<THREE.Texture[]>([]);

  const root = useMemo(() => {
    const pal = PALETTES[theme] ?? { ...PALETTES.alpine, ...(TINTS[theme] ?? {}) };
    const neonLike = theme === "neon" || theme === "sky";
    const road = track.def.roadHalfWidth;
    const wall = track.def.wallHalfWidth;
    const group = new THREE.Group();
    const textures: THREE.Texture[] = [];
    const keep = <T extends THREE.Texture>(t: T): T => {
      textures.push(t);
      return t;
    };

    // --- Road
    const roadMesh = new THREE.Mesh(
      strip(track, -road, 0.05, road, 0.05, { uvScale: 10 }),
      roadMaterial(keep(roadTexture(pal.road)), ROAD_TINT[theme] ?? "#d6d6d6", pal.roadRoughness, pal.roadMetalness, !!VERGE[theme]),
    );
    roadMesh.geometry.computeVertexNormals();
    roadMesh.receiveShadow = true;
    group.add(roadMesh);

    // --- Run-off strips between kerb and barrier
    const turfTex = keep(turfTexture(pal.turf[0], pal.turf[1]));
    const turfGeo = mergeGeometries([strip(track, -wall, 0.03, -road - 1.3, 0.03, { uvScale: 6 }), strip(track, road + 1.3, 0.03, wall, 0.03, { uvScale: 6 })], false)!;
    turfGeo.computeVertexNormals();
    const verge = VERGE[theme];
    const turf = new THREE.Mesh(turfGeo, verge ? groundMaterial(verge) : new THREE.MeshStandardMaterial({ map: turfTex, roughness: pal.turfRoughness, metalness: neonLike ? 0.4 : 0 }));
    turf.receiveShadow = true;
    group.add(turf);

    // --- Kerbs
    const kerbA = new THREE.Color(pal.kerb[0]);
    const kerbB = new THREE.Color(pal.kerb[1]);
    const kerb = new THREE.Mesh(
      sweep(
        track,
        [
          [road - 0.1, 0.04],
          [road + 0.25, 0.2],
          [road + 1.15, 0.2],
          [road + 1.45, 0.02],
        ],
        (i) => (Math.floor(i / 2) % 2 ? kerbA : kerbB),
      ),
      verge ? kerbMaterial() : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, side: THREE.DoubleSide }),
    );
    kerb.receiveShadow = true;
    group.add(kerb);

    // --- Barriers
    if (verge) {
      // Photo-scanned concrete barriers, set end to end along both edges.
      const length = 2.62;
      const scale = 1.7;
      const places: THREE.Matrix4[] = [];
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const step = Math.max(1, Math.round(length / track.spacing));
      for (const side of [1, -1]) {
        for (let i = 0; i < track.n; i += step) {
          const j = (i + step) % track.n;
          let blocked = false;
          for (let k = 0; k <= step; k++) {
            const s = (i + k) % track.n;
            if (track.gap[s] || track.dyn[s] || (track.open[s] & (side > 0 ? 2 : 1)) !== 0) blocked = true;
          }
          if (blocked) continue;
          const lat = side * (wall + 0.52);
          const ax = track.px[i] + track.nx[i] * lat;
          const az = track.pz[i] + track.nz[i] * lat;
          const ay = track.hy[i] + lat * track.bankT[i];
          const bx = track.px[j] + track.nx[j] * lat;
          const bz = track.pz[j] + track.nz[j] * lat;
          const by = track.hy[j] + lat * track.bankT[j];
          const run = Math.hypot(bx - ax, bz - az);
          // Each block follows the road: yawed along the edge, pitched with the slope.
          q.setFromEuler(new THREE.Euler(0, Math.atan2(-(bz - az), bx - ax) + (side > 0 ? Math.PI : 0), (side > 0 ? -1 : 1) * Math.atan2(by - ay, run), "YXZ"));
          places.push(new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2 - 0.03, (az + bz) / 2), q, new THREE.Vector3((run / 1.54) * 1.01, scale, scale)));
        }
      }
      void up;
      void scannedModel("barrier")
        .then((model) => {
          if (group.userData.disposed) return;
          const base = new THREE.MeshStandardMaterial({ map: model.map, normalMap: model.normalMap, roughness: 0.88, color: verge.barrierTint ?? "#ffffff" });
          const mesh = new THREE.InstancedMesh(model.geometry, verge.snow ? snowCap(base, verge.snow) : base, places.length);
          places.forEach((m, i) => mesh.setMatrixAt(i, m));
          mesh.instanceMatrix.needsUpdate = true;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.frustumCulled = false;
          group.add(mesh);
        })
        .catch(() => undefined);
    } else {
      const barA = new THREE.Color(pal.barrier[0]);
      const barB = new THREE.Color(pal.barrier[1]);
      const barrier = new THREE.Mesh(
        sweep(
          track,
          [
            [wall, 0],
            [wall, 0.95],
            [wall + 0.14, 1.32],
            [wall + 0.86, 1.32],
            [wall + 1.0, 0.95],
            [wall + 1.0, 0],
          ],
          (i) => (Math.floor(i / 5) % 2 ? barA : barB),
          true,
        ),
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: neonLike ? 0.3 : 0.4, metalness: neonLike ? 0.6 : 0.05, side: THREE.DoubleSide }),
      );
      barrier.castShadow = true;
      barrier.receiveShadow = true;
      group.add(barrier);
    }

    // --- Trackside furniture on the realistic circuits: debris fencing, grandstands, marshal posts
    if (verge) {
      const blockedAt = (i: number, side: number): boolean => !!track.gap[i] || !!track.dyn[i] || (track.open[i] & (side > 0 ? 2 : 1)) !== 0;
      const at = (i: number, lat: number, out: THREE.Vector3): THREE.Vector3 => out.set(track.px[i] + track.nx[i] * lat, track.hy[i] + lat * track.bankT[i], track.pz[i] + track.nz[i] * lat);
      const steel = new THREE.MeshStandardMaterial({ color: "#6a7078", metalness: 0.85, roughness: 0.45 });
      const concrete = new THREE.MeshStandardMaterial({ color: "#8d8c88", roughness: 0.92 });

      // Debris fence: tall mesh panels leaning in at the top, in alternating stretches on each side.
      const zone = Math.max(4, Math.round(150 / track.spacing));
      const fencePos: number[] = [];
      const fenceUv: number[] = [];
      const posts: THREE.Matrix4[] = [];
      const a0 = new THREE.Vector3();
      const a1 = new THREE.Vector3();
      const qq = new THREE.Quaternion();
      const yUp = new THREE.Vector3(0, 1, 0);
      const postEvery = Math.max(1, Math.round(4.5 / track.spacing));
      for (const side of [1, -1]) {
        for (let i = 0; i < track.n; i++) {
          const j = (i + 1) % track.n;
          const fenced = Math.floor(i / zone) % 2 === (side > 0 ? 0 : 1);
          if (!fenced || blockedAt(i, side) || blockedAt(j, side)) continue;
          const lat = side * (wall + 1.75);
          const lean = side * (wall + 1.05);
          at(i, lat, a0);
          at(j, lat, a1);
          const b0 = at(i, lean, new THREE.Vector3());
          const b1 = at(j, lean, new THREE.Vector3());
          const u0 = (i * track.spacing) / 1.6;
          const u1 = u0 + track.spacing / 1.6;
          // Upright panel, then the overhang.
          const quads: [THREE.Vector3, number, THREE.Vector3, number, THREE.Vector3, number, THREE.Vector3, number][] = [
            [a0, 1.0, a1, 1.0, a1, 4.4, a0, 4.4],
            [a0, 4.4, a1, 4.4, b1, 5.1, b0, 5.1],
          ];
          for (const [p0, y0, p1, y1, p2, y2, p3, y3] of quads) {
            fencePos.push(p0.x, p0.y + y0, p0.z, p1.x, p1.y + y1, p1.z, p2.x, p2.y + y2, p2.z, p0.x, p0.y + y0, p0.z, p2.x, p2.y + y2, p2.z, p3.x, p3.y + y3, p3.z);
            fenceUv.push(u0, y0 / 1.6, u1, y1 / 1.6, u1, y2 / 1.6, u0, y0 / 1.6, u1, y2 / 1.6, u0, y3 / 1.6);
          }
          if (i % postEvery === 0) posts.push(new THREE.Matrix4().compose(a0.clone(), qq.setFromAxisAngle(yUp, Math.atan2(-track.nx[i] * side, -track.nz[i] * side)), new THREE.Vector3(1, 1, 1)));
        }
      }
      if (fencePos.length > 0) {
        const fg = new THREE.BufferGeometry();
        fg.setAttribute("position", new THREE.Float32BufferAttribute(fencePos, 3));
        fg.setAttribute("uv", new THREE.Float32BufferAttribute(fenceUv, 2));
        fg.computeVertexNormals();
        const mesh = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ map: keep(fenceTexture()), transparent: true, alphaTest: 0.08, side: THREE.DoubleSide, metalness: 0.7, roughness: 0.5, depthWrite: false }));
        mesh.renderOrder = 2;
        group.add(mesh);
        // Posts: upright to the top of the panel, then cranked inwards.
        const postGeo = mergeGeometries([new THREE.CylinderGeometry(0.06, 0.07, 4.4, 6).translate(0, 2.2, 0), new THREE.CylinderGeometry(0.05, 0.06, 1.0, 6).rotateX(0.78).translate(0, 4.75, 0.35)], false)!;
        const postMesh = new THREE.InstancedMesh(postGeo, steel, posts.length);
        posts.forEach((m, k) => postMesh.setMatrixAt(k, m));
        postMesh.instanceMatrix.needsUpdate = true;
        postMesh.frustumCulled = false;
        postMesh.castShadow = true;
        group.add(postMesh);
      }

      // Grandstands on the start straight: a concrete bank of seats under a cantilever roof.
      const crowd = keep(crowdTexture());
      const standAt = (i: number, side: number) => {
        const half = Math.round(26 / track.spacing);
        for (let k = -half; k <= half; k++) if (blockedAt((i + k + track.n) % track.n, side)) return;
        const stand = new THREE.Group();
        at(i, side * (wall + 4.2), stand.position);
        stand.rotation.y = Math.atan2(-track.nx[i] * side, -track.nz[i] * side);
        // Local frame: +z towards the track, x along it.
        const L = 48;
        const base = new THREE.Mesh(new THREE.BoxGeometry(L, 1.6, 11).translate(0, 0.8, -5.5), concrete);
        const seats = new THREE.Mesh(new THREE.PlaneGeometry(L, 12.2), new THREE.MeshStandardMaterial({ map: crowd, roughness: 1 }));
        seats.rotation.x = -Math.PI / 2 + 0.52;
        seats.position.set(0, 4.65, -5.6);
        const back = new THREE.Mesh(new THREE.BoxGeometry(L, 9.5, 0.4).translate(0, 4.75, -11.2), concrete);
        const roof = new THREE.Mesh(new THREE.BoxGeometry(L + 2, 0.25, 13).translate(0, 0, 0), steel);
        roof.rotation.x = 0.1;
        roof.position.set(0, 10.6, -5.2);
        const fascia = new THREE.Mesh(new THREE.BoxGeometry(L, 1.1, 0.2).translate(0, 1.6, 0.05), new THREE.MeshStandardMaterial({ color: "#f3f1ea", roughness: 0.7 }));
        stand.add(base, seats, back, roof, fascia);
        for (let x = -L / 2 + 2; x <= L / 2 - 2; x += 8.8) {
          const col = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 10.4, 8).translate(x, 5.2, -10.6), steel);
          const strut = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.3, 11).translate(x, 10.25, -5.2), steel);
          strut.rotation.x = 0.1;
          stand.add(col, strut);
        }
        stand.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
          }
        });
        group.add(stand);
      };
      standAt((track.n - Math.round(34 / track.spacing)) % track.n, 1);
      standAt(Math.round(52 / track.spacing) % track.n, -1);

      // Marshal posts: a small cabin with an orange roof every few hundred metres.
      const huts: THREE.Matrix4[] = [];
      const hutEvery = Math.max(8, Math.round(280 / track.spacing));
      for (let i = Math.round(hutEvery / 2), k = 0; i < track.n; i += hutEvery, k++) {
        const side = k % 2 ? -1 : 1;
        if (blockedAt(i, side)) continue;
        huts.push(new THREE.Matrix4().compose(at(i, side * (wall + 3.4), new THREE.Vector3()), qq.setFromAxisAngle(yUp, Math.atan2(-track.nx[i] * side, -track.nz[i] * side)), new THREE.Vector3(1, 1, 1)));
      }
      if (huts.length > 0) {
        const cabin = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 2.3, 2.2).translate(0, 1.15, 0), new THREE.MeshStandardMaterial({ color: "#e9e7e0", roughness: 0.8 }), huts.length);
        const roofs = new THREE.InstancedMesh(new THREE.BoxGeometry(3.0, 0.16, 2.8).translate(0, 2.4, 0.2), new THREE.MeshStandardMaterial({ color: "#d9541e", roughness: 0.6 }), huts.length);
        const windows = new THREE.InstancedMesh(new THREE.BoxGeometry(2.0, 0.8, 0.06).translate(0, 1.5, 1.11), new THREE.MeshStandardMaterial({ color: "#0b1016", metalness: 0.9, roughness: 0.08 }), huts.length);
        for (const mesh of [cabin, roofs, windows]) {
          huts.forEach((m, k) => mesh.setMatrixAt(k, m));
          mesh.instanceMatrix.needsUpdate = true;
          mesh.frustumCulled = false;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          group.add(mesh);
        }
      }
    }

    // --- Floodlights for night races: masts behind the barrier, alternating sides
    if (verge?.lamps) {
      const every = Math.max(1, Math.round(46 / track.spacing));
      const spots: { x: number; y: number; z: number; yaw: number }[] = [];
      let k = 0;
      for (let i = 0; i < track.n; i += every, k++) {
        const side = k % 2 ? 1 : -1;
        if (track.gap[i] || track.dyn[i] || (track.open[i] & (side > 0 ? 2 : 1)) !== 0) continue;
        const lat = side * (wall + 3.2);
        spots.push({ x: track.px[i] + track.nx[i] * lat, y: track.hy[i] + lat * track.bankT[i], z: track.pz[i] + track.nz[i] * lat, yaw: Math.atan2(-track.nx[i] * side, -track.nz[i] * side) });
      }
      const mast = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.24, 13, 8).translate(0, 6.5, 0), new THREE.MeshStandardMaterial({ color: "#5d6268", metalness: 0.8, roughness: 0.45 }), spots.length);
      const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.2, 3.4).translate(0, 13, 1.5), mast.material, spots.length);
      const head = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.12, 0.7).translate(0, 12.86, 3.1), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 8.6, 7.6), toneMapped: false }), spots.length);
      const pool = new THREE.InstancedMesh(new THREE.CircleGeometry(15, 24).rotateX(-Math.PI / 2).translate(0, 0.09, 8.5), new THREE.MeshBasicMaterial({ map: keep(glowTexture()), color: new THREE.Color(0.2, 0.19, 0.16), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), spots.length);
      const mm = new THREE.Matrix4();
      const qq = new THREE.Quaternion();
      spots.forEach((sp, i) => {
        qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), sp.yaw);
        mm.compose(new THREE.Vector3(sp.x, sp.y, sp.z), qq, new THREE.Vector3(1, 1, 1));
        for (const mesh of [mast, arm, head, pool]) mesh.setMatrixAt(i, mm);
      });
      for (const mesh of [mast, arm, head, pool]) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        group.add(mesh);
      }
      mast.castShadow = true;
    }

    // --- Light strip along the top of both barriers
    const led = new THREE.Color(pal.led).multiplyScalar(pal.ledGlow);
    const ledAlt = neonLike ? new THREE.Color("#e879f9").multiplyScalar(pal.ledGlow) : led;
    const ledGeo = mergeGeometries(
      [
        strip(track, wall + 0.3, 1.335, wall + 0.7, 1.335, { color: () => led }),
        strip(track, -wall - 0.7, 1.335, -wall - 0.3, 1.335, { color: () => ledAlt }),
        ...(neonLike
          ? [strip(track, wall - 0.02, 0.35, wall - 0.02, 0.6, { color: () => led }), strip(track, -wall + 0.02, 0.6, -wall + 0.02, 0.35, { color: () => ledAlt })]
          : []),
      ],
      false,
    )!;
    if (pal.ledGlow > 0) group.add(new THREE.Mesh(ledGeo, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide })));

    // --- Surface patches (ice, mud, dirt, snow, sand, oil, belts, boost road), textured and feathered into the road
    const zoneScroll: THREE.Texture[] = [];
    if (track.zones.length) {
      const byType = new Map<number, THREE.BufferGeometry[]>();
      for (const z of track.zones) {
        const list = byType.get(z.type) ?? [];
        byType.set(z.type, list);
        list.push(zoneGeometry(track, z, road));
      }
      for (const [type, geos] of byType) {
        const look = SURFACE_LOOK[type] ?? SURFACE_LOOK[1];
        // Both belt directions share one texture; the backward belt's geometry runs the other way.
        const tex = keep(surfaceTexture(type === 9 ? 8 : type));
        const g = mergeGeometries(geos, false)!;
        g.computeVertexNormals();
        const mat = look.glow
          ? new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, color: new THREE.Color(1.7, 1.7, 1.7) })
          : new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, transparent: true, depthWrite: false, roughness: look.rough, metalness: look.metal, envMapIntensity: look.rough < 0.2 ? 1.6 : 1 });
        const m = new THREE.Mesh(g, mat);
        m.receiveShadow = true;
        m.renderOrder = 2;
        group.add(m);
        if (look.scroll) zoneScroll.push(tex);
      }
    }

    // --- Start line and gantry
    const h0 = Math.atan2(track.tx[0], track.tz[0]);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(road * 2, 4), new THREE.MeshStandardMaterial({ map: keep(checkerTexture()), roughness: 0.6 }));
    line.rotation.set(-Math.PI / 2, 0, 0);
    line.receiveShadow = true;
    const lineHolder = new THREE.Group();
    lineHolder.position.set(track.px[0], track.hy[0] + 0.065, track.pz[0]);
    lineHolder.rotation.y = h0;
    lineHolder.add(line);
    group.add(lineHolder);

    const b = new Builder(400);
    const span = wall + 2.4;
    b.push(track.px[0], track.hy[0], track.pz[0], h0);
    for (const side of [-1, 1]) {
      b.rbox(3.4, 0.7, 3.4, 0.2, side * span, 0.35, 0, "#111827", { bucket: "metal" });
      b.rbox(1.5, 12, 1.5, 0.25, side * span, 6, 0, "#1f2937", { bucket: "metal" });
      b.rbox(0.5, 9, 0.5, 0.1, side * (span - 1.6), 5, 0, pal.gantry, { bucket: "gloss", rz: side * 0.16 });
      b.box(0.9, 0.5, 1.2, side * (span - 0.2), 12.6, -1, "#fff7d6", { bucket: "glow", glow: 5 });
    }
    b.rbox(span * 2 + 1.5, 3, 1.5, 0.3, 0, 11.3, 0, pal.gantry, { bucket: "gloss" });
    b.rbox(span * 2 - 2, 0.35, 0.35, 0.1, 0, 9.3, 0, "#1f2937", { bucket: "metal" });
    b.rbox(10.6, 1.9, 1, 0.3, 0, 8.4, -0.3, "#0b0d12", { bucket: "matte" });
    for (const lx of [-5.6, 5.6]) b.cyl(0.12, 0.12, 1, lx * 0.7, 9.2, -0.3, "#1f2937", { bucket: "metal" });
    b.pop();
    group.add(b.build());

    const bannerTex = keep(bannerTexture(track.def.name.toUpperCase(), pal.banner[0], pal.banner[1], pal.banner[2]));
    const bannerMat = new THREE.MeshBasicMaterial({ map: bannerTex, toneMapped: false });
    const gantry = new THREE.Group();
    gantry.position.set(track.px[0], track.hy[0] + 11.3, track.pz[0]);
    gantry.rotation.y = h0;
    for (const dir of [-1, 1]) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(span * 2 - 1.5, 2.5), bannerMat);
      plane.position.z = dir * 0.77;
      if (dir < 0) plane.rotation.y = Math.PI;
      gantry.add(plane);
    }
    group.add(gantry);

    // --- Boost pads
    const padTex = keep(boostTexture(pal.pad[0], pal.pad[1], !!verge));
    padTex.repeat.set(1, 1.4);
    // On the realistic circuits a boost strip is road paint with a faint glow, not a lit panel.
    const padMat = verge
      ? new THREE.MeshStandardMaterial({ map: padTex, transparent: true, roughness: 0.55, emissive: "#ffffff", emissiveMap: padTex, emissiveIntensity: 0.55, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false })
      : new THREE.MeshBasicMaterial({ map: padTex, toneMapped: false, color: new THREE.Color(1.5, 1.5, 1.5) });
    for (const pad of track.pads) {
      const mid = Math.round((pad.i0 + pad.i1) / 2) % track.n;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pad.halfWidth * 2, (pad.i1 - pad.i0) * track.spacing), padMat);
      mesh.position.set(track.px[mid] + track.nx[mid] * pad.lateral, track.hy[mid] + pad.lateral * track.bankT[mid] + 0.09, track.pz[mid] + track.nz[mid] * pad.lateral);
      // Lie flat on the road, tilted to follow its slope, chevrons pointing down the track.
      mesh.rotation.set(-Math.PI / 2 - Math.atan(track.slope[mid]), Math.atan2(track.tx[mid], track.tz[mid]) + Math.PI, 0, "YXZ");
      group.add(mesh);
    }

    // --- Corner warning boards on the outside of tight bends
    const spots: { i: number; side: number }[] = [];
    let last = -100;
    for (let i = 0; i < track.n; i++) {
      const a = (i - 2 + track.n) % track.n;
      const c = (i + 2) % track.n;
      const curve = ((track.tx[c] - track.tx[a]) * track.nx[i] + (track.tz[c] - track.tz[a]) * track.nz[i]) / (4 * track.spacing);
      if (Math.abs(curve) > 1 / 48 && i - last >= 4 && !track.gap[i] && !(track.open[i] & (curve > 0 ? 1 : 2))) {
        spots.push({ i, side: curve > 0 ? 1 : -1 });
        last = i;
      }
    }
    if (spots.length) {
      const boardTex = keep(chevronBoardTexture(pal.board[0], pal.board[1]));
      const boards = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(3.6, 1.8),
        new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false, side: THREE.DoubleSide, color: new THREE.Color(1.25, 1.25, 1.25) }),
        spots.length,
      );
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      spots.forEach(({ i, side }, k) => {
        // Outside of a right-hander is the left barrier, and vice versa.
        const lat = -side * (wall + 0.5);
        q.setFromAxisAngle(up, Math.atan2(-track.tx[i], -track.tz[i]));
        m.compose(new THREE.Vector3(track.px[i] + track.nx[i] * lat, track.hy[i] + lat * track.bankT[i] + 2.35, track.pz[i] + track.nz[i] * lat), q, new THREE.Vector3(side, 1, 1));
        boards.setMatrixAt(k, m);
      });
      boards.instanceMatrix.needsUpdate = true;
      group.add(boards);
    }

    scrollers.current = [padTex, ...zoneScroll];
    group.userData.textures = textures;
    return group;
  }, [track, theme]);

  useEffect(
    () => () => {
      root.userData.disposed = true;
      disposeTree(root);
      for (const t of root.userData.textures as THREE.Texture[]) t.dispose();
    },
    [root],
  );

  useFrame((_, dt) => {
    for (const t of scrollers.current) t.offset.y = (t.offset.y - dt * 1.6 + 1) % 1;
  });

  return (
    <>
      <primitive object={root} />
      <StartLights x={track.px[0]} y={track.hy[0] + 8.4} z={track.pz[0]} heading={Math.atan2(track.tx[0], track.tz[0])} />
    </>
  );
}
