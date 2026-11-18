/**
 * Checks for vehicles, the reworked drift, and time trials with leaderboards
 * (run against the in-memory score store unless DATABASE_URL is set).
 *   npm run test:trial -w @office-kart/game-server
 */
import { INPUT_BITS, KART, MSG, NO_CTX, TRIAL_LAPS, VEHICLES, collideKarts, createKartState, decodeInput, getTrack, placeOnGrid, stepKart, weeklyChallenge, type KartInput, type TrialResult } from "@office-kart/shared";
import { Bot, sleep } from "./bot";
import { drive } from "./drive";
import { getServer } from "./spawn-server";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}
const input = (): KartInput => ({ throttle: 0, steer: 0, drift: false, reset: false, use: false });

/** Speed 1.5 s after a standing start. */
function launch(veh: number): number {
  const track = getTrack("neon-cyber-city");
  const s = placeOnGrid(createKartState(), track, 0);
  s.veh = veh;
  const inp = input();
  for (let tick = 0; tick < 45; tick++) stepKart(s, decodeInput(INPUT_BITS.ACCEL, 0, inp), track, NO_CTX);
  return s.speed;
}

/** How far the nose swings in 0.4 s at top speed, steering hard right, with or without the drift button. */
function swing(drift: boolean): number {
  const track = getTrack("proving-grounds");
  const s = placeOnGrid(createKartState(), track, 0);
  s.speed = KART.maxSpeed;
  const inp = input();
  const h0 = s.heading;
  for (let tick = 0; tick < 12; tick++) stepKart(s, decodeInput(INPUT_BITS.ACCEL | (drift ? INPUT_BITS.DRIFT : 0), 1, inp), track, NO_CTX);
  return Math.abs(s.heading - h0);
}

/** Speeds after kart `a` (moving) runs into the back of kart `b` (stopped). */
function shunt(a: number, b: number): [number, number] {
  const ka = createKartState();
  const kb = createKartState();
  ka.veh = a;
  kb.veh = b;
  ka.speed = 20;
  kb.z = 1.6;
  collideKarts(ka, kb);
  return [ka.speed, kb.speed];
}

