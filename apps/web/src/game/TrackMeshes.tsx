import { useMemo } from "react";
import * as THREE from "three";
import type { Track } from "@office-kart/shared";
import { bannerTexture, boostTexture, carpetTexture, checkerTexture, roadTexture } from "./textures";

interface StripOptions {
  /** World units per texture repeat along the track. Omit for no UVs. */
  uvScale?: number;
  color?: (i: number) => THREE.Color;
}

/** A band of quads following the track between two lateral offsets. */
function stripGeometry(track: Track, latA: number, yA: number, latB: number, yB: number, opts: StripOptions = {}): THREE.BufferGeometry {
  const { n, px, pz, nx, nz, spacing } = track;
  const pos = new Float32Array(n * 18);
  const uv = opts.uvScale ? new Float32Array(n * 12) : null;
  const col = opts.color ? new Float32Array(n * 18) : null;
  let p = 0;
  let u = 0;
  let c = 0;
  const put = (i: number, lat: number, y: number, uu: number, vv: number, color?: THREE.Color) => {
    pos[p++] = px[i] + nx[i] * lat;
    pos[p++] = y;
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
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  if (uv) geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  if (col) geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function mergeStrips(strips: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const total = strips.reduce((s, g) => s + g.getAttribute("position").count, 0);
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of strips) {
    pos.set(g.getAttribute("position").array as Float32Array, o);
    nor.set(g.getAttribute("normal").array as Float32Array, o);
    col.set(g.getAttribute("color").array as Float32Array, o);
    o += g.getAttribute("position").count * 3;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return geo;
}

export function TrackMeshes({ track }: { track: Track }) {
  const built = useMemo(() => {
    const road = track.def.roadHalfWidth;
    const wall = track.def.wallHalfWidth;
    const wallTop = 1.5;
    const thick = 0.9;

    const roadGeo = stripGeometry(track, -road, 0.04, road, 0.04, { uvScale: 8 });
    const rug = new THREE.Color("#0d9488");
    const rugDark = new THREE.Color("#0f766e");
    const rugColor = (i: number) => (Math.floor(i / 3) % 2 ? rug : rugDark);
    const red = new THREE.Color("#ef4444");
    const white = new THREE.Color("#f8fafc");
    const blockColor = (i: number) => (Math.floor(i / 2) % 2 ? red : white);
    const capColor = (i: number) => (Math.floor(i / 2) % 2 ? new THREE.Color("#b91c1c") : new THREE.Color("#cbd5e1"));

    // Off-road shoulders (slow) on both sides, and the boundary walls.
    const shoulderGeo = mergeStrips([
      stripGeometry(track, -wall, 0.02, -road, 0.02, { color: rugColor }),
      stripGeometry(track, road, 0.02, wall, 0.02, { color: rugColor }),
    ]);
    const wallGeo = mergeStrips([
      stripGeometry(track, wall, 0, wall, wallTop, { color: blockColor }),
      stripGeometry(track, wall, wallTop, wall + thick, wallTop, { color: capColor }),
      stripGeometry(track, wall + thick, wallTop, wall + thick, 0, { color: blockColor }),
      stripGeometry(track, -wall, wallTop, -wall, 0, { color: blockColor }),
      stripGeometry(track, -wall - thick, wallTop, -wall, wallTop, { color: capColor }),
      stripGeometry(track, -wall - thick, 0, -wall - thick, wallTop, { color: blockColor }),
    ]);

    const roadTex = roadTexture();
    const carpet = carpetTexture();
    carpet.repeat.set(40, 40);

    const startHeading = Math.atan2(track.tx[0], track.tz[0]);
    const pads = track.pads.map((pad) => {
      const mid = Math.round((pad.i0 + pad.i1) / 2) % track.n;
      return {
        x: track.px[mid] + track.nx[mid] * pad.lateral,
        z: track.pz[mid] + track.nz[mid] * pad.lateral,
        heading: Math.atan2(track.tx[mid], track.tz[mid]),
        width: pad.halfWidth * 2,
        length: (pad.i1 - pad.i0) * track.spacing,
      };
    });
    return { roadGeo, shoulderGeo, wallGeo, roadTex, carpet, startHeading, pads, checker: checkerTexture(), boost: boostTexture(), banner: bannerTexture(track.def.name.toUpperCase()) };
  }, [track]);

  const road = track.def.roadHalfWidth;
  const wall = track.def.wallHalfWidth;

  return (
    <group>
      {/* Office floor */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]}>
        <planeGeometry args={[900, 900]} />
        <meshLambertMaterial map={built.carpet} />
      </mesh>
      <mesh geometry={built.shoulderGeo}>
        <meshLambertMaterial vertexColors />
      </mesh>
      <mesh geometry={built.roadGeo}>
        <meshLambertMaterial map={built.roadTex} />
      </mesh>
      <mesh geometry={built.wallGeo}>
        <meshLambertMaterial vertexColors side={THREE.DoubleSide} />
      </mesh>

      {/* Start / finish line and gantry */}
      <group position={[track.px[0], 0, track.pz[0]]} rotation-y={built.startHeading}>
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.06, 0]}>
          <planeGeometry args={[road * 2, 3.2]} />
          <meshBasicMaterial map={built.checker} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * (wall + 0.6), 5, 0]}>
            <boxGeometry args={[1, 10, 1]} />
            <meshLambertMaterial color="#fbbf24" />
          </mesh>
        ))}
        <mesh position={[0, 9.2, 0]}>
          <boxGeometry args={[wall * 2 + 2.2, 2.6, 0.5]} />
          <meshLambertMaterial color="#4f46e5" />
        </mesh>
        <mesh position={[0, 9.2, -0.27]} rotation-y={Math.PI}>
          <planeGeometry args={[wall * 2 + 1.4, 2.3]} />
          <meshBasicMaterial map={built.banner} />
        </mesh>
        <mesh position={[0, 9.2, 0.27]}>
          <planeGeometry args={[wall * 2 + 1.4, 2.3]} />
          <meshBasicMaterial map={built.banner} />
        </mesh>
      </group>

      {/* Boost pads */}
      {built.pads.map((pad, i) => (
        <mesh key={i} position={[pad.x, 0.07, pad.z]} rotation={[-Math.PI / 2, 0, pad.heading + Math.PI]}>
          <planeGeometry args={[pad.width, pad.length]} />
          <meshBasicMaterial map={built.boost} />
        </mesh>
      ))}
    </group>
  );
}
