/**
 * Track geometry shared by the client (rendering + prediction) and the server
 * (authoritative simulation). A track is a closed centreline, sampled at an
 * even spacing, with a road half-width and a wall half-width. Everything the
 * simulation needs (boundaries, checkpoints, starting grid, boost pads, reset
 * points) is derived from the same data on both sides, so they cannot disagree.
 */

export interface BoostPadDef {
  /** Position along the lap, 0..1. */
  at: number;
  /** Offset from the centreline; positive is the right-hand side. */
  lateral: number;
  halfWidth: number;
  /** Length along the track, world units. */
  length: number;
}

export type TrackTheme = "office" | "neon" | "sky" | "alpine" | "volcano" | "frozen" | "jungle" | "sea" | "chaos";

/** Road surfaces. The index is what the simulation stores. */
export const SURFACE_TYPES = ["asphalt", "dirt", "mud", "ice", "snow", "sand", "boost", "oil", "conveyor", "conveyorBack"] as const;
export type SurfaceType = (typeof SURFACE_TYPES)[number];

/** A height key: at lap fraction `at` the road is `y` high. "linear" makes the stretch ending here a straight ramp. */
export type ElevationKey = [at: number, y: number, mode?: "linear"];

export interface SurfaceDef {
  type: SurfaceType;
  from: number;
  to: number;
  /** Lateral range it covers; omit for the full road width. Positive is right. */
  lateral?: [number, number];
}

export interface GapDef {
  /** The road is missing between these lap fractions: clear it in the air or fall. */
  from: number;
  to: number;
  /** Where a kart that falls is put back (start of the run-up). */
  respawn: number;
}

/** Moving hazards. All motion is a fixed function of race time, so every player sees the same thing. */
export type HazardDef =
  /** Rolls from side to side across the road. */
  | { kind: "roller"; at: number; radius: number; period: number; amp: number; phase?: number; look?: string }
  /** Travels along the road between two lap fractions, then starts again. from > to runs against the traffic. */
  | { kind: "runner"; from: number; to: number; lateral: number; radius: number; period: number; phase?: number; look?: string }
  /** A bar spinning flat over the road. */
  | { kind: "spinner"; at: number; lateral?: number; length: number; period: number; phase?: number; look?: string }
  /** A barrier across the whole road that switches on and off. `open` is the fraction of each cycle it is off. */
  | { kind: "gate"; at: number; period: number; open: number; phase?: number; look?: string }
  /** Launches karts into the air while it is erupting. */
  | { kind: "geyser"; at: number; lateral: number; radius: number; period: number; active: number; power: number; phase?: number }
  /** A stretch of road that drops away for part of each cycle. `solid` is the fraction it is there. */
  | { kind: "collapse"; from: number; to: number; period: number; solid: number; phase?: number }
  /** A bridge over a gap that slides from side to side. */
  | { kind: "platform"; from: number; to: number; halfWidth: number; amp: number; period: number; phase?: number };

/** A stretch where karts are pushed sideways: crosswinds, fans, underwater currents. */
export interface WindDef {
  from: number;
  to: number;
  /** Sideways push in m/s; positive is to the right. */
  push: number;
  /** Seconds per gust cycle; omit for a steady push. */
  period?: number;
}

export interface Hazard {
  def: HazardDef;
  i0: number;
  i1: number;
  /** Samples covered (i0 to i1 going forwards). */
  span: number;
  x: number;
  y: number;
  z: number;
}

export interface HazardPose {
  x: number;
  y: number;
  z: number;
  /** Sideways offset for rollers and platforms; rotation for spinners. */
  lat: number;
  ang: number;
  /** Dangerous / erupting / solid, depending on the kind. */
  on: boolean;
  /** About to change state: show a warning. */
  warn: boolean;
}

export interface ItemBox {
  x: number;
  y: number;
  z: number;
  idx: number;
}

export interface OpenSideDef {
  from: number;
  to: number;
  /** Which barrier is missing: -1 left, 1 right, 0 both. */
  side: -1 | 0 | 1;
}

