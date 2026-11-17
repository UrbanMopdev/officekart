/**
 * Everything that belongs to the circuit itself, in any environment: road,
 * kerbs, run-off, barriers with light strips, start gantry with countdown
 * lights, boost pads and corner warning boards.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Track, TrackTheme } from "@office-kart/shared";
import { net } from "../net/connection";
import { useStore } from "../store";
import { Builder, disposeTree } from "./builder";
import { bannerTexture, boostTexture, checkerTexture, chevronBoardTexture, roadTexture, turfTexture, type RoadStyle } from "./textures";

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
  volcano: { turf: ["#3a2a26", "#30221f"], kerb: ["#f97316", "#1c1917"], barrier: ["#1c1917", "#f97316"], gantry: "#7c2d12", banner: ["#7c2d12", "#fed7aa", "#f97316"] },
  frozen: { turf: ["#e8f0f8", "#dbe6f2"], kerb: ["#0ea5e9", "#f8fafc"], barrier: ["#f8fafc", "#38bdf8"], gantry: "#0c4a6e", banner: ["#0c4a6e", "#f8fafc", "#7dd3fc"] },
  jungle: { turf: ["#6b5a36", "#5f4f2f"], kerb: ["#ca8a04", "#fef3c7"], barrier: ["#a8a29e", "#57534e"], gantry: "#3f6212", banner: ["#3f6212", "#fef9c3", "#facc15"] },
  sea: { turf: ["#dcc891", "#d0bb82"], kerb: ["#f97316", "#f8fafc"], barrier: ["#f8fafc", "#f97316"], gantry: "#0e7490", banner: ["#0e7490", "#f8fafc", "#fde047"] },
  chaos: { road: { base: "#1a1230", edge: "#f0abfc", centre: "#67e8f9", speckle: 0.5 }, turf: ["#2a1a4a", "#24163f"], kerb: ["#f0abfc", "#22d3ee"], barrier: ["#1e1b4b", "#c026d3"], led: "#f0abfc", ledGlow: 3, gantry: "#581c87", banner: ["#581c87", "#f0abfc", "#67e8f9"] },
};

/** Overlay colour for each surface type (index matches SURFACE_TYPES). */
const SURFACE_COLORS = ["#2d313c", "#a8834f", "#5a3a1f", "#bfe8ff", "#f3f7fd", "#e3cb8a", "#22d3ee", "#1a1026", "#4b5563", "#7c2d12"];

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
      new THREE.MeshStandardMaterial({ map: keep(roadTexture(pal.road)), roughness: pal.roadRoughness, metalness: pal.roadMetalness }),
    );
    roadMesh.geometry.computeVertexNormals();
    roadMesh.receiveShadow = true;
    group.add(roadMesh);

    // --- Run-off strips between kerb and barrier
    const turfTex = keep(turfTexture(pal.turf[0], pal.turf[1]));
    const turfGeo = mergeGeometries([strip(track, -wall, 0.03, -road - 1.3, 0.03, { uvScale: 6 }), strip(track, road + 1.3, 0.03, wall, 0.03, { uvScale: 6 })], false)!;
    turfGeo.computeVertexNormals();
    const turf = new THREE.Mesh(turfGeo, new THREE.MeshStandardMaterial({ map: turfTex, roughness: pal.turfRoughness, metalness: neonLike ? 0.4 : 0 }));
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
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, side: THREE.DoubleSide }),
    );
    kerb.receiveShadow = true;
    group.add(kerb);

    // --- Barriers
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

    // --- Surface patches (ice, mud, dirt, snow, sand, boost road)
    if (track.zones.length) {
      const solid: THREE.BufferGeometry[] = [];
      const glow: THREE.BufferGeometry[] = [];
      for (const z of track.zones) {
        const inside = (i: number) => (z.i0 <= z.i1 ? i >= z.i0 && i < z.i1 : i >= z.i0 || i < z.i1);
        const a = Math.max(-road + 0.4, z.latMin);
        const b2 = Math.min(road - 0.4, z.latMax);
        const boost = z.type === 6;
        const base = new THREE.Color(SURFACE_COLORS[z.type]);
        const alt = base.clone().multiplyScalar(boost ? 0.35 : 0.9);
        const hot = base.clone().multiplyScalar(1.9);
        const belt = z.type === 8 || z.type === 9;
        (boost ? glow : solid).push(strip(track, a, 0.075, b2, 0.075, { skip: (i) => !inside(i), color: (i) => (boost ? (i % 2 ? hot : alt) : belt ? (i % 2 ? base : alt.clone().multiplyScalar(0.6)) : Math.floor(i / 3) % 2 ? base : alt) }));
      }
      if (solid.length) {
        const g = mergeGeometries(solid, false)!;
        g.computeVertexNormals();
        const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32 }));
        m.receiveShadow = true;
        group.add(m);
      }
      if (glow.length) group.add(new THREE.Mesh(mergeGeometries(glow, false)!, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })));
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
    const padTex = keep(boostTexture(pal.pad[0], pal.pad[1]));
    padTex.repeat.set(1, 1.4);
    const padMat = new THREE.MeshBasicMaterial({ map: padTex, toneMapped: false, color: new THREE.Color(1.5, 1.5, 1.5) });
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

    scrollers.current = [padTex];
    group.userData.textures = textures;
    return group;
  }, [track, theme]);

  useEffect(
    () => () => {
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
