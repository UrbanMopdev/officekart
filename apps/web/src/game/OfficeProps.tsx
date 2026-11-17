/**
 * Oversized office clutter around the circuit. Purely scenery: every prop is
 * placed outside the boundary walls, so none of it needs collision.
 */
import { useMemo } from "react";
import type { ReactNode } from "react";
import { locate, type Track } from "@office-kart/shared";
import { screenTexture } from "./textures";

type Kind = "mug" | "pencil" | "keyboard" | "monitor" | "notes" | "paper" | "plant" | "stapler" | "desk";

interface Prop {
  kind: Kind;
  x: number;
  z: number;
  rot: number;
  r: number;
  tint: number;
}

const RADIUS: Record<Kind, number> = { mug: 6, pencil: 15, keyboard: 15, monitor: 12, notes: 6, paper: 9, plant: 7, stapler: 9, desk: 30 };
const TINTS = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ec4899", "#14b8a6", "#f97316"];

function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function layout(track: Track): Prop[] {
  const rand = mulberry(20260117);
  const kinds: Kind[] = ["desk", "desk", "monitor", "monitor", "keyboard", "keyboard", "mug", "mug", "mug", "pencil", "pencil", "notes", "notes", "notes", "paper", "paper", "plant", "plant", "plant", "stapler"];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < track.n; i++) {
    minX = Math.min(minX, track.px[i]);
    maxX = Math.max(maxX, track.px[i]);
    minZ = Math.min(minZ, track.pz[i]);
    maxZ = Math.max(maxZ, track.pz[i]);
  }
  const pad = 70;
  const out: Prop[] = [];
  const loc = { idx: 0, along: 0, lateral: 0 };
  const clearance = track.def.wallHalfWidth + 3;
  for (let attempt = 0; attempt < 1400 && out.length < 95; attempt++) {
    const kind = kinds[Math.floor(rand() * kinds.length)];
    const r = RADIUS[kind];
    const x = minX - pad + rand() * (maxX - minX + pad * 2);
    const z = minZ - pad + rand() * (maxZ - minZ + pad * 2);
    locate(track, x, z, -1, loc);
    const dist = Math.hypot(x - track.px[loc.idx], z - track.pz[loc.idx]);
    if (dist < clearance + r) continue;
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 2)) continue;
    out.push({ kind, x, z, r, rot: rand() * Math.PI * 2, tint: Math.floor(rand() * TINTS.length) });
  }
  return out;
}

function Mug({ tint }: { tint: string }) {
  return (
    <group>
      <mesh position={[0, 4, 0]}>
        <cylinderGeometry args={[4, 3.6, 8, 20]} />
        <meshLambertMaterial color={tint} />
      </mesh>
      <mesh position={[0, 7.9, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[3.5, 20]} />
        <meshLambertMaterial color="#3b2416" />
      </mesh>
      <mesh position={[4.4, 4.2, 0]}>
        <torusGeometry args={[2.1, 0.6, 8, 16]} />
        <meshLambertMaterial color={tint} />
      </mesh>
    </group>
  );
}

function Pencil() {
  return (
    <group position={[0, 1, 0]} rotation-z={Math.PI / 2}>
      <mesh>
        <cylinderGeometry args={[1, 1, 24, 6]} />
        <meshLambertMaterial color="#facc15" />
      </mesh>
      <mesh position={[0, 13.5, 0]}>
        <coneGeometry args={[1, 3, 6]} />
        <meshLambertMaterial color="#fde68a" />
      </mesh>
      <mesh position={[0, 15.2, 0]}>
        <coneGeometry args={[0.4, 1, 6]} />
        <meshLambertMaterial color="#1f2937" />
      </mesh>
      <mesh position={[0, -13, 0]}>
        <cylinderGeometry args={[1.05, 1.05, 2, 10]} />
        <meshLambertMaterial color="#f472b6" />
      </mesh>
    </group>
  );
}

function Keyboard() {
  const keys: ReactNode[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 11; col++) {
      keys.push(
        <mesh key={`${row}-${col}`} position={[-10 + col * 2, 1.5, -3.3 + row * 2.2]}>
          <boxGeometry args={[1.6, 0.6, 1.8]} />
          <meshLambertMaterial color={(row + col) % 7 === 0 ? "#fbbf24" : "#e2e8f0"} />
        </mesh>,
      );
    }
  }
  return (
    <group>
      <mesh position={[0, 0.6, 0]}>
        <boxGeometry args={[24, 1.2, 10]} />
        <meshLambertMaterial color="#334155" />
      </mesh>
      {keys}
    </group>
  );
}