async function main(): Promise<void> {
  // ---- Vehicles
  const laps = VEHICLES.map((_, v) => drive("office-apocalypse", v, 1.2, true));
  check("every vehicle laps the track without falling", laps.every((l) => Number.isFinite(l.t) && l.falls === 0), laps.map((l, v) => `${VEHICLES[v].name} ${l.t.toFixed(1)} s`).join(", "));
  const spread = Math.max(...laps.map((l) => l.t)) / Math.min(...laps.map((l) => l.t));
  check("on Office Apocalypse no vehicle is more than 6% quicker than another", spread < 1.06, `spread ${((spread - 1) * 100).toFixed(1)}%`);
  const off = VEHICLES.map((_, v) => launch(v));
  check("the Scooter is quickest off the line and the Hot Rod slowest", off[1] === Math.max(...off) && off[2] === Math.min(...off), off.map((v) => v.toFixed(1)).join(", ") + " m/s after 1.5 s");
  const [bully, victim] = shunt(3, 1);
  const [gnat, wall] = shunt(1, 3);
  check("a Forklift ploughs through a Scooter; a Scooter bounces off a Forklift", bully > gnat + 6 && victim > wall + 6, `forklift keeps ${bully.toFixed(1)} of 20 m/s, scooter keeps ${gnat.toFixed(1)}`);

  // ---- Drift
  const plain = swing(false);
  const slide = swing(true);
  check("the tail steps out at once: a drift swings the nose further than steering alone", slide > plain * 1.15, `${slide.toFixed(2)} vs ${plain.toFixed(2)} rad in 0.4 s`);
  for (const id of ["office-apocalypse", "neon-cyber-city", "frozen-frenzy"]) {
    const grip = drive(id, 0, 1.2, false);
    const drifted = drive(id, 0, 1.2, true);
    const turbos = drifted.turbos[0] + drifted.turbos[1] + drifted.turbos[2];
    check(`${id}: a driver who drifts the corners laps faster than one who does not`, drifted.t < grip.t && turbos >= 4 && drifted.falls === 0, `${drifted.t.toFixed(1)} s with ${turbos} turbos vs ${grip.t.toFixed(1)} s`);
  }
  const quick = drive("office-apocalypse", 0, 1.65, true);
  check("drifting still works at Ludicrous speed", Number.isFinite(quick.t) && quick.falls === 0 && quick.turbos[0] + quick.turbos[1] + quick.turbos[2] >= 3, `${quick.t.toFixed(1)} s`);

  // ---- Time trial over the network
  const server = await getServer(2596);
  const pid = "test-driver-0001";
  const a = new Bot(server.url, { name: "Trialist", lane: 0, join: { trial: true, trackId: "sky-high-insanity", speed: 3, vehicle: 2, avatar: 4, pid } });
  const b = new Bot(server.url, { name: "Gatecrasher" });
  const json = async (path: string) => (await fetch(`${server.httpUrl}${path}`)).json() as Promise<Record<string, any>>;
  try {
    const code = await a.create();
    const st = a.room.state;
    await a.waitFor("room state", () => st.trial === true, 3000).catch(() => {});
    check("a trial room is solo, three laps, on the track and class asked for", st.trial === true && st.laps === TRIAL_LAPS && st.trackId === "sky-high-insanity" && st.speed === 3);
    check("nobody else can join a time trial", await b.join(code).then(() => false, () => true));
    check("vehicle and driver look are taken from the join options", (st.players.get(a.room.sessionId) as any).vehicle === 2 && (st.players.get(a.room.sessionId) as any).avatar === 4);
    a.room.send(MSG.SETTINGS, { laps: 1, chaos: 2 });
    a.room.send(MSG.KART, { vehicle: 99 });
    await sleep(200);
    check("laps, chaos and bad vehicle ids cannot be changed in a trial", st.laps === TRIAL_LAPS && st.chaos === 0 && (st.players.get(a.room.sessionId) as any).vehicle === 2);
    const empty = await json(`/api/board?track=sky-high-insanity&speed=3&board=all&pid=${pid}`);
    check("the board starts empty", Array.isArray(empty.race) && empty.race.length === 0 && empty.me === null);
    check("there is no ghost before anyone has set a time", (await fetch(`${server.httpUrl}/api/ghost?track=sky-high-insanity&speed=3&board=all`)).status === 404);
    check("the leaderboard API is read-only", (await fetch(`${server.httpUrl}/api/board?track=sky-high-insanity&speed=3`, { method: "POST" })).status === 405);
    check("unknown tracks are rejected", (await fetch(`${server.httpUrl}/api/board?track=nope&speed=3`)).status === 400);

    let result: TrialResult | null = null;
    let items = 0;
    a.room.onMessage(MSG.TRIAL, (r: TrialResult) => (result = r));
    a.room.send(MSG.START);
    await a.waitFor("racing", () => a.phase === "racing", 15_000);
    const watch = setInterval(() => (items += a.me?.item ? 1 : 0), 100);
    await a.waitFor("finish", () => a.me?.finished === true, 240_000);
    clearInterval(watch);
    await a.waitFor("score", () => result !== null, 5000);
    const r = result as unknown as TrialResult;
    check("no power-ups are handed out in a time trial", items === 0);
    check("the run is scored and saved at rank 1", r.saved && r.rank === 1 && r.weekRank === 1 && r.improved && r.raceMs === a.me?.finishMs, JSON.stringify(r));
    const board = await json(`/api/board?track=sky-high-insanity&speed=3&board=all&pid=${pid}`);
    check("the board shows the run with its race and lap time", board.race.length === 1 && board.race[0].raceMs === r.raceMs && board.race[0].lapMs === r.lapMs && board.race[0].name === "Trialist" && board.race[0].vehicle === 2 && board.myRank === 1);
    const week = await json(`/api/board?track=sky-high-insanity&speed=3&board=week`);
    check("it is on this week's board too", week.race.length === 1 && week.lap[0].lapMs === r.lapMs);
    const ghost = await json(`/api/ghost?track=sky-high-insanity&speed=3&board=all`);
    const samples = Buffer.from(String(ghost.d), "base64").length / 8;
    check("the champion's ghost covers the whole run", ghost.name === "Trialist" && ghost.ms === r.raceMs && Math.abs(samples * 100 - r.raceMs) < 400, `${samples} samples for ${(r.raceMs / 1000).toFixed(1)} s`);
    const other = await json(`/api/board?track=sky-high-insanity&speed=1&board=all`);
    check("other speed classes have their own board", other.race.length === 0);
    const c = await json("/api/challenge");
    check("the weekly challenge names this week's track", c.challenge.trackId === weeklyChallenge(Date.now()).trackId && c.challenge.endsAt > Date.now());

    // Restart mid-run: back on the grid, and the abandoned run is not scored.
    result = null;
    a.room.send(MSG.RESTART);
    await a.waitFor("countdown again", () => a.phase === "countdown", 5000);
    await a.waitFor("racing again", () => a.phase === "racing", 15_000);
    await sleep(3000);
    a.room.send(MSG.RESTART);
    await a.waitFor("restarted", () => a.phase === "countdown", 5000);
    check("a run can be restarted from the track, and an abandoned run scores nothing", result === null && (await json(`/api/board?track=sky-high-insanity&speed=3&board=all`)).race[0].raceMs === r.raceMs);
  } finally {
    await a.leave().catch(() => {});
    await b.leave().catch(() => {});
    await server.stop();
  }
  console.log(failed ? `\n${failed} checks FAILED` : "\nall checks passed");
  process.exit(failed ? 1 : 0);
}

void main();