export interface TrackDef {
  id: string;
  name: string;
  /** Which environment the client builds around the circuit. */
  theme: TrackTheme;
  /** One-line description shown in the lobby. */
  blurb: string;
  /** Closed loop of centreline control points [x, z], in driving order. */
  controlPoints: [number, number][];
  roadHalfWidth: number;
  wallHalfWidth: number;
  checkpointCount: number;
  defaultLaps: number;
  boostPads: BoostPadDef[];
  difficulty?: "Easy" | "Medium" | "Hard" | "Extreme" | "Insane";
  /** Road height round the lap. Omit for a flat track. */
  elevation?: ElevationKey[];
  /** 0..1: how strongly corners are banked automatically. */
  autoBank?: number;
  surfaces?: SurfaceDef[];
  gaps?: GapDef[];
  openSides?: OpenSideDef[];
  hazards?: HazardDef[];
  winds?: WindDef[];
  /** Karts below this height are under water. */
  waterLevel?: number;
  /** Lap fractions with a row of item boxes. Defaults to six evenly spaced rows. */
  itemRows?: number[];
  /** Short labels for the lobby preview. */
  features?: string[];
  music?: number;
}

export interface SurfaceZone {
  i0: number;
  i1: number;
  latMin: number;
  latMax: number;
  type: number;
}

export interface GridSlot {
  x: number;
  z: number;
  heading: number;
  idx: number;
}

export interface BoostPad {
  i0: number;
  i1: number;
  lateral: number;
  halfWidth: number;
}

export interface Track {
  def: TrackDef;
  /** Number of centreline samples. */
  n: number;
  /** Distance between consecutive samples. */
  spacing: number;
  length: number;
  px: Float64Array;
  pz: Float64Array;
  /** Unit tangent (driving direction). */
  tx: Float64Array;
  tz: Float64Array;
  /** Unit normal pointing to the right of the driving direction. */
  nx: Float64Array;
  nz: Float64Array;
  /** Sample indices of the checkpoints. checkpoints[0] is the start/finish line. */
  checkpoints: number[];
  grid: GridSlot[];
  pads: BoostPad[];
  /** Road height at each sample, and its slope in the driving direction (rise over run). */
  hy: Float64Array;
  slope: Float64Array;
  /** Banking: height gained per metre to the right of the centreline. */
  bankT: Float64Array;
  /** 1 where the road is missing. */
  gap: Uint8Array;
  /** 1 where a kart must not be respawned (a gap or the run-up to one). */
  unsafe: Uint8Array;
  /** Where to respawn for each unsafe sample. */
  respawnAt: Int32Array;
  /** Missing barriers: bit 1 = left open, bit 2 = right open. */
  open: Uint8Array;
  zones: SurfaceZone[];
  minY: number;
  maxY: number;
  hazards: Hazard[];
  /** 1 where the road is drawn and simulated by a hazard (collapsing section, moving platform). */
  dyn: Uint8Array;
  winds: { i0: number; i1: number; push: number; period: number }[];
  boxes: ItemBox[];
  waterLevel: number;
}

export interface Located {
  idx: number;
  /** Distance past sample `idx` along the tangent. */
  along: number;
  /** Signed distance from the centreline; positive is right. */
  lateral: number;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export function buildTrack(def: TrackDef, targetSpacing = 2): Track {
  const cps = def.controlPoints;
  const m = cps.length;
  const perSeg = 32;

  // 1. Dense Catmull-Rom sampling of the closed loop.
  const dx: number[] = [];
  const dz: number[] = [];
  for (let i = 0; i < m; i++) {
    const a = cps[(i - 1 + m) % m];
    const b = cps[i];
    const c = cps[(i + 1) % m];
    const d = cps[(i + 2) % m];
    for (let j = 0; j < perSeg; j++) {
      const t = j / perSeg;
      dx.push(catmullRom(a[0], b[0], c[0], d[0], t));
      dz.push(catmullRom(a[1], b[1], c[1], d[1], t));
    }
  }
  const dn = dx.length;
  const cum = new Float64Array(dn + 1);
  for (let i = 0; i < dn; i++) {
    const j = (i + 1) % dn;
    cum[i + 1] = cum[i] + Math.hypot(dx[j] - dx[i], dz[j] - dz[i]);
  }
  const length = cum[dn];

  // 2. Resample at an even arc-length spacing.
  const n = Math.round(length / targetSpacing);
  const spacing = length / n;
  const px = new Float64Array(n);
  const pz = new Float64Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const s = i * spacing;
    while (k < dn - 1 && cum[k + 1] < s) k++;
    const segLen = cum[k + 1] - cum[k] || 1;
    const t = (s - cum[k]) / segLen;
    const j = (k + 1) % dn;
    px[i] = dx[k] + (dx[j] - dx[k]) * t;
    pz[i] = dz[k] + (dz[j] - dz[k]) * t;
  }

