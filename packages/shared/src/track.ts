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

export interface TrackDef {
  id: string;
  name: string;
  /** Closed loop of centreline control points [x, z], in driving order. */
  controlPoints: [number, number][];
  roadHalfWidth: number;
  wallHalfWidth: number;
  checkpointCount: number;
  defaultLaps: number;
  boostPads: BoostPadDef[];
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

  const track: Track = { def, n, spacing, length, px, pz, tx, tz, nx, nz, checkpoints, grid: [], pads: [] };

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
