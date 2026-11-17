/**
 * Draws everything that moves on the track besides karts: hazards, item boxes
 * and things players have dropped or fired. Hazard positions come from the same
 * shared function the simulation uses, so what is drawn is what can hit you.
 */
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ENTITY, ENTITY_STRIDE, hazardPose, type Hazard, type HazardPose, type Track } from "@office-kart/shared";
import { net } from "../net/connection";
import { disposeTree } from "./builder";
import { strip } from "./TrackSurface";

const pose: HazardPose = { x: 0, y: 0, z: 0, lat: 0, ang: 0, on: true, warn: false };
const std = (color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...o });
const glow = (r: number, g: number, b: number, o: Partial<THREE.MeshBasicMaterialParameters> = {}) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), toneMapped: false, ...o });

function part(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** The thing that rolls or runs at you, by look. Built around the origin, radius r. */
function rollingBody(look: string, r: number): THREE.Object3D {
  const g = new THREE.Group();
  switch (look) {
    case "snowball":
      g.add(part(new THREE.SphereGeometry(r, 18, 14), std("#f8fbff", { roughness: 0.9 })));
      break;
    case "chair": {
      const dark = std("#1f2937");
      const cloth = std("#2563eb");
      g.add(part(new THREE.CylinderGeometry(r * 0.8, r * 0.8, 0.3, 5), dark, 0, -r + 0.3, 0));
      g.add(part(new THREE.CylinderGeometry(0.2, 0.2, r, 8), std("#cbd5e1", { metalness: 1, roughness: 0.3 }), 0, -r * 0.4, 0));
      g.add(part(new THREE.BoxGeometry(r * 1.5, 0.5, r * 1.5), cloth, 0, 0.1, 0));
      g.add(part(new THREE.BoxGeometry(r * 1.5, r * 1.5, 0.45), cloth, 0, r * 0.9, -r * 0.7));
      break;
    }
    case "cart":
      g.add(part(new THREE.BoxGeometry(r * 1.6, r * 1.3, r * 1.9), std("#e5e7eb"), 0, 0, 0));
      g.add(part(new THREE.BoxGeometry(r * 1.4, r * 0.5, r * 1.5), std("#111827"), 0, r * 0.85, 0));
      break;
    case "car":
      g.add(part(new THREE.BoxGeometry(r * 1.5, r * 0.8, r * 2.2), std("#0f172a", { metalness: 0.6, roughness: 0.3 }), 0, -r * 0.4, 0));
      g.add(part(new THREE.BoxGeometry(r * 1.3, r * 0.55, r * 1.1), glow(0.2, 2.6, 3), 0, r * 0.2, 0));
      g.add(part(new THREE.BoxGeometry(r * 1.52, 0.2, 0.2), glow(4, 0.4, 3), 0, -r * 0.3, r * 1.1));
      break;
    case "jelly":
      g.add(part(new THREE.SphereGeometry(r, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), new THREE.MeshStandardMaterial({ color: "#f9a8d4", transparent: true, opacity: 0.75, emissive: "#f472b6", emissiveIntensity: 0.6, side: THREE.DoubleSide })));
      for (let i = 0; i < 5; i++) g.add(part(new THREE.CylinderGeometry(0.12, 0.05, r * 1.6, 5), std("#f472b6"), Math.cos(i * 1.26) * r * 0.5, -r * 0.8, Math.sin(i * 1.26) * r * 0.5));
      break;
    case "fish": {
      const body = part(new THREE.SphereGeometry(r, 14, 10), std("#fb923c", { roughness: 0.4 }));
      body.scale.set(0.7, 0.8, 1.5);
      g.add(body);
      const tail = part(new THREE.ConeGeometry(r * 0.8, r * 1.2, 4), std("#f97316"), 0, 0, -r * 1.9);
      tail.rotation.x = Math.PI / 2;
      g.add(tail);
      g.add(part(new THREE.SphereGeometry(r * 0.16, 8, 6), std("#0f172a"), r * 0.5, r * 0.3, r * 0.9));
      g.add(part(new THREE.SphereGeometry(r * 0.16, 8, 6), std("#0f172a"), -r * 0.5, r * 0.3, r * 0.9));
      break;
    }
    case "pendulum":
      g.add(part(new THREE.SphereGeometry(r, 16, 12), std("#78716c", { metalness: 0.8, roughness: 0.35 })));
      g.add(part(new THREE.CylinderGeometry(0.25, 0.25, 16, 6), std("#44403c"), 0, 8 + r * 0.8, 0));
      for (let i = 0; i < 6; i++) {
        const s = part(new THREE.ConeGeometry(0.4, 1.1, 5), std("#a8a29e", { metalness: 0.9, roughness: 0.3 }), Math.cos(i * 1.05) * r, 0, Math.sin(i * 1.05) * r);
        s.rotation.z = -Math.PI / 2;
        s.rotation.y = -i * 1.05;
        g.add(s);
      }
      break;
    default:
      g.add(part(new THREE.IcosahedronGeometry(r, 1), std("#6b6f76", { roughness: 0.95, flatShading: true })));
  }
  return g;
}

const BAR_STYLE: Record<string, [string, string]> = {
  fan: ["#f1f5f9", "#475569"],
  table: ["#a16207", "#57534e"],
  propeller: ["#d4a017", "#57534e"],
  turbine: ["#f8fafc", "#94a3b8"],
  gear: ["#a8a29e", "#57534e"],
  bar: ["#ef4444", "#111827"],
};

interface Item {
  h: Hazard;
  obj: THREE.Object3D;
  beam?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  column?: THREE.Mesh;
  ring?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  piece?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
}

function build(track: Track) {
  const root = new THREE.Group();
  const items: Item[] = [];
  const wall = track.def.wallHalfWidth;
  const road = track.def.roadHalfWidth;
  for (const h of track.hazards) {
    const d = h.def;
    const heading = Math.atan2(track.tx[h.i0], track.tz[h.i0]);
    if (d.kind === "roller" || d.kind === "runner") {
      const obj = rollingBody(d.look ?? "boulder", d.radius);
      root.add(obj);
      items.push({ h, obj });
    } else if (d.kind === "spinner") {
      const [c1, c2] = BAR_STYLE[d.look ?? "bar"] ?? BAR_STYLE.bar;
      const obj = new THREE.Group();
      obj.position.set(h.x, h.y + 1.1, h.z);
      const wide = d.look === "table" ? 4 : 1;
      obj.add(part(new THREE.BoxGeometry(wide, 0.9, d.length), std(c1, { roughness: 0.4 })));
      obj.add(part(new THREE.CylinderGeometry(1, 1.2, 1.6, 12), std(c2, { metalness: 0.7, roughness: 0.4 })));
      for (const e of [-1, 1]) obj.add(part(new THREE.BoxGeometry(wide + 0.1, 1, 0.9), glow(3, 0.6, 0.3), 0, 0, (e * d.length) / 2));
      root.add(obj);
      const post = part(new THREE.CylinderGeometry(0.35, 0.5, 1.3, 8), std(c2), h.x, h.y + 0.5, h.z);
      root.add(post);
      items.push({ h, obj });
    } else if (d.kind === "gate") {
      const obj = new THREE.Group();
      obj.position.set(h.x, h.y, h.z);
      obj.rotation.y = heading;
      for (const s of [-1, 1]) obj.add(part(new THREE.BoxGeometry(1, 5, 1), std(d.look === "wall" ? "#78716c" : "#0f172a", { metalness: 0.5 }), s * (wall + 0.5), 2.5, 0));
      const beam = new THREE.Mesh(new THREE.PlaneGeometry(wall * 2, 3.4), glow(4, 0.3, 0.3, { transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
      beam.position.y = 1.9;
      obj.add(beam);
      root.add(obj);
      items.push({ h, obj, beam });
    } else if (d.kind === "geyser") {
      const obj = new THREE.Group();
      obj.position.set(h.x, h.y + 0.1, h.z);
      const ring = new THREE.Mesh(new THREE.RingGeometry(d.radius * 0.55, d.radius, 24).rotateX(-Math.PI / 2), glow(1, 1, 1, { transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
      const column = new THREE.Mesh(new THREE.CylinderGeometry(d.radius * 0.5, d.radius * 0.9, 16, 14, 1, true).translate(0, 8, 0), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
      obj.add(ring, column);
      root.add(obj);
      items.push({ h, obj, ring, column });
    } else {
      // Collapsing sections and moving platforms are pieces of road in their own right.
      const inside = (i: number) => (h.i0 <= h.i1 ? i >= h.i0 && i < h.i1 : i >= h.i0 || i < h.i1);
      const half = d.kind === "platform" ? d.halfWidth : road + 1.4;
      const geo = strip(track, -half, 0.05, half, 0.05, { includeDyn: true, skip: (i) => !inside(i) });
      geo.computeVertexNormals();
      const piece = new THREE.Mesh(geo, std(d.kind === "platform" ? "#64748b" : "#8b6b43", { roughness: 0.8, side: THREE.DoubleSide }));
      piece.receiveShadow = true;
      root.add(piece);
      items.push({ h, obj: piece, piece });
    }
  }

  // Item boxes
  const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1.7, 1.7, 1.7), new THREE.MeshPhysicalMaterial({ color: "#fde047", emissive: "#f59e0b", emissiveIntensity: 0.9, roughness: 0.15, transparent: true, opacity: 0.85 }), Math.max(1, track.boxes.length));
  boxes.frustumCulled = false;
  root.add(boxes);

  // Pool for dropped and fired things
  const pool: THREE.Mesh[] = [];
  const geos: Record<number, THREE.BufferGeometry> = {
    [ENTITY.SLIME]: new THREE.SphereGeometry(1.6, 14, 8).scale(1, 0.25, 1),
    [ENTITY.BANANA]: new THREE.ConeGeometry(0.7, 1.4, 6),
    [ENTITY.DECOY]: new THREE.BoxGeometry(1.7, 1.7, 1.7),
    [ENTITY.ORB]: new THREE.SphereGeometry(1, 14, 10),
    [ENTITY.ROCKET]: new THREE.ConeGeometry(0.5, 2, 8),
    [ENTITY.TORNADO]: new THREE.ConeGeometry(3.2, 9, 12, 1, true).rotateX(Math.PI).translate(0, 4.5, 0),
    [ENTITY.METEOR]: new THREE.RingGeometry(5.2, 6, 28).rotateX(-Math.PI / 2),
    [ENTITY.BLAST]: new THREE.SphereGeometry(1, 16, 12),
  };
  const mats: Record<number, THREE.Material> = {
    [ENTITY.SLIME]: std("#22c55e", { roughness: 0.1, emissive: "#16a34a", emissiveIntensity: 0.5 }),
    [ENTITY.BANANA]: std("#fde047", { roughness: 0.4 }),
    [ENTITY.DECOY]: new THREE.MeshPhysicalMaterial({ color: "#fde047", emissive: "#ef4444", emissiveIntensity: 0.9, roughness: 0.15, transparent: true, opacity: 0.85 }),
    [ENTITY.ORB]: glow(3, 0.6, 4),
    [ENTITY.ROCKET]: glow(4, 1.4, 0.3),
    [ENTITY.TORNADO]: new THREE.MeshBasicMaterial({ color: "#cbd5e1", transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
    [ENTITY.METEOR]: glow(4, 0.3, 0.2, { transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    [ENTITY.BLAST]: glow(4, 2.2, 0.6, { transparent: true, opacity: 0.45, depthWrite: false }),
  };
  for (let i = 0; i < 28; i++) {
    const m = new THREE.Mesh(geos[ENTITY.ORB], mats[ENTITY.ORB]);
    m.visible = false;
    root.add(m);
    pool.push(m);
  }
  return { root, items, boxes, pool, geos, mats };
}

const mat4 = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const euler = new THREE.Euler();
const v3 = new THREE.Vector3();
const scl = new THREE.Vector3();

export function Hazards({ track }: { track: Track }) {
  const built = useMemo(() => build(track), [track]);
  useEffect(() => () => disposeTree(built.root), [built]);

  useFrame((state) => {
    const t = net.hazardClock();
    const now = state.clock.elapsedTime;
    const blink = Math.sin(now * 22) > 0;
    for (const it of built.items) {
      const d = it.h.def;
      hazardPose(track, it.h, t, pose);
      if (d.kind === "roller" || d.kind === "runner") {
        it.obj.visible = pose.on;
        it.obj.position.set(pose.x, pose.y, pose.z);
        const look = d.look ?? "boulder";
        if (look === "boulder" || look === "snowball") it.obj.rotation.set(pose.ang, 0, pose.ang * 0.6);
        else if (look === "pendulum") it.obj.rotation.set(0, 0, 0);
        else it.obj.rotation.y = d.kind === "runner" ? Math.atan2(track.tx[it.h.i0], track.tz[it.h.i0]) + (it.h.span < 0 ? Math.PI : 0) : now * 1.5;
      } else if (d.kind === "spinner") {
        it.obj.rotation.y = pose.ang;
      } else if (d.kind === "gate" && it.beam) {
        // Solid red when shut, flashing amber just before it shuts, a faint outline when open.
        it.beam.material.opacity = pose.on ? 0.8 : pose.warn ? (blink ? 0.55 : 0.1) : 0.06;
        it.beam.material.color.setRGB(pose.on ? 4 : 4, pose.on ? 0.3 : 2.2, pose.on ? 0.3 : 0.2);
      } else if (d.kind === "geyser" && it.column && it.ring) {
        it.column.visible = pose.on;
        it.column.scale.y = 0.8 + Math.sin(now * 30) * 0.12;
        it.ring.material.color.setRGB(pose.on ? 3 : pose.warn && blink ? 4 : 0.9, pose.on ? 3 : pose.warn && blink ? 1.4 : 0.9, pose.on ? 3 : 0.9);
      } else if (it.piece) {
        if (d.kind === "collapse") {
          it.piece.visible = pose.on;
          it.piece.position.y = pose.warn ? Math.sin(now * 60) * 0.12 : 0;
          it.piece.material.color.set(pose.warn && blink ? "#ef4444" : "#8b6b43");
        } else {
          const mid = (it.h.i0 + Math.floor(Math.abs(it.h.span) / 2)) % track.n;
          it.piece.position.set(track.nx[mid] * pose.lat, 0, track.nz[mid] * pose.lat);
        }
      }
    }

    // Item boxes spin and bob; an empty one shrinks away until it refills.
    for (let i = 0; i < track.boxes.length; i++) {
      const b = track.boxes[i];
      const s = net.taken.has(i) ? 0.001 : 1 + Math.sin(now * 3 + i) * 0.06;
      quat.setFromEuler(euler.set(now * 1.3 + i, now * 1.9 + i * 0.5, 0));
      mat4.compose(v3.set(b.x, b.y + Math.sin(now * 2 + i) * 0.2, b.z), quat, scl.set(s, s, s));
      built.boxes.setMatrixAt(i, mat4);
    }
    built.boxes.instanceMatrix.needsUpdate = true;

    // Things players dropped or fired, and meteors.
    const e = net.entities;
    for (let i = 0; i < built.pool.length; i++) {
      const m = built.pool[i];
      const o = i * ENTITY_STRIDE;
      if (o >= e.length) {
        m.visible = false;
        continue;
      }
      const type = e[o + 1];
      m.visible = true;
      m.geometry = built.geos[type] ?? built.geos[ENTITY.ORB];
      m.material = built.mats[type] ?? built.mats[ENTITY.ORB];
      const ty = e[o + 3] + (type === ENTITY.METEOR ? 0.25 : type === ENTITY.SLIME ? 0.3 : 0.9);
      // Glide toward the latest reported position instead of jumping to it.
      if (m.userData.id === e[o]) m.position.lerp(v3.set(e[o + 2], ty, e[o + 4]), 0.45);
      else m.position.set(e[o + 2], ty, e[o + 4]);
      m.userData.id = e[o];
      m.scale.setScalar(type === ENTITY.BLAST ? e[o + 5] * (0.6 + ((now * 4) % 1) * 0.5) : 1);
      m.rotation.set(type === ENTITY.ROCKET ? Math.PI / 2 : 0, type === ENTITY.TORNADO || type === ENTITY.DECOY ? now * 9 : 0, 0);
      if (type === ENTITY.METEOR) m.visible = blink || e[o + 5] > 20;
    }
  });

  return <primitive object={built.root} />;
}
