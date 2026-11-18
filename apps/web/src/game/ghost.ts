/**
 * Ghost of your own best run. When you race alone, a see-through copy of your
 * fastest race on this track (same laps and speed class) drives alongside, so
 * there is always something to chase. It is your own recorded driving, kept in
 * this browser; it is never sent to the server and never shown to anyone else.
 */
import { TICK_MS, angleDiff } from "@office-kart/shared";

/** One sample every three ticks (10 per second), stored as 16-bit integers. */
const EVERY = 3;
const SCALE = 20; // 5 cm
const ANGLE = 10000;
const STRIDE = 4;

export interface Ghost {
  ms: number;
  data: Int16Array;
}

const key = (trackId: string, laps: number, speed: number) => `office-kart:ghost:${trackId}:${laps}:${speed}`;
const q = (v: number, scale: number) => Math.max(-32767, Math.min(32767, Math.round(v * scale)));

export function loadGhost(trackId: string, laps: number, speed: number): Ghost | null {
  try {
    const raw = localStorage.getItem(key(trackId, laps, speed));
    if (!raw) return null;
    const { ms, d } = JSON.parse(raw) as { ms: number; d: string };
    return decodeGhost(ms, d);
  } catch {
    return null;
  }
}

/** Turn a stored or downloaded run (base64 of 16-bit samples) into something playable. */
export function decodeGhost(ms: number, d: string): Ghost | null {
  try {
    const bytes = Uint8Array.from(atob(d), (c) => c.charCodeAt(0));
    const data = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
    return ms > 0 && data.length >= STRIDE * 4 ? { ms, data } : null;
  } catch {
    return null;
  }
}

export class GhostRecorder {
  private samples: number[] = [];
  private next = 0;

  reset(): void {
    this.samples = [];
    this.next = 0;
  }

  /** Call with the kart's state after each simulation tick. */
  record(tick: number, x: number, y: number, z: number, heading: number): void {
    while (tick >= this.next && this.samples.length < STRIDE * 20000) {
      this.samples.push(q(x, SCALE), q(y, SCALE), q(z, SCALE), q(Math.atan2(Math.sin(heading), Math.cos(heading)), ANGLE));
      this.next += EVERY;
    }
  }

  /** Keep this run if it beat the stored one. Returns true if it was saved. */
  save(trackId: string, laps: number, speed: number, ms: number): boolean {
    if (this.samples.length < STRIDE * 20 || ms <= 0) return false;
    const best = loadGhost(trackId, laps, speed);
    if (best && best.ms <= ms) return false;
    try {
      const bytes = new Uint8Array(Int16Array.from(this.samples).buffer);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
      localStorage.setItem(key(trackId, laps, speed), JSON.stringify({ ms, d: btoa(bin) }));
      return true;
    } catch {
      return false; // storage full or unavailable: the game carries on without a ghost
    }
  }
}

/** Where the ghost is `raceMs` into the race. Returns false once its run is over. */
export function sampleGhost(g: Ghost, raceMs: number, out: { x: number; y: number; z: number; heading: number; speed: number }): boolean {
  const f = raceMs / (TICK_MS * EVERY);
  const i = Math.floor(f);
  const n = g.data.length / STRIDE;
  if (raceMs < 0 || raceMs > g.ms || i + 1 >= n) return false;
  const t = f - i;
  const a = i * STRIDE;
  const b = a + STRIDE;
  const d = g.data;
  out.x = (d[a] + (d[b] - d[a]) * t) / SCALE;
  out.y = (d[a + 1] + (d[b + 1] - d[a + 1]) * t) / SCALE;
  out.z = (d[a + 2] + (d[b + 2] - d[a + 2]) * t) / SCALE;
  const h0 = d[a + 3] / ANGLE;
  out.heading = h0 + angleDiff(d[b + 3] / ANGLE, h0) * t;
  out.speed = (Math.hypot(d[b] - d[a], d[b + 2] - d[a + 2]) / SCALE / (TICK_MS * EVERY)) * 1000;
  return true;
}
