/**
 * Office Dash environment: a sunlit open-plan office seen from toy-car height.
 * Giant desks to drive under, mugs, books, laptops and plants along the
 * circuit, and a real room around it all with windows and ceiling lights.
 * Everything here is scenery outside the barriers, so none of it collides.
 */
import { useEffect, useMemo } from "react";
import { Sparkles } from "@react-three/drei";
import * as THREE from "three";
import type { Track } from "@office-kart/shared";
import type { Quality } from "../../store";
import { Builder, disposeTree } from "../builder";
import { rugTexture, whiteboardTexture, woodTexture } from "../textures";
import { strip } from "../TrackSurface";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Placer, distanceToTrack, mulberry, trackBounds } from "./placement";

type Rand = () => number;
const BRIGHTS = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ec4899", "#14b8a6", "#f97316", "#0ea5e9", "#eab308"];
const pick = <T,>(r: Rand, list: T[]): T => list[Math.floor(r() * list.length)];

interface Kind {
  radius: number;
  weight: number;
  /** Only used for the open-floor scatter, not right beside the circuit. */
  farOnly?: boolean;
  make(b: Builder, r: Rand): void;
}

const KINDS: Record<string, Kind> = {
  mug: {
    radius: 6.5,
    weight: 3,
    make(b, r) {
      const c = pick(r, BRIGHTS.concat(["#f8fafc", "#0f172a"]));
      b.cyl(4.6, 4.1, 9.4, 0, 4.7, 0, c, { bucket: "gloss", seg: 28 });
      b.torus(4.5, 0.32, 0, 9.4, 0, c, { bucket: "gloss", rx: Math.PI / 2 });
      b.cyl(4.2, 4.2, 0.3, 0, 8.6, 0, "#3a2113", { bucket: "gloss", seg: 28 });
      b.torus(2.6, 0.75, 5.1, 4.9, 0, c, { bucket: "gloss", arc: Math.PI, rz: -Math.PI / 2 });
    },
  },
  cup: {
    radius: 5,
    weight: 2,
    make(b, r) {
      b.cyl(3.6, 2.7, 10, 0, 5, 0, "#f8fafc", { seg: 24 });
      b.cyl(3.45, 3.0, 4, 0, 5.2, 0, pick(r, ["#92400e", "#166534", "#1e3a8a"]), { seg: 24 });
      b.cyl(3.8, 3.8, 0.9, 0, 10.4, 0, "#1f2937", { bucket: "gloss", seg: 24 });
      b.cyl(2.6, 3.4, 0.6, 0, 11.1, 0, "#1f2937", { bucket: "gloss", seg: 24 });
    },
  },
  books: {
    radius: 10,
    weight: 4,
    make(b, r) {
      let y = 0;
      const count = 2 + Math.floor(r() * 4);
      for (let i = 0; i < count; i++) {
        const w = 13 + r() * 5;
        const d = 9 + r() * 3;
        const h = 1.8 + r() * 1.6;
        const yaw = (r() - 0.5) * 0.5;
        b.rbox(w, h, d, 0.25, 0, y + h / 2, 0, pick(r, BRIGHTS), { ry: yaw, bucket: "gloss" });
        b.box(w - 0.5, h - 0.5, d - 0.4, 0.35, y + h / 2, 0.3, "#f5f0e1", { ry: yaw });
        y += h;
      }
    },
  },
  pencil: {
    radius: 15,
    weight: 3,
    make(b, r) {
      const c = pick(r, ["#facc15", "#ef4444", "#22c55e", "#3b82f6"]);
      b.cyl(1.05, 1.05, 22, 0, 1.05, 0, c, { rz: Math.PI / 2, bucket: "gloss", seg: 6 });
      b.cone(1.05, 3.2, -12.6, 1.05, 0, "#e7c9a0", { rz: Math.PI / 2, seg: 6 });
      b.cone(0.4, 1.1, -13.7, 1.05, 0, "#1f2937", { rz: Math.PI / 2, seg: 6 });
      b.cyl(1.12, 1.12, 1.8, 11.9, 1.05, 0, "#cbd5e1", { rz: Math.PI / 2, bucket: "metal", seg: 14 });
      b.cyl(1.05, 1.05, 2, 13.7, 1.05, 0, "#f472b6", { rz: Math.PI / 2, seg: 14 });
    },
  },
  laptop: {
    radius: 14,
    weight: 3,
    make(b, r) {
      b.rbox(22, 0.9, 15, 0.3, 0, 0.45, 0, "#cbd5e1", { bucket: "metal" });
      b.box(19, 0.12, 8, 0, 0.93, -2, "#1f2937");
      b.box(8, 0.1, 4, 0, 0.93, 4.6, "#94a3b8", { bucket: "gloss" });
      b.rbox(22, 14.5, 0.7, 0.3, 0, 7.7, -9.2, "#cbd5e1", { bucket: "metal", rx: -0.26 });
      b.box(20.4, 12.8, 0.1, 0, 7.75, -8.75, pick(r, ["#7dd3fc", "#a5b4fc", "#86efac"]), { bucket: "glow", glow: 1.5, rx: -0.26 });
      for (let i = 0; i < 5; i++) b.box(2.2, 2 + r() * 7, 0.1, -7 + i * 3.5, 5.5, -8.1, pick(r, ["#f472b6", "#fbbf24", "#f8fafc"]), { bucket: "glow", glow: 2.2, rx: -0.26 });
    },
  },
  monitor: {
    radius: 14,
    weight: 3,
    make(b, r) {
      b.rbox(11, 0.8, 8, 0.25, 0, 0.4, 0, "#334155", { bucket: "metal" });
      b.rbox(1.8, 9, 1.2, 0.2, 0, 5, -1, "#334155", { bucket: "metal" });
      b.rbox(28, 16.5, 1.3, 0.4, 0, 16, 0, "#0f172a", { bucket: "gloss" });
      b.box(26.4, 14.8, 0.1, 0, 16, 0.7, pick(r, ["#1d4ed8", "#0e7490", "#6d28d9"]), { bucket: "glow", glow: 1.3 });
      for (let i = 0; i < 7; i++) {
        const h = 2 + r() * 9;
        b.box(2.2, h, 0.1, -9 + i * 3, 10.5 + h / 2, 0.78, pick(r, ["#7dd3fc", "#fde047", "#f9a8d4", "#86efac"]), { bucket: "glow", glow: 2.4 });
      }
    },
  },
  keyboard: {
    radius: 15,
    weight: 2,
    make(b, r) {
      b.rbox(27, 1.3, 10.5, 0.4, 0, 0.65, 0, "#1e293b", { bucket: "gloss" });
      const accent = pick(r, BRIGHTS);
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 12; col++) {
          b.box(1.7, 0.7, 1.9, -11.6 + col * 2.1, 1.6, -3.4 + row * 2.3, (row * 5 + col) % 11 === 0 ? accent : "#e2e8f0", { bucket: "gloss" });
        }
      }
    },
  },
  stapler: {
    radius: 9,
    weight: 2,
    make(b, r) {
      const c = pick(r, ["#dc2626", "#2563eb", "#111827"]);
      b.rbox(15, 1.4, 4.6, 0.4, 0, 0.7, 0, "#1f2937", { bucket: "gloss" });
      b.rbox(13, 0.5, 3.2, 0.15, 0.4, 1.7, 0, "#cbd5e1", { bucket: "metal" });
      b.rbox(14.5, 2.6, 4.4, 0.8, 0.8, 4.0, 0, c, { bucket: "gloss", rz: 0.13 });
      b.cyl(1.2, 1.2, 4.8, -6.4, 2.2, 0, "#111827", { rx: Math.PI / 2 });
    },
  },
  notes: {
    radius: 6,
    weight: 3,
    make(b, r) {
      const colors = ["#fde047", "#f9a8d4", "#86efac", "#93c5fd", "#fdba74"];
      const count = 2 + Math.floor(r() * 3);
      for (let i = 0; i < count; i++) b.rbox(7.5, 1.1, 7.5, 0.15, (r() - 0.5) * 1.2, 0.55 + i * 1.1, (r() - 0.5) * 1.2, pick(r, colors), { ry: (r() - 0.5) * 0.6 });
    },
  },
  plant: {
    radius: 9,
    weight: 4,
    make(b, r) {
      const pot = pick(r, ["#c2410c", "#f8fafc", "#0f766e", "#1e293b"]);
      b.cyl(5.6, 4.2, 8.5, 0, 4.25, 0, pot, { bucket: "gloss", seg: 22 });
      b.torus(5.6, 0.4, 0, 8.5, 0, pot, { bucket: "gloss", rx: Math.PI / 2 });
      b.cyl(5.1, 5.1, 0.3, 0, 8.2, 0, "#3b2a1a", { seg: 22 });
      const greens = ["#15803d", "#16a34a", "#22c55e", "#4ade80", "#166534"];
      const leaves = 13 + Math.floor(r() * 7);
      for (let i = 0; i < leaves; i++) {
        const a = r() * Math.PI * 2;
        const rad = r() * 5.6;
        const y = 11 + r() * 10 - rad * 0.4;
        b.ico(2.6 + r() * 2.4, 1, Math.cos(a) * rad, y, Math.sin(a) * rad, pick(r, greens), { sy: 0.75 + r() * 0.4 });
      }
      b.cyl(0.5, 0.7, 7, 0, 11, 0, "#5b3a1e", { seg: 6 });
    },
  },
  lamp: {
    radius: 9,
    weight: 2,
    make(b, r) {
      const c = pick(r, ["#111827", "#f59e0b", "#0ea5e9", "#f8fafc"]);
      b.cyl(5, 5.4, 1.2, 0, 0.6, 0, c, { bucket: "gloss", seg: 26 });
      b.cyl(0.5, 0.5, 14, 0, 7.6, -1.5, "#cbd5e1", { bucket: "metal", rx: -0.3, seg: 10 });
      b.sphere(0.9, 0, 14.3, -3.5, "#cbd5e1", { bucket: "metal" });
      b.cyl(0.5, 0.5, 11, 0, 17.3, 0.6, "#cbd5e1", { bucket: "metal", rx: 0.85, seg: 10 });
      b.cone(4.4, 5.2, 0, 19.2, 5.6, c, { bucket: "gloss", rx: 0.9, seg: 24 });
      b.sphere(1.9, 0, 17.6, 6.8, "#fff3c4", { bucket: "glow", glow: 6 });
    },
  },
  duck: {
    radius: 6,
    weight: 1,
    make(b) {
      b.sphere(4.2, 0, 3.4, 0, "#facc15", { bucket: "gloss", sy: 0.8, sz: 1.25, seg: 22 });
      b.sphere(2.7, 0, 7.6, 2.6, "#facc15", { bucket: "gloss", seg: 20 });
      b.cone(1.1, 2.2, 0, 7.2, 5.4, "#f97316", { bucket: "gloss", rx: Math.PI / 2, sy: 1, sz: 0.55 });
      b.sphere(0.42, -1.1, 8.4, 4.7, "#0f172a", { bucket: "gloss", seg: 8 });
      b.sphere(0.42, 1.1, 8.4, 4.7, "#0f172a", { bucket: "gloss", seg: 8 });
      b.cone(1.6, 3, 0, 4.6, -5.2, "#facc15", { bucket: "gloss", rx: -1.0 });
    },
  },
  cube: {
    radius: 6,
    weight: 1,
    make(b, r) {
      const stickers = ["#ef4444", "#22c55e", "#3b82f6", "#facc15", "#f97316", "#f8fafc"];
      for (let x = -1; x <= 1; x++) for (let y = 0; y < 3; y++) for (let z = -1; z <= 1; z++) b.rbox(2.3, 2.3, 2.3, 0.3, x * 2.45, 1.2 + y * 2.45, z * 2.45, pick(r, stickers), { bucket: "gloss" });
    },
  },
  clips: {
    radius: 5,
    weight: 2,
    make(b, r) {
      for (let i = 0; i < 3; i++) b.torus(1.8, 0.22, (r() - 0.5) * 6, 0.25, (r() - 0.5) * 6, pick(r, ["#cbd5e1", "#f472b6", "#60a5fa"]), { bucket: "metal", rx: Math.PI / 2, ry: r() * 3, sx: 0.45 });
    },
  },
  cabinet: {
    radius: 18,
    weight: 2,
    farOnly: true,
    make(b, r) {
      const c = pick(r, ["#94a3b8", "#e2e8f0", "#475569"]);
      b.rbox(24, 52, 28, 0.6, 0, 26, 0, c);
      for (let i = 0; i < 3; i++) {
        b.rbox(21.5, 15, 0.8, 0.3, 0, 9.5 + i * 16.6, 14.1, c, { bucket: "gloss" });
        b.rbox(8, 1, 1.2, 0.3, 0, 13 + i * 16.6, 14.9, "#e5e7eb", { bucket: "metal" });
      }
      // Something on top to break the silhouette.
      b.rbox(14, 9, 10, 0.5, -3, 56.5, 0, "#b45309");
      b.rbox(15, 1, 11, 0.3, -3, 61.5, 0, "#92400e");
    },
  },
  chair: {
    radius: 17,
    weight: 2,
    farOnly: true,
    make(b, r) {
      const c = pick(r, ["#1f2937", "#1d4ed8", "#b91c1c", "#0f766e"]);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        b.rbox(13, 1.6, 2.2, 0.5, Math.cos(a) * 6.5, 2.6, Math.sin(a) * 6.5, "#111827", { ry: -a, bucket: "gloss" });
        b.sphere(1.7, Math.cos(a) * 12.5, 1.7, Math.sin(a) * 12.5, "#0b0d12", { bucket: "gloss", seg: 12 });
      }
      b.cyl(1.4, 1.4, 16, 0, 11, 0, "#cbd5e1", { bucket: "metal", seg: 14 });
      b.rbox(24, 4, 24, 1.6, 0, 21, 0, c);
      b.rbox(24, 26, 4, 1.6, 0, 37, -11, c, { rx: -0.12 });
      for (const side of [-1, 1]) {
        b.rbox(2, 8, 2, 0.4, side * 12.5, 26, -2, "#111827", { bucket: "gloss" });
        b.rbox(3, 1.6, 14, 0.6, side * 12.5, 30.5, 0, "#111827", { bucket: "gloss" });
      }
    },
  },
};

