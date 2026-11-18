/** A scripted driver for offline tests: follows the centreline, and optionally drifts through corners. Test-only. */
import { DT, INPUT_BITS, KART, NO_CTX, angleDiff, createKartState, decodeInput, getTrack, placeOnGrid, stepKart, wrapDelta, type KartInput } from "@office-kart/shared";
export function drive(trackId: string, veh: number, k: number, drifting: boolean) {
  const track = getTrack(trackId);
  const s = placeOnGrid(createKartState(), track, 0);
  s.veh = veh;
  const inp: KartInput = { throttle: 0, steer: 0, drift: false, reset: false, use: false };
  let travel = wrapDelta(s.pos, 0, track.n);
  let hold = false, turbos = [0, 0, 0], falls = 0;
  for (let tick = 0; tick < 400 / DT; tick++) {
    const n = track.n;
    const i = (s.idx + Math.round(5 + Math.abs(s.speed) * 0.22)) % n;
    let steer = Math.max(-1, Math.min(1, -angleDiff(Math.atan2(track.px[i] - s.x, track.pz[i] - s.z), s.heading) * 3));
    // Curvature of the road just ahead (1/m): positive = right-hander.
    const a = (s.idx + 2) % n, b = (s.idx + 9) % n;
    const kappa = -angleDiff(Math.atan2(track.tx[b], track.tz[b]), Math.atan2(track.tx[a], track.tz[a])) / 14;
    if (drifting) {
      if (!hold && Math.abs(kappa) > 1 / 75 && s.speed > 15 && !s.air) { hold = true; steer = Math.sign(kappa); }
      else if (hold && s.driftDir !== 0) {
        // Hold the arc the road needs, plus a nudge back toward the line; steer by where the kart is going.
        const err = -angleDiff(Math.atan2(track.px[i] - s.x, track.pz[i] - s.z), s.vAngle);
        const c = (s.driftDir * (kappa * s.speed + err * 1.6)) / Math.max(11, s.speed);
        const [wide, mid, tight] = KART.driftRadius;
        const into = c >= 1 / mid ? (c - 1 / mid) / (1 / tight - 1 / mid) : (c - 1 / mid) / (1 / mid - 1 / wide);
        steer = s.driftDir * Math.max(-1, Math.min(1, into));
        if (Math.abs(kappa) < 1 / 160 && s.driftCharge > KART.driftLevels[0]) hold = false;
      } else if (hold && s.driftDir === 0 && s.dk) hold = false;
    }
    decodeInput(INPUT_BITS.ACCEL | (hold ? INPUT_BITS.DRIFT : 0), steer, inp);
    const before = s.pos, bx = s.x, bz = s.z, bb = s.boost, lvl = s.driftCharge, was = s.driftDir;
    stepKart(s, inp, track, { ...NO_CTX, speed: k });
    if (was !== 0 && s.driftDir === 0 && s.boost > bb) turbos[lvl >= KART.driftLevels[2] ? 2 : lvl >= KART.driftLevels[1] ? 1 : 0]++;
    if (Math.hypot(s.x - bx, s.z - bz) > 4 && s.speed === 0) falls++;
    travel += wrapDelta(s.pos, before, n);
    if (travel >= n) return { t: tick * DT, turbos, falls };
  }
  return { t: Infinity, turbos, falls };
}
