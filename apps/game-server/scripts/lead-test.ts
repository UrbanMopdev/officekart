/**
 * Other cars are drawn carried forward to our own car's clock. This drives a scripted lap of every circuit,
 * and checks the carried-forward car lands where the car really is a moment later.
 */
import { DT, INPUT_BITS, NO_CTX, TRACK_DEFS, angleDiff, carryForward, createKartState, decodeInput, getTrack, placeOnGrid, stepKart, type KartInput } from "@office-kart/shared";

let failed = 0;
const LEAD_TICKS = 5; // about 165 ms: a 100 ms smoothing window plus a 65 ms round trip
for (const id of Object.keys(TRACK_DEFS)) {
  const track = getTrack(id);
  const s = placeOnGrid(createKartState(), track, 0);
  const inp: KartInput = { throttle: 0, steer: 0, drift: false, reset: false, use: false };
  const log: { x: number; y: number; z: number; h: number; v: number }[] = [];
  for (let tick = 0; tick < 70 / DT; tick++) {
    const i = (s.idx + Math.round(5 + Math.abs(s.speed) * 0.22)) % track.n;
    const steer = Math.max(-1, Math.min(1, -angleDiff(Math.atan2(track.px[i] - s.x, track.pz[i] - s.z), s.heading) * 3));
    stepKart(s, decodeInput(INPUT_BITS.ACCEL, steer, inp), track, NO_CTX);
    log.push({ x: s.x, y: s.y, z: s.z, h: s.heading, v: s.speed });
  }
  const errs: number[] = [];
  const stale: number[] = [];
  let hErr = 0;
  const steps: number[] = [];
  let last: { x: number; z: number; t: number } | null = null;
  for (let t = 60; t + LEAD_TICKS < log.length; t++) {
    const a = log[t - 1], b = log[t], truth = log[t + LEAD_TICKS];
    if (Math.hypot(truth.x - b.x, truth.z - b.z) > 12) continue; // a reset to the track, not driving
    const pose = { x: b.x, y: b.y, z: b.z, heading: b.h, speed: b.v };
    carryForward(pose, b.x - a.x, b.y - a.y, b.z - a.z, angleDiff(b.h, a.h), DT * 1000, LEAD_TICKS * DT);
    errs.push(Math.hypot(pose.x - truth.x, pose.z - truth.z));
    stale.push(Math.hypot(b.x - truth.x, b.z - truth.z));
    if (last && last.t === t - 1) steps.push(Math.hypot(pose.x - last.x - (truth.x - log[t + LEAD_TICKS - 1].x), pose.z - last.z - (truth.z - log[t + LEAD_TICKS - 1].z)));
    last = { x: pose.x, z: pose.z, t };
    hErr = Math.max(hErr, Math.abs(angleDiff(pose.heading, truth.h)));
  }
  errs.sort((p, q) => p - q);
  const mean = errs.reduce((p, q) => p + q, 0) / errs.length;
  const before = stale.reduce((p, q) => p + q, 0) / stale.length;
  const p99 = errs[Math.floor(errs.length * 0.99)];
  steps.sort((p, q) => p - q);
  console.log(`      tick-to-tick wobble: median ${(steps[steps.length >> 1] * 100).toFixed(1)} cm, 99% under ${(steps[Math.floor(steps.length * 0.99)] * 100).toFixed(0)} cm, max ${(steps[steps.length - 1] * 100).toFixed(0)} cm`);
  const ok = mean < 0.25 && p99 < 1.2;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}: drawn ${before.toFixed(2)} m behind before; now ${mean.toFixed(2)} m off on average, ${p99.toFixed(2)} m at worst 1%, heading within ${((hErr * 180) / Math.PI).toFixed(0)} deg`);
}
process.exitCode = failed ? 1 : 0;