function Monitor({ seed }: { seed: number }) {
  const tex = useMemo(() => screenTexture(seed), [seed]);
  return (
    <group>
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[8, 1, 6]} />
        <meshLambertMaterial color="#475569" />
      </mesh>
      <mesh position={[0, 4, 0]}>
        <boxGeometry args={[1.6, 6, 1.2]} />
        <meshLambertMaterial color="#475569" />
      </mesh>
      <mesh position={[0, 12, 0]}>
        <boxGeometry args={[20, 12.5, 1.2]} />
        <meshLambertMaterial color="#1e293b" />
      </mesh>
      <mesh position={[0, 12, 0.65]}>
        <planeGeometry args={[18.6, 11.2]} />
        <meshBasicMaterial map={tex} />
      </mesh>
    </group>
  );
}

function Notes({ tint }: { tint: number }) {
  const colors = ["#fde047", "#f9a8d4", "#86efac", "#93c5fd"];
  return (
    <group>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[i * 0.5, 0.4 + i * 0.8, i * 0.4]} rotation-y={i * 0.25}>
          <boxGeometry args={[7, 0.8, 7]} />
          <meshLambertMaterial color={colors[(tint + i) % colors.length]} />
        </mesh>
      ))}
    </group>
  );
}

function Paper() {
  return (
    <group>
      <mesh position={[0, 1.6, 0]}>
        <boxGeometry args={[10, 3.2, 13]} />
        <meshLambertMaterial color="#f8fafc" />
      </mesh>
      <mesh position={[0.4, 3.4, 0.3]} rotation-y={0.12}>
        <boxGeometry args={[10, 0.4, 13]} />
        <meshLambertMaterial color="#e2e8f0" />
      </mesh>
    </group>
  );
}

function Plant() {
  return (
    <group>
      <mesh position={[0, 3, 0]}>
        <cylinderGeometry args={[4, 3, 6, 14]} />
        <meshLambertMaterial color="#c2410c" />
      </mesh>
      {[
        [0, 10, 0, 5],
        [3, 8, 1.5, 3.4],
        [-2.6, 8.4, -1.8, 3.6],
        [0.6, 13.5, -0.8, 3],
      ].map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y, z]}>
          <icosahedronGeometry args={[r, 1]} />
          <meshLambertMaterial color={i % 2 ? "#16a34a" : "#22c55e"} flatShading />
        </mesh>
      ))}
    </group>
  );
}

function Stapler({ tint }: { tint: string }) {
  return (
    <group>
      <mesh position={[0, 0.8, 0]}>
        <boxGeometry args={[14, 1.6, 4.4]} />
        <meshLambertMaterial color="#1f2937" />
      </mesh>
      <mesh position={[0.6, 3.4, 0]} rotation-z={0.12}>
        <boxGeometry args={[13.5, 2.4, 4]} />
        <meshLambertMaterial color={tint} />
      </mesh>
    </group>
  );
}

function Desk() {
  return (
    <group>
      <mesh position={[0, 20, 0]}>
        <boxGeometry args={[46, 2.4, 26]} />
        <meshLambertMaterial color="#b45309" />
      </mesh>
      {[
        [-21, -11],
        [21, -11],
        [-21, 11],
        [21, 11],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 9.4, z]}>
          <boxGeometry args={[2.2, 18.8, 2.2]} />
          <meshLambertMaterial color="#94a3b8" />
        </mesh>
      ))}
      <mesh position={[6, 21.8, 2]} rotation-y={0.3}>
        <boxGeometry args={[14, 1, 10]} />
        <meshLambertMaterial color="#f8fafc" />
      </mesh>
    </group>
  );
}

export function OfficeProps({ track }: { track: Track }) {
  const props = useMemo(() => layout(track), [track]);
  return (
    <group>
      {props.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]} rotation-y={p.rot}>
          {p.kind === "mug" && <Mug tint={TINTS[p.tint]} />}
          {p.kind === "pencil" && <Pencil />}
          {p.kind === "keyboard" && <Keyboard />}
          {p.kind === "monitor" && <Monitor seed={i} />}
          {p.kind === "notes" && <Notes tint={p.tint} />}
          {p.kind === "paper" && <Paper />}
          {p.kind === "plant" && <Plant />}
          {p.kind === "stapler" && <Stapler tint={TINTS[p.tint]} />}
          {p.kind === "desk" && <Desk />}
        </group>
      ))}
    </group>
  );
}
