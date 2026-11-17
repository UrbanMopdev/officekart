/**
 * Neon Nights environment: an elevated skyway above a city after dark.
 * Towers with lit windows, glowing arches over the road, light strips under
 * the deck, stars and a synthwave horizon. Scenery only; nothing collides.
 */
import { useEffect, useMemo } from "react";
import { Stars } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Track } from "@office-kart/shared";
import type { Quality } from "../../store";
import { Builder, disposeTree } from "../builder";
import { glowTexture, towerTexture } from "../textures";
import { strip } from "../TrackSurface";
import { distanceToTrack, mulberry } from "./placement";

const GROUND = -190;
const NEONS = ["#22d3ee", "#e879f9", "#facc15", "#fb7185", "#a78bfa", "#34d399"];

/** A box whose side faces tile the window texture at a fixed real-world size. */
function towerGeometry(w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  // Face order: +x, -x, +y, -y, +z, -z; four vertices each.
  for (let face = 0; face < 6; face++) {
    const across = face < 2 ? d : w;
    for (let k = 0; k < 4; k++) {
      const i = face * 4 + k;
      if (face === 2 || face === 3) uv.setXY(i, 0.01, 0.01); // dark roof
      else uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(across / 22)), uv.getY(i) * Math.max(1, Math.round(h / 44)));
    }
  }
  g.translate(0, h / 2, 0);
  return g;
}