function weighted(r: Rand, far: boolean): Kind {
  const list = Object.values(KINDS).filter((k) => far || !k.farOnly);
  let total = 0;
  for (const k of list) total += k.weight * (far && k.farOnly ? 2.5 : 1);
  let t = r() * total;
  for (const k of list) {
    t -= k.weight * (far && k.farOnly ? 2.5 : 1);
    if (t <= 0) return k;
  }
  return list[0];
}

/** A desk tall enough to race under, straddling the circuit. */
function desk(b: Builder, r: Rand): void {
  b.rbox(76, 3.4, 42, 0.8, 0, 47, 0, "#a16207", { bucket: "gloss" });
  b.box(72, 5, 1.2, 0, 42.8, -19.5, "#854d0e");
  for (const [x, z] of [
    [-34, -17],
    [34, -17],
    [-34, 17],
    [34, 17],
  ]) {
    b.cyl(1.7, 1.7, 45.3, x, 22.65, z, "#cbd5e1", { bucket: "metal", seg: 16 });
    b.cyl(2.6, 2.6, 0.7, x, 0.35, z, "#64748b", { bucket: "metal", seg: 16 });
  }
  b.cyl(0.8, 0.8, 68, 0, 38, -17, "#cbd5e1", { bucket: "metal", rz: Math.PI / 2, seg: 10 });
  // Desktop clutter, seen from across the room.
  b.push(-16, 48.7, -4, 0.2);
  KINDS.monitor.make(b, r);
  b.pop();
  b.push(14, 48.7, 2, -0.5);
  KINDS.lamp.make(b, r);
  b.pop();
  b.push(26, 48.7, -8, 1);
  KINDS.mug.make(b, r);
  b.pop();
  b.push(-2, 48.7, 10, 0.1);
  KINDS.keyboard.make(b, r);
  b.pop();
}

