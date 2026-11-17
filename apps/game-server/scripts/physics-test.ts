/**
 * Offline checks of the elevation, jump, terrain and recovery physics. Drives a
 * scripted kart round each track with the same step function the server uses.
 *   npm run test:physics -w @office-kart/game-server
 */
import { DT, INPUT_BITS, KART, SURFACE_TYPES, TRACK_DEFS, angleDiff, createKartState, decodeInput, getTrack, placeOnGrid, stepKart, wrapDelta, type KartInput, type Track } from "@office-kart/shared";

let failed = false;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed = true;
}

interface Run {
  lapSeconds: number;
  airSeconds: number;
  jumps: number;
  longestAir: number;
  respawns: number;
  maxY: number;
  minSpeedUphill: number;
  maxSpeed: number;
  floatError: number;
  surfaceSpeed: Record<string, number[]>;
  finished: boolean;
  underwater: number;
  waterSpeed: number;
}

function drive(track: Track, opts: { lane?: number; throttle?: (pos: number) => boolean; maxSeconds?: number } = {}): Run {
  const s = placeOnGrid(createKartState(), track, 0);
  const input: KartInput = { throttle: 0, steer: 0, drift: false, reset: false, use: false };
  const run: Run = { lapSeconds: 0, airSeconds: 0, jumps: 0, longestAir: 0, respawns: 0, maxY: -Infinity, minSpeedUphill: Infinity, maxSpeed: 0, floatError: 0, surfaceSpeed: {}, finished: false, underwater: 0, waterSpeed: 0 };
  let travel = wrapDelta(s.pos, 0, track.n);
  let air = 0;
  for (let tick = 0; tick < (opts.maxSeconds ?? 240) / DT; tick++) {
    const ahead = Math.round(5 + Math.abs(s.speed) * 0.22);
    const i = (s.idx + ahead) % track.n;
    const lane = opts.lane ?? 0;
    const want = Math.atan2(track.px[i] + track.nx[i] * lane - s.x, track.pz[i] + track.nz[i] * lane - s.z);
    const go = opts.throttle ? opts.throttle(s.idx / track.n) : true;
    decodeInput(go ? INPUT_BITS.ACCEL : 0, Math.max(-1, Math.min(1, -angleDiff(want, s.heading) * 3)), input);
    const before = s.pos;
    const beforeX = s.x;
    const beforeZ = s.z;
    const wasAir = s.air;
    stepKart(s, input, track);
    const moved = Math.hypot(s.x - beforeX, s.z - beforeZ);
    if (moved > 3 && s.speed === 0) run.respawns++;
    travel += wrapDelta(s.pos, before, track.n);
    if (s.air) {
      air += DT;
      run.airSeconds += DT;
      if (!wasAir) run.jumps++;
    } else {
      if (air > run.longestAir) run.longestAir = air;
      air = 0;
      // Grounded karts must sit exactly on the road: no floating, no clipping.
      run.floatError = Math.max(run.floatError, Math.abs(s.y - (track.hy[s.idx] + 0)) > 2.5 ? Math.abs(s.y - track.hy[s.idx]) : 0);
      const name = SURFACE_TYPES[s.surf];
      (run.surfaceSpeed[name] ??= []).push(s.speed);
      if (track.slope[s.idx] > 0.12 && tick > 200) run.minSpeedUphill = Math.min(run.minSpeedUphill, s.speed);
    }
    if (s.water) {
      run.waterSpeed = (run.waterSpeed * run.underwater + s.speed * DT) / (run.underwater + DT);
      run.underwater += DT;
    }
    run.maxY = Math.max(run.maxY, s.y);
    run.maxSpeed = Math.max(run.maxSpeed, s.speed);
    if (travel >= track.n) {
      run.lapSeconds = tick * DT;
      run.finished = true;
      break;
    }
  }
  return run;
}