  // 3. Tangents and right-hand normals.
  const tx = new Float64Array(n);
  const tz = new Float64Array(n);
  const nx = new Float64Array(n);
  const nz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n;
    const b = (i + 1) % n;
    let ax = px[b] - px[a];
    let az = pz[b] - pz[a];
    const l = Math.hypot(ax, az) || 1;
    ax /= l;
    az /= l;
    tx[i] = ax;
    tz[i] = az;
    nx[i] = -az;
    nz[i] = ax;
  }

  // 4. Checkpoints, evenly spaced; index 0 is the start/finish line.
  const checkpoints: number[] = [];
  for (let c = 0; c < def.checkpointCount; c++) {
    checkpoints.push(Math.round((c * n) / def.checkpointCount) % n);
  }

  // 4b. Height profile, slope, banking, gaps and open edges.
  const hy = new Float64Array(n);
  const keys = (def.elevation ?? []).slice().sort((a, b) => a[0] - b[0]);
  if (keys.length > 0) {
    for (let i = 0; i < n; i++) {
      const u = i / n;
      let k1 = keys.findIndex((k) => k[0] > u);
      if (k1 < 0) k1 = 0;
      const b = keys[k1];
      const a = keys[(k1 - 1 + keys.length) % keys.length];
      const a0 = a[0] > u ? a[0] - 1 : a[0];
      const b0 = b[0] <= u ? b[0] + 1 : b[0];
      let t = b0 > a0 ? (u - a0) / (b0 - a0) : 0;
      if (b[2] !== "linear") t = t * t * (3 - 2 * t);
      hy[i] = a[1] + (b[1] - a[1]) * t;
    }
  }
  const bankT = new Float64Array(n);
  if (def.autoBank) {
    const raw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i - 2 + n) % n;
      const c = (i + 2) % n;
      // Signed curvature: positive when the road bends right. Raise the outside edge.
      const curve = ((tx[c] - tx[a]) * nx[i] + (tz[c] - tz[a]) * nz[i]) / (4 * spacing);
      // Banking is gentle: enough to see and feel, not enough to turn every corner exit into a ramp.
      raw[i] = -Math.max(-0.085, Math.min(0.085, curve * 3)) * def.autoBank;
    }
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let o = -8; o <= 8; o++) sum += raw[(i + o + n) % n];
      bankT[i] = sum / 17;
    }
    // A banked corner tilts about its inside edge: the outside rises and the inside stays at the
    // height the layout gave it, so the low side of the road never sinks into the ground.
    // (Barely-there banking on a near-straight is not lifted, which keeps the grid level.)
    for (let i = 0; i < n; i++) hy[i] += Math.max(0, Math.abs(bankT[i]) - 0.015) * def.wallHalfWidth;
  }
  const slope = new Float64Array(n);
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    slope[i] = (hy[(i + 1) % n] - hy[(i - 1 + n) % n]) / (2 * spacing);
    minY = Math.min(minY, hy[i]);
    maxY = Math.max(maxY, hy[i]);
  }
  const idxOf = (at: number) => ((Math.round(at * n) % n) + n) % n;
  const gap = new Uint8Array(n);
  const unsafe = new Uint8Array(n);
  const respawnAt = new Int32Array(n);
  for (const g of def.gaps ?? []) {
    const r = idxOf(g.respawn);
    for (let i = idxOf(g.from); i !== idxOf(g.to); i = (i + 1) % n) gap[i] = 1;
    for (let i = (r + 1) % n; i !== (idxOf(g.to) + 3) % n; i = (i + 1) % n) {
      unsafe[i] = 1;
      respawnAt[i] = r;
    }
  }
  const open = new Uint8Array(n);
  for (const o of def.openSides ?? []) {
    for (let i = idxOf(o.from); i !== idxOf(o.to); i = (i + 1) % n) open[i] |= o.side < 0 ? 1 : o.side > 0 ? 2 : 3;
  }
  const zones: SurfaceZone[] = (def.surfaces ?? []).map((z) => ({
    i0: idxOf(z.from),
    i1: idxOf(z.to),
    latMin: z.lateral ? z.lateral[0] : -Infinity,
    latMax: z.lateral ? z.lateral[1] : Infinity,
    type: SURFACE_TYPES.indexOf(z.type),
  }));

  // 4c. Moving hazards, wind zones and item boxes.
  const dyn = new Uint8Array(n);
  const hazards: Hazard[] = (def.hazards ?? []).map((h) => {
    const i0 = idxOf("at" in h ? h.at : h.from);
    const i1 = idxOf("at" in h ? h.at : h.to);
    const forward = (i1 - i0 + n) % n;
    const span = h.kind === "runner" && h.from > h.to ? forward - n : forward;
    if (h.kind === "collapse" || h.kind === "platform") {
      for (let i = i0; i !== i1; i = (i + 1) % n) dyn[i] = 1;
      // Never respawn a kart on or just before a section that may not be there.
      const r = (i0 - 12 + n) % n;
      for (let i = (r + 1) % n; i !== (i1 + 3) % n; i = (i + 1) % n) {
        unsafe[i] = 1;
        respawnAt[i] = r;
      }
    }
    const lat = "lateral" in h && h.lateral ? h.lateral : 0;
    return { def: h, i0, i1, span, x: px[i0] + nx[i0] * lat, y: hy[i0] + lat * bankT[i0], z: pz[i0] + nz[i0] * lat };
  });
  const winds = (def.winds ?? []).map((w) => ({ i0: idxOf(w.from), i1: idxOf(w.to), push: w.push, period: w.period ?? 0 }));
  const boxes: ItemBox[] = [];
  for (const at of def.itemRows ?? [0.09, 0.26, 0.42, 0.58, 0.74, 0.91]) {
    const i = idxOf(at);
    if (gap[i] || dyn[i]) continue;
    for (const lat of [-4.8, -1.6, 1.6, 4.8]) boxes.push({ x: px[i] + nx[i] * lat, y: hy[i] + lat * bankT[i] + 1.3, z: pz[i] + nz[i] * lat, idx: i });
  }

  const track: Track = { def, n, spacing, length, px, pz, tx, tz, nx, nz, checkpoints, grid: [], pads: [], hy, slope, bankT, gap, unsafe, respawnAt, open, zones, minY, maxY, hazards, dyn, winds, boxes, waterLevel: def.waterLevel ?? -Infinity };

  // 5. Starting grid for 12: two staggered columns behind the line.
  for (let slot = 0; slot < 12; slot++) {
    const row = Math.floor(slot / 2);
    const right = slot % 2 === 1;
    const back = 6 + row * 5 + (right ? 2.5 : 0);
    const lateral = right ? 3.2 : -3.2;
    const fi = (((-back / spacing) % n) + n) % n;
    const idx = Math.floor(fi) % n;
    const along = (fi - Math.floor(fi)) * spacing;
    track.grid.push({
      x: px[idx] + tx[idx] * along + nx[idx] * lateral,
      z: pz[idx] + tz[idx] * along + nz[idx] * lateral,
      heading: Math.atan2(tx[idx], tz[idx]),
      idx,
    });
  }

  // 6. Boost pads as index ranges.
  for (const pad of def.boostPads) {
    const i0 = Math.round(pad.at * n) % n;
    const i1 = i0 + Math.max(1, Math.round(pad.length / spacing));
    track.pads.push({ i0, i1, lateral: pad.lateral, halfWidth: pad.halfWidth });
  }

  return track;
}