function buildOffice(track: Track): { root: THREE.Group; textures: THREE.Texture[]; size: [number, number]; centre: [number, number] } {
  const r = mulberry(20261117);
  const bounds = trackBounds(track);
  const pad = 110;
  const x0 = bounds.minX - pad;
  const x1 = bounds.maxX + pad;
  const z0 = bounds.minZ - pad;
  const z1 = bounds.maxZ + pad;
  const W = x1 - x0;
  const D = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const H = 150;
  const wall = track.def.wallHalfWidth;
  const root = new THREE.Group();
  const textures: THREE.Texture[] = [];

  // --- Floor
  const wood = woodTexture();
  wood.repeat.set(W / 64, D / 64);
  textures.push(wood);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.38, metalness: 0.02 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0, cz);
  floor.receiveShadow = true;
  root.add(floor);

  // --- Rugs under parts of the circuit
  const rugs: [number, number, number, number, number, number][] = [
    [0.12, 170, 120, 0.3, 215, 0],
    [0.5, 190, 130, -0.2, 350, 0],
    [0.8, 160, 110, 0.5, 20, 0],
  ];
  for (const [at, w, d, yaw, hue] of rugs) {
    const i = Math.floor(at * track.n);
    const tex = rugTexture(hue);
    textures.push(tex);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    rug.rotation.set(-Math.PI / 2, 0, yaw);
    rug.position.set(track.px[i], 0.015, track.pz[i]);
    rug.receiveShadow = true;
    root.add(rug);
  }

  const b = new Builder(120);
  const placer = new Placer(track);

  // --- Room shell: walls, skirting, windows, ceiling lights
  const wallColor = "#ece4d6";
  b.push(cx, 0, cz);
  b.box(W + 8, H, 4, 0, H / 2, D / 2 + 2, wallColor);
  b.box(W + 8, H, 4, 0, H / 2, -D / 2 - 2, wallColor);
  b.box(4, H, D + 8, W / 2 + 2, H / 2, 0, wallColor);
  b.box(4, H, D + 8, -W / 2 - 2, H / 2, 0, wallColor);
  b.box(W, 7, 1.2, 0, 3.5, D / 2 - 0.6, "#fbf8f1", { bucket: "gloss" });
  b.box(W, 7, 1.2, 0, 3.5, -D / 2 + 0.6, "#fbf8f1", { bucket: "gloss" });
  b.box(1.2, 7, D, W / 2 - 0.6, 3.5, 0, "#fbf8f1", { bucket: "gloss" });
  b.box(1.2, 7, D, -W / 2 + 0.6, 3.5, 0, "#fbf8f1", { bucket: "gloss" });
  b.box(W + 8, 3, D + 8, 0, H + 1.5, 0, "#f5f1e8");
  b.pop();

  // Windows along the far (+z) wall and the +x wall: bright daylight panes.
  const windowsZ = Math.floor(W / 95);
  for (let i = 0; i < windowsZ; i++) {
    b.push(x0 + (i + 0.5) * (W / windowsZ), 0, z1, Math.PI);
    b.box(64, 84, 0.6, 0, 78, 0.6, "#d6ecff", { bucket: "glow", glow: 3.4 });
    b.rbox(70, 4, 3, 0.5, 0, 122, 1.4, "#f8fafc", { bucket: "gloss" });
    b.rbox(70, 4, 6, 0.5, 0, 34, 2.6, "#f8fafc", { bucket: "gloss" });
    for (const x of [-33, -11, 11, 33]) b.rbox(3, 88, 2.4, 0.4, x, 78, 1.2, "#f8fafc", { bucket: "gloss" });
    b.rbox(70, 2.4, 2.4, 0.4, 0, 92, 1.2, "#f8fafc", { bucket: "gloss" });
    b.pop();
  }
  const windowsX = Math.floor(D / 95);
  for (let i = 0; i < windowsX; i++) {
    b.push(x1, 0, z0 + (i + 0.5) * (D / windowsX), -Math.PI / 2);
    b.box(64, 84, 0.6, 0, 78, 0.6, "#ffe9c7", { bucket: "glow", glow: 3.8 });
    b.rbox(70, 4, 3, 0.5, 0, 122, 1.4, "#f8fafc", { bucket: "gloss" });
    b.rbox(70, 4, 6, 0.5, 0, 34, 2.6, "#f8fafc", { bucket: "gloss" });
    for (const x of [-33, -11, 11, 33]) b.rbox(3, 88, 2.4, 0.4, x, 78, 1.2, "#f8fafc", { bucket: "gloss" });
    b.pop();
  }
  // Framed posters on the other two walls, and a door.
  for (let i = 0; i < Math.floor(W / 120); i++) {
    b.push(x0 + (i + 0.5) * (W / Math.floor(W / 120)), 0, z0, 0);
    b.rbox(54, 38, 1.6, 0.6, 0, 82, 1, "#1f2937", { bucket: "gloss" });
    b.box(48, 32, 0.4, 0, 82, 1.9, pick(r, BRIGHTS));
    b.box(20, 20, 0.4, -8 + r() * 16, 80, 2.1, pick(r, ["#f8fafc", "#fde047", "#0f172a"]));
    b.pop();
  }
  for (let i = 0; i < Math.floor(D / 150); i++) {
    b.push(x0, 0, z0 + (i + 0.5) * (D / Math.floor(D / 150)), Math.PI / 2);
    if (i % 2 === 0) {
      b.rbox(46, 96, 2, 0.6, 0, 48, 1, "#8b5a2b", { bucket: "gloss" });
      b.sphere(1.8, 17, 46, 2.6, "#e5e7eb", { bucket: "metal" });
      b.rbox(52, 4, 3, 0.4, 0, 98, 1.2, "#f8fafc", { bucket: "gloss" });
    } else {
      b.rbox(40, 40, 1.6, 0.6, 0, 86, 1, "#1f2937", { bucket: "gloss" });
      b.box(34, 34, 0.4, 0, 86, 1.9, pick(r, BRIGHTS));
    }
    b.pop();
  }
  // Ceiling light panels.
  for (let x = x0 + 60; x < x1 - 30; x += 110) {
    for (let z = z0 + 55; z < z1 - 30; z += 95) {
      b.push(x, H, z);
      b.box(46, 0.6, 16, 0, -0.5, 0, "#fffaf0", { bucket: "glow", glow: 2.6 });
      b.box(50, 1.4, 20, 0, 0.3, 0, "#d6d3d1");
      b.pop();
    }
  }

  // Whiteboard on the near wall.
  const wb = whiteboardTexture();
  textures.push(wb);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(150, 75), new THREE.MeshStandardMaterial({ map: wb, roughness: 0.25 }));
  board.position.set(cx + 20, 80, z0 + 2.2);
  root.add(board);
  b.push(cx + 20, 0, z0);
  b.rbox(156, 81, 1.6, 0.6, 0, 80, 1, "#cbd5e1", { bucket: "metal" });
  b.rbox(150, 2.5, 5, 0.5, 0, 40, 3, "#cbd5e1", { bucket: "metal" });
  b.pop();

  // --- Desks straddling the circuit
  for (const at of [0.1, 0.285, 0.45, 0.63, 0.795, 0.94]) {
    for (let tries = 0; tries < 12; tries++) {
      const i = (Math.floor(at * track.n) + tries * 9) % track.n;
      const heading = Math.atan2(track.tx[i], track.tz[i]);
      const c = Math.cos(heading);
      const s = Math.sin(heading);
      const legs = [
        [-34, -17],
        [34, -17],
        [-34, 17],
        [34, 17],
      ].map(([lx, lz]) => [track.px[i] + lx * c + lz * s, track.pz[i] - lx * s + lz * c]);
      // Every leg must stand clear of the whole circuit, not just this stretch.
      if (!legs.every(([x, z]) => distanceToTrack(track, x, z) > wall + 5)) continue;
      // Only where the road is at floor level; raised sections need the headroom.
      if (Math.abs(track.hy[i]) > 1.5) continue;
      // Straight-ish stretches only, so the desk sits squarely across the road.
      const j = (i + 12) % track.n;
      if (track.tx[i] * track.tx[j] + track.tz[i] * track.tz[j] < 0.92) continue;
      for (const [x, z] of legs) placer.force(x, z, 4);
      b.push(track.px[i], 0, track.pz[i], heading);
      desk(b, r);
      b.pop();
      break;
    }
  }

  // --- Props lining the circuit, so there is always something sliding past
  for (let i = 0; i < track.n; i += 6) {
    for (const side of [-1, 1]) {
      if (r() < 0.2) continue;
      const kind = weighted(r, false);
      const lat = side * (wall + 3.5 + kind.radius + r() * 16);
      const x = track.px[i] + track.nx[i] * lat;
      const z = track.pz[i] + track.nz[i] * lat;
      if (!placer.claim(x, z, kind.radius)) continue;
      b.push(x, 0, z, r() * Math.PI * 2, 0.85 + r() * 0.4);
      kind.make(b, r);
      b.pop();
    }
  }
  // --- And the rest of the floor
  for (let n = 0; n < 900; n++) {
    const kind = weighted(r, true);
    const x = x0 + 14 + r() * (W - 28);
    const z = z0 + 14 + r() * (D - 28);
    if (!placer.claim(x, z, kind.radius + (kind.farOnly ? 6 : 2))) continue;
    b.push(x, 0, z, r() * Math.PI * 2, kind.farOnly ? 1 : 0.9 + r() * 0.5);
    kind.make(b, r);
    b.pop();
  }

  root.add(b.build());

  // Raised stretches of road stand on stacked-cardboard ramps that reach the floor.
  if (track.maxY > 1) {
    const card = new THREE.Color("#b98d5c");
    const card2 = new THREE.Color("#a67c4e");
    const colour = (i: number) => (Math.floor(i / 4) % 2 ? card : card2);
    const sides = mergeGeometries([strip(track, wall + 1, 0, wall + 1, 0, { absB: 0, color: colour }), strip(track, -wall - 1, 0, -wall - 1, 0, { absB: 0, color: colour })], false)!;
    sides.computeVertexNormals();
    const ramp = new THREE.Mesh(sides, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
    ramp.castShadow = true;
    ramp.receiveShadow = true;
    root.add(ramp);
  }
  return { root, textures, size: [W, D], centre: [cx, cz] };
}

export function OfficeTheme({ track, quality }: { track: Track; quality: Quality }) {
  const built = useMemo(() => buildOffice(track), [track]);
  useEffect(
    () => () => {
      disposeTree(built.root);
      for (const t of built.textures) t.dispose();
    },
    [built],
  );
  return (
    <>
      <color attach="background" args={["#efe7da"]} />
      <fog attach="fog" args={["#f1e9dc", 260, 1250]} />
      <hemisphereLight args={["#fff7ea", "#a88860", 0.62]} />
      <primitive object={built.root} />
      {/* Dust drifting in the sunlight. */}
      {quality !== "low" && <Sparkles count={420} scale={[built.size[0] * 0.9, 46, built.size[1] * 0.9]} position={[built.centre[0], 26, built.centre[1]]} size={22} speed={0.22} opacity={0.42} color="#fff4d6" />}
    </>
  );
}