function buildNeon(track: Track, day: boolean): { root: THREE.Group; textures: THREE.Texture[] } {
  const r = mulberry(8675309);
  const wall = track.def.wallHalfWidth;
  const root = new THREE.Group();
  const textures: THREE.Texture[] = [];

  // --- Sky dome with a glowing horizon
  const skyGeo = new THREE.SphereGeometry(1500, 32, 20);
  const pos = skyGeo.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  const top = new THREE.Color(day ? "#2f86ee" : "#03040c");
  const mid = new THREE.Color(day ? "#8cc4ff" : "#1a1040");
  const horizon = new THREE.Color(day ? "#e6f4ff" : "#c026d3").multiplyScalar(day ? 1 : 0.75);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, pos.getY(i) / 1500);
    if (t < 0.12) c.copy(horizon).lerp(mid, t / 0.12);
    else c.copy(mid).lerp(top, Math.min(1, (t - 0.12) / 0.4));
    if (pos.getY(i) < 0) c.copy(horizon).lerp(top, Math.min(1, -pos.getY(i) / 260));
    col.set([c.r, c.g, c.b], i * 3);
  }
  skyGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  root.add(sky);

  // --- Deck structure under the road
  const steel = new THREE.MeshStandardMaterial({ color: "#0c1020", roughness: 0.35, metalness: 0.8, side: THREE.DoubleSide });
  const deckGeo = mergeGeometries(
    [strip(track, wall + 1, 0, wall + 1, -3.2), strip(track, -wall - 1, -3.2, -wall - 1, 0), strip(track, wall + 1, -3.2, -wall - 1, -3.2), strip(track, -wall - 1.02, 0.02, wall + 1.02, 0.02)],
    false,
  )!;
  deckGeo.computeVertexNormals();
  const deck = new THREE.Mesh(deckGeo, steel);
  deck.receiveShadow = true;
  root.add(deck);

  const cyan = new THREE.Color("#22d3ee").multiplyScalar(4);
  const pink = new THREE.Color("#e879f9").multiplyScalar(4);
  const under = mergeGeometries(
    [strip(track, wall + 1.03, -1.1, wall + 1.03, -1.6, { color: () => cyan }), strip(track, -wall - 1.03, -1.6, -wall - 1.03, -1.1, { color: () => pink })],
    false,
  )!;
  root.add(new THREE.Mesh(under, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide })));

  const b = new Builder(260);

  // --- Support pylons and light arches
  for (let i = 0; i < track.n; i += 34) {
    if (track.gap[i] || track.dyn[i]) continue;
    b.push(track.px[i], track.hy[i], track.pz[i], Math.atan2(track.tx[i], track.tz[i]));
    b.cyl(2.6, 3.4, track.hy[i] - GROUND - 3, 0, (GROUND - track.hy[i] - 3) / 2, 0, day ? "#8a97ab" : "#0b0f1d", { bucket: "metal", seg: 12 });
    b.rbox(wall * 2 + 4, 2.4, 5, 0.5, 0, -4.4, 0, "#0b0f1d", { bucket: "metal" });
    b.torus(3.6, 0.3, 0, -14, 0, NEONS[(i / 34) % NEONS.length], { bucket: "glow", glow: 3.5, rx: Math.PI / 2 });
    b.pop();
  }
  const arches = 13;
  for (let k = 0; k < arches; k++) {
    const i = Math.floor(((k + 0.35) / arches) * track.n);
    const color = NEONS[k % 3];
    if (track.gap[i]) continue;
    b.push(track.px[i], track.hy[i], track.pz[i], Math.atan2(track.tx[i], track.tz[i]));
    b.torus(wall + 5.5, 0.55, 0, 0, 0, color, { bucket: "glow", glow: 4.5, arc: Math.PI });
    b.torus(wall + 7, 0.25, 0, 0, 0, "#f8fafc", { bucket: "glow", glow: 1.6, arc: Math.PI });
    for (const side of [-1, 1]) b.rbox(2.6, 4, 2.6, 0.4, side * (wall + 6.2), 0.5, 0, "#0b0f1d", { bucket: "metal" });
    b.pop();
  }

  // --- The city: instanced towers in four sizes
  const texA = towerTexture(3);
  const texB = towerTexture(17);
  textures.push(texA, texB);
  const classes: { w: number; h: number; d: number; tex: THREE.Texture; list: THREE.Matrix4[] }[] = [
    { w: 34, h: 330, d: 34, tex: texA, list: [] },
    { w: 60, h: 250, d: 44, tex: texB, list: [] },
    { w: 44, h: 170, d: 44, tex: texA, list: [] },
    { w: 76, h: 110, d: 56, tex: texB, list: [] },
  ];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (let gx = -11; gx <= 11; gx++) {
    for (let gz = -11; gz <= 11; gz++) {
      if (r() < 0.22) continue;
      const x = gx * 92 + (r() - 0.5) * 30;
      const z = gz * 92 + (r() - 0.5) * 30;
      const near = distanceToTrack(track, x, z);
      // Towers beside the road stay below deck level; the skyline rises further out.
      const allowed = near < wall + 62 ? [3, 2] : near < 200 ? [1, 2, 3, 0] : [0, 1, 2, 0, 1];
      const cls = classes[allowed[Math.floor(r() * allowed.length)]];
      const scaleY = 0.75 + r() * 0.5;
      const topY = GROUND + cls.h * scaleY;
      if (near < wall + 62 && topY > track.minY - 14) continue;
      q.setFromAxisAngle(up, r() < 0.5 ? 0 : Math.PI / 2);
      m.compose(new THREE.Vector3(x, GROUND, z), q, new THREE.Vector3(1, scaleY, 1));
      cls.list.push(m.clone());
      if (topY > 20) {
        b.push(x, topY, z);
        b.cyl(0.5, 0.8, 16, 0, 8, 0, "#1e293b", { bucket: "metal", seg: 6 });
        b.sphere(1.6, 0, 17, 0, "#ff3b3b", { bucket: "glow", glow: 5, seg: 8 });
        b.pop();
      }
      if (r() < 0.55) {
        // A vertical neon sign on one face.
        const signH = 30 + r() * 60;
        b.push(x, Math.min(topY - signH / 2 - 8, 40 + r() * 60), z, r() < 0.5 ? 0 : Math.PI / 2);
        b.box(3.5, signH, 1, cls.w / 2 + 1 + (r() < 0.5 ? 0 : -cls.w - 2), 0, (r() - 0.5) * cls.d * 0.6, NEONS[Math.floor(r() * NEONS.length)], { bucket: "glow", glow: 3 });
        b.pop();
      }
    }
  }
  for (const cls of classes) {
    if (cls.list.length === 0) continue;
    const mat = new THREE.MeshStandardMaterial({ color: day ? "#9fb2c9" : "#10131f", map: day ? null : cls.tex, emissive: "#ffffff", emissiveMap: cls.tex, emissiveIntensity: day ? 0.5 : 2.4, roughness: 0.3, metalness: 0.75 });
    const mesh = new THREE.InstancedMesh(towerGeometry(cls.w, cls.h, cls.d), mat, cls.list.length);
    cls.list.forEach((mat4, i) => mesh.setMatrixAt(i, mat4));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    root.add(mesh);
  }

  // --- Streets far below, and a moon
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200), new THREE.MeshStandardMaterial({ color: day ? "#5b6b80" : "#070914", roughness: 0.25, metalness: 0.8 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND;
  root.add(ground);
  for (let k = -12; k <= 12; k++) {
    b.push(0, GROUND + 0.6, 0);
    b.box(2200, 0.3, 2.2, 0, 0, k * 92 + 46, k % 2 ? "#f59e0b" : "#22d3ee", { bucket: "glow", glow: 1.5 });
    b.box(2.2, 0.3, 2200, k * 92 + 46, 0, 0, k % 2 ? "#e879f9" : "#f59e0b", { bucket: "glow", glow: 1.5 });
    b.pop();
  }
  if (!day) {
    b.push(-700, 520, 1050);
    b.sphere(90, 0, 0, 0, "#dbe4ff", { bucket: "glow", glow: 1.7, seg: 32 });
    b.pop();
  }

  root.add(b.build(false));

  const halo = glowTexture();
  textures.push(halo);
  const moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, color: "#8ea2ff", transparent: true, opacity: 0.5, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  moonGlow.position.set(-700, 520, 1050);
  moonGlow.scale.set(620, 620, 1);
  if (!day) root.add(moonGlow);

  return { root, textures };
}

export function NeonTheme({ track, quality }: { track: Track; quality: Quality }) {
  const day = track.def.theme === "sky";
  const built = useMemo(() => buildNeon(track, day), [track, day]);
  useEffect(
    () => () => {
      disposeTree(built.root);
      for (const t of built.textures) t.dispose();
    },
    [built],
  );
  return (
    <>
      <color attach="background" args={[day ? "#cfe6fb" : "#03040c"]} />
      <fog attach="fog" args={day ? ["#d3e8fb", 300, 1500] : ["#0a0b1c", 220, 1500]} />
      <hemisphereLight args={day ? ["#e8f4ff", "#7a8ba0", 1] : ["#7c8cff", "#220a3d", 0.75]} />
      <primitive object={built.root} />
      {!day && <Stars radius={1100} depth={200} count={quality === "low" ? 1200 : 3500} factor={14} saturation={0.5} fade speed={0.5} />}
    </>
  );
}