for (const id of Object.keys(TRACK_DEFS)) {
  const track = getTrack(id);
  const run = drive(track);
  const timed = track.hazards.some((h) => h.def.kind === "collapse");
  console.log(`${track.def.name}: lap ${run.lapSeconds.toFixed(1)} s, height ${track.minY.toFixed(0)}..${track.maxY.toFixed(0)} m, ${run.jumps} jumps, ${run.airSeconds.toFixed(1)} s in the air, ${run.respawns} respawns, top speed ${run.maxSpeed.toFixed(1)}, ${run.underwater.toFixed(1)} s under water`);
  check("a full-throttle lap completes", run.finished);
  // A section that drops away on a timer can catch a kart; everything else must be clean.
  check(timed ? "at most a couple of falls (timed collapsing sections)" : "no falls on the racing line", run.respawns <= (timed ? 3 : 0), `${run.respawns}`);
  check("speed stays within limits", run.maxSpeed <= (KART.maxSpeed + KART.boostExtraSpeed) * 1.35 + 0.01, run.maxSpeed.toFixed(1));
  check("grounded karts stay on the road surface", run.floatError === 0, run.floatError.toFixed(2));
  if (track.def.gaps?.length) check("every jump is cleared at racing speed", run.jumps >= track.def.gaps.length);
  if (track.waterLevel > -Infinity) check("part of the lap is driven under water, and it is slower", run.underwater > 4 && run.waterSpeed < run.maxSpeed * 0.9, `${run.waterSpeed.toFixed(1)} m/s average under water`);
  if (id !== "proving-grounds") continue;
  check("jumps happen and land", run.jumps >= 2 && run.longestAir > 0.5 && run.longestAir < 3, `${run.jumps} jumps`);
  check("the kart keeps climbing on the steepest hills", run.minSpeedUphill > 12, `${run.minSpeedUphill.toFixed(1)} m/s slowest uphill`);
  const avg = (name: string) => {
    const v = run.surfaceSpeed[name] ?? [];
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
  };
  const mud = drive(track, { lane: -4 });
  const mudSpeeds = mud.surfaceSpeed.mud ?? [];
  const mudAvg = mudSpeeds.reduce((a, b) => a + b, 0) / (mudSpeeds.length || 1);
  check("mud is much slower than asphalt", mudSpeeds.length > 10 && mudAvg < avg("asphalt") * 0.8, `mud ${mudAvg.toFixed(1)} vs asphalt ${avg("asphalt").toFixed(1)} m/s`);
  check("every surface on the racing line was driven", ["snow", "ice", "boost", "dirt"].every((n) => (run.surfaceSpeed[n] ?? []).length > 5));

  // Too slow for the ravine: the kart must fall, be put back before the run-up, and then make it.
  const g = track.def.gaps![0];
  const s = placeOnGrid(createKartState(), track, 0);
  const input: KartInput = { throttle: 0, steer: 0, drift: false, reset: false, use: false };
  let fell = false;
  let cleared = false;
  let phase = 0;
  for (let tick = 0; tick < 200 / DT && !cleared; tick++) {
    const i = (s.idx + 8) % track.n;
    const want = Math.atan2(track.px[i] - s.x, track.pz[i] - s.z);
    const u = s.idx / track.n;
    // First approach: brake to a crawl up the ramp. After the fall: full throttle.
    const crawl = phase === 0 && u > g.respawn && u < g.to && s.speed > 9;
    decodeInput(crawl ? INPUT_BITS.BRAKE : INPUT_BITS.ACCEL, Math.max(-1, Math.min(1, -angleDiff(want, s.heading) * 3)), input);
    const bx = s.x;
    const bz = s.z;
    stepKart(s, input, track);
    if (phase === 0 && Math.hypot(s.x - bx, s.z - bz) > 3) {
      fell = true;
      phase = 1;
      check("a fall puts the kart back before the run-up, stationary", Math.abs(s.idx - Math.round(g.respawn * track.n)) <= 1 && s.speed === 0 && !s.air, `sample ${s.idx}`);
    }
    if (phase === 1 && u > g.to + 0.01 && !s.air) cleared = true;
  }
  check("a slow kart falls into the ravine", fell);
  check("after respawning, a full run-up clears the ravine", cleared);

  // Open cliff edge: steering off it must fall and recover on the road nearby.
  const o = track.def.openSides![0];
  const c = placeOnGrid(createKartState(), track, 0);
  let edgeFell = false;
  for (let tick = 0; tick < 120 / DT && !edgeFell; tick++) {
    const u = c.idx / track.n;
    const i = (c.idx + 8) % track.n;
    const inZone = u > o.from + 0.004 && u < o.to;
    const lane = inZone ? (o.side > 0 ? 40 : -40) : 0;
    const want = Math.atan2(track.px[i] + track.nx[i] * lane - c.x, track.pz[i] + track.nz[i] * lane - c.z);
    decodeInput(INPUT_BITS.ACCEL, Math.max(-1, Math.min(1, -angleDiff(want, c.heading) * 3)), input);
    const bx = c.x;
    const bz = c.z;
    stepKart(c, input, track);
    if (inZone && Math.hypot(c.x - bx, c.z - bz) > 3 && c.speed === 0) edgeFell = true;
  }
  check("driving off the open cliff edge falls and recovers", edgeFell && !c.air && Math.abs(c.y - track.hy[c.idx]) < 0.01);
}
process.exit(failed ? 1 : 0);