/**
 * Find where (x, z) sits relative to the centreline. With a valid `hint` the
 * search is limited to a window around it, which keeps a kart's track position
 * continuous: it can never "jump" to another part of the circuit that happens
 * to be nearby, so course-cutting cannot be mistaken for progress.
 */
export function locate(track: Track, x: number, z: number, hint: number, out: Located, window = 14): Located {
  const { n, px, pz } = track;
  let best = 0;
  let bestD = Infinity;
  if (hint < 0 || hint >= n) {
    for (let i = 0; i < n; i++) {
      const ddx = x - px[i];
      const ddz = z - pz[i];
      const d = ddx * ddx + ddz * ddz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  } else {
    for (let o = -window; o <= window; o++) {
      const i = (hint + o + n) % n;
      const ddx = x - px[i];
      const ddz = z - pz[i];
      const d = ddx * ddx + ddz * ddz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  const rx = x - px[best];
  const rz = z - pz[best];
  out.idx = best;
  out.along = rx * track.tx[best] + rz * track.tz[best];
  out.lateral = rx * track.nx[best] + rz * track.nz[best];
  return out;
}

/** Shortest signed difference between two positions on a loop of length n. */
export function wrapDelta(a: number, b: number, n: number): number {
  let d = a - b;
  if (d > n / 2) d -= n;
  else if (d < -n / 2) d += n;
  return d;
}

/** True when a kart at (idx, lateral) is on a boost pad. */
export function onBoostPad(track: Track, idx: number, lateral: number): boolean {
  for (const pad of track.pads) {
    if (idx >= pad.i0 && idx <= pad.i1 && Math.abs(lateral - pad.lateral) <= pad.halfWidth) return true;
  }
  return false;
}

/** Surface index under a kart at (idx, lateral). 0 is plain asphalt. */
export function surfaceAt(track: Track, idx: number, lateral: number): number {
  for (const z of track.zones) {
    const inside = z.i0 <= z.i1 ? idx >= z.i0 && idx <= z.i1 : idx >= z.i0 || idx <= z.i1;
    if (inside && lateral >= z.latMin && lateral <= z.latMax) return z.type;
  }
  return 0;
}

const frac = (v: number) => v - Math.floor(v);
const TAU = Math.PI * 2;

/** Where a hazard is, and what it is doing, at race time `time` (seconds). */
export function hazardPose(track: Track, h: Hazard, time: number, out: HazardPose): HazardPose {
  const d = h.def;
  const cyc = frac(time / d.period + (d.phase ?? 0));
  out.x = h.x;
  out.y = h.y;
  out.z = h.z;
  out.lat = 0;
  out.ang = 0;
  out.on = true;
  out.warn = false;
  switch (d.kind) {
    case "roller": {
      out.lat = d.amp * Math.sin(cyc * TAU);
      out.x = track.px[h.i0] + track.nx[h.i0] * out.lat;
      out.z = track.pz[h.i0] + track.nz[h.i0] * out.lat;
      out.y = track.hy[h.i0] + out.lat * track.bankT[h.i0] + d.radius;
      out.ang = out.lat / d.radius;
      break;
    }
    case "runner": {
      const f = (((h.i0 + h.span * cyc) % track.n) + track.n) % track.n;
      const i = Math.floor(f);
      const j = (i + 1) % track.n;
      const k = f - i;
      out.x = track.px[i] + (track.px[j] - track.px[i]) * k + track.nx[i] * d.lateral;
      out.z = track.pz[i] + (track.pz[j] - track.pz[i]) * k + track.nz[i] * d.lateral;
      out.y = track.hy[i] + (track.hy[j] - track.hy[i]) * k + d.radius;
      out.ang = (h.span * cyc * track.spacing) / d.radius;
      // Fade in and out at the ends of the run so it never pops into a kart.
      out.on = cyc > 0.03 && cyc < 0.97;
      break;
    }
    case "spinner":
      out.ang = cyc * TAU;
      out.y = h.y + 1.1;
      break;
    case "gate":
      out.on = cyc >= d.open;
      out.warn = cyc >= d.open - 0.14 && cyc < d.open;
      break;
    case "geyser":
      out.on = cyc < d.active;
      out.warn = cyc > 0.84;
      break;
    case "collapse":
      out.on = cyc < d.solid;
      out.warn = cyc > d.solid - 0.16 && cyc < d.solid;
      break;
    case "platform":
      out.lat = d.amp * Math.sin(cyc * TAU);
      break;
  }
  return out;
}

const poseScratch: HazardPose = { x: 0, y: 0, z: 0, lat: 0, ang: 0, on: true, warn: false };

/**
 * Height of the road under a point described by `locate`. Returns -Infinity
 * where there is no road: inside a gap, beyond a missing barrier, on a section
 * that has dropped away, or beside a moving platform.
 */
export function groundHeight(track: Track, idx: number, along: number, lateral: number, time = 0): number {
  const { n, hy } = track;
  if (track.gap[idx]) return -Infinity;
  if (track.dyn[idx]) {
    for (const h of track.hazards) {
      const k = h.def.kind;
      if (k !== "collapse" && k !== "platform") continue;
      const inside = h.i0 <= h.i1 ? idx >= h.i0 && idx < h.i1 : idx >= h.i0 || idx < h.i1;
      if (!inside) continue;
      hazardPose(track, h, time, poseScratch);
      if (k === "collapse" && !poseScratch.on) return -Infinity;
      if (h.def.kind === "platform" && Math.abs(lateral - poseScratch.lat) > h.def.halfWidth) return -Infinity;
    }
  }
  const o = track.open[idx];
  if (o !== 0) {
    const edge = track.def.wallHalfWidth + 0.4;
    if ((lateral < -edge && (o & 1) !== 0) || (lateral > edge && (o & 2) !== 0)) return -Infinity;
  }
  const f = along / track.spacing;
  const h = f >= 0 ? hy[idx] + (hy[(idx + 1) % n] - hy[idx]) * f : hy[idx] + (hy[idx] - hy[(idx - 1 + n) % n]) * f;
  return h + lateral * track.bankT[idx];
}
