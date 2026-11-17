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

export type TrackTheme = "office" | "neon" | "alpine";

/** Road surfaces. The index is what the simulation stores. */
export const SURFACE_TYPES = ["asphalt", "dirt", "mud", "ice", "snow", "sand", "boost"] as const;
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
  difficulty?: "Easy" | "Medium" | "Hard" | "Extreme";
  /** Road height round the lap. Omit for a flat track. */
  elevation?: ElevationKey[];
  /** 0..1: how strongly corners are banked automatically. */
  autoBank?: number;
  surfaces?: SurfaceDef[];
  gaps?: GapDef[];
  openSides?: OpenSideDef[];
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
  const slope = new Float64Array(n);
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    slope[i] = (hy[(i + 1) % n] - hy[(i - 1 + n) % n]) / (2 * spacing);
    minY = Math.min(minY, hy[i]);
    maxY = Math.max(maxY, hy[i]);
  }
  const bankT = new Float64Array(n);
  if (def.autoBank) {
    const raw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i - 2 + n) % n;
      const c = (i + 2) % n;
      // Signed curvature: positive when the road bends right. Raise the outside edge.
      const curve = ((tx[c] - tx[a]) * nx[i] + (tz[c] - tz[a]) * nz[i]) / (4 * spacing);
      raw[i] = -Math.max(-0.3, Math.min(0.3, curve * 7.5)) * def.autoBank;
    }
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let o = -8; o <= 8; o++) sum += raw[(i + o + n) % n];
      bankT[i] = sum / 17;
    }
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

  const track: Track = { def, n, spacing, length, px, pz, tx, tz, nx, nz, checkpoints, grid: [], pads: [], hy, slope, bankT, gap, unsafe, respawnAt, open, zones, minY, maxY };

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

/**
 * Height of the road under a point described by `locate`. Returns -Infinity
 * where there is no road: inside a gap, or beyond a missing barrier.
 */
export function groundHeight(track: Track, idx: number, along: number, lateral: number): number {
  const { n, hy } = track;
  if (track.gap[idx]) return -Infinity;
  const o = track.open[idx];
  if (o !== 0) {
    const edge = track.def.wallHalfWidth + 0.4;
    if ((lateral < -edge && (o & 1) !== 0) || (lateral > edge && (o & 2) !== 0)) return -Infinity;
  }
  const f = along / track.spacing;
  const h = f >= 0 ? hy[idx] + (hy[(idx + 1) % n] - hy[idx]) * f : hy[idx] + (hy[idx] - hy[(idx - 1 + n) % n]) * f;
  return h + lateral * track.bankT[idx];
}
