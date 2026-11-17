/** Rolling simulation timing, reported by /health for monitoring and load tests. */
const WINDOW = 3000; // ticks (~100 s of racing)
let count = 0;
let totalMs = 0;
let maxMs = 0;

export function recordTick(ms: number): void {
  if (count >= WINDOW) {
    count = 0;
    totalMs = 0;
    maxMs = 0;
  }
  count++;
  totalMs += ms;
  if (ms > maxMs) maxMs = ms;
}

export function tickStats(): { ticks: number; avgMs: number; maxMs: number } {
  return { ticks: count, avgMs: count ? Math.round((totalMs / count) * 1000) / 1000 : 0, maxMs: Math.round(maxMs * 1000) / 1000 };
}
