/** Helpers for scattering scenery without ever touching the circuit. */
import { locate, type Track } from "@office-kart/shared";

export function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function trackBounds(track: Track): Bounds {
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < track.n; i++) {
    b.minX = Math.min(b.minX, track.px[i]);
    b.maxX = Math.max(b.maxX, track.px[i]);
    b.minZ = Math.min(b.minZ, track.pz[i]);
    b.maxZ = Math.max(b.maxZ, track.pz[i]);
  }
  return b;
}

const loc = { idx: 0, along: 0, lateral: 0 };

/** Distance from a point to the nearest part of the centreline. */
export function distanceToTrack(track: Track, x: number, z: number): number {
  locate(track, x, z, -1, loc);
  return Math.hypot(x - track.px[loc.idx], z - track.pz[loc.idx]);
}

/** Keeps placed objects from overlapping each other or the circuit. */
export class Placer {
  private readonly placed: { x: number; z: number; r: number }[] = [];

  constructor(private readonly track: Track, private readonly margin = 2.5) {}

  /** Reserve a circle if it is clear of the track and everything already placed. */
  claim(x: number, z: number, r: number, trackClearance?: number): boolean {
    const clear = trackClearance ?? this.track.def.wallHalfWidth + this.margin + r;
    if (distanceToTrack(this.track, x, z) < clear) return false;
    for (const p of this.placed) {
      const d = p.r + r + 1;
      const dx = p.x - x;
      const dz = p.z - z;
      if (dx * dx + dz * dz < d * d) return false;
    }
    this.placed.push({ x, z, r });
    return true;
  }

  /** Reserve without checking (for things placed by hand). */
  force(x: number, z: number, r: number): void {
    this.placed.push({ x, z, r });
  }
}
