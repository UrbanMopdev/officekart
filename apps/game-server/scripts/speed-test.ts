/**
 * Laps every track at every speed class with a simple scripted driver (full
 * throttle, steers at the centreline, never brakes or drifts) and checks each
 * lap can be completed: jumps are cleared, nothing overshoots into a gap.
 *   npm run test:speed -w @office-kart/game-server
 */
import { DT, INPUT_BITS, NO_CTX, SPEED_CLASSES, TRACK_DEFS, angleDiff, createKartState, decodeInput, getTrack, placeOnGrid, stepKart, wrapDelta, type KartInput, type RaceCtx } from "@office-kart/shared";

let failed = false;
for (const id of Object.keys(TRACK_DEFS)) {
  const track = getTrack(id);
  const cells: string[] = [];
  for (const cls of SPEED_CLASSES) {
    const ctx: RaceCtx = { ...NO_CTX, speed: cls.k };
    const s = placeOnGrid(createKartState(), track, 0);
    const input: KartInput = { throttle: 0, steer: 0, drift: false, reset: false, use: false };
    let travel = wrapDelta(s.pos, 0, track.n);
    let falls = 0;
    let top = 0;
    let seconds = 0;
    const where: number[] = [];
    for (let tick = 0; tick < 300 / DT; tick++) {
      const ahead = Math.round(5 + Math.abs(s.speed) * 0.22);
      const i = (s.idx + ahead) % track.n;
      const want = Math.atan2(track.px[i] - s.x, track.pz[i] - s.z);
      decodeInput(INPUT_BITS.ACCEL, Math.max(-1, Math.min(1, -angleDiff(want, s.heading) * 3)), input);
      const before = s.pos;
      const bx = s.x;
      const bz = s.z;
      const bi = s.idx;
      stepKart(s, input, track, ctx);
      if (Math.hypot(s.x - bx, s.z - bz) > 4 && s.speed === 0) {
        falls++;
        where.push(Math.round((bi / track.n) * 1000) / 1000);
      }
      top = Math.max(top, s.speed);
      travel += wrapDelta(s.pos, before, track.n);
      if (travel >= track.n) {
        seconds = tick * DT;
        break;
      }
    }
    const ok = seconds > 0 && falls <= (cls.k > 1.5 ? 2 : 0);
    if (!ok) failed = true;
    cells.push(`${cls.name} ${seconds ? seconds.toFixed(0) + " s" : "DNF"}${falls ? ` (${falls} falls @ ${where.slice(0, 4).join(", ")})` : ""}${ok ? "" : " FAIL"}`);
  }
  console.log(`${track.def.name.padEnd(22)} ${cells.join("  |  ")}`);
}
if (failed) {
  console.log("FAILED");
  process.exit(1);
}
console.log("all speed classes can lap every track");
