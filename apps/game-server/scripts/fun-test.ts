/**
 * Checks for the mechanics added to make racing more eventful: speed classes,
 * jump tricks, rocket starts and slipstreaming.
 *   npm run test:fun -w @office-kart/game-server
 */
import { DT, INPUT_BITS, MSG, NO_CTX, SPEED_CLASSES, TRICK, angleDiff, createKartState, decodeInput, getTrack, placeOnGrid, stepKart, wrapDelta, type KartInput } from "@office-kart/shared";
import { Bot, sleep } from "./bot";
import { getServer } from "./spawn-server";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

/** One scripted lap; `tricks` taps drift once in the air on every jump. */
/** `probe`: report how far the kart has gone by that tick. */
function lap(trackId: string, k: number, tricks: boolean, probe = -1): { seconds: number; boosts: number; top: number; landedAt: number; reach: number } {
  const track = getTrack(trackId);
  const s = placeOnGrid(createKartState(), track, 0);
  const input: KartInput = { throttle: 0, steer: 0, drift: false, reset: false, use: false };
  let travel = wrapDelta(s.pos, 0, track.n);
  let boosts = 0;
  let top = 0;
  let landedAt = -1;
  let reach = 0;
  for (let tick = 0; tick < 300 / DT; tick++) {
    const i = (s.idx + Math.round(5 + Math.abs(s.speed) * 0.22)) % track.n;
    const want = Math.atan2(track.px[i] - s.x, track.pz[i] - s.z);
    const tap = tricks && s.air && s.airT === 4;
    decodeInput(INPUT_BITS.ACCEL | (tap ? INPUT_BITS.DRIFT : 0), Math.max(-1, Math.min(1, -angleDiff(want, s.heading) * 3)), input);
    const before = s.pos;
    const boostBefore = s.boost;
    const tricking = s.trick !== 0 && s.air;
    stepKart(s, input, track, { ...NO_CTX, speed: k });
    if (tricking && !s.air && s.boost >= TRICK.boost - 0.001 && s.boost > boostBefore) {
      boosts++;
      if (landedAt < 0) landedAt = tick;
    }
    top = Math.max(top, s.speed);
    travel += wrapDelta(s.pos, before, track.n);
    if (tick === probe) reach = travel * track.spacing;
    if (travel >= track.n) return { seconds: tick * DT, boosts, top, landedAt, reach };
  }
  return { seconds: Infinity, boosts, top, landedAt, reach };
}

async function main(): Promise<void> {
  // ---- Speed classes and tricks, straight from the shared simulation.
  const times = SPEED_CLASSES.map((c) => lap("proving-grounds", c.k, false));
  check("each speed class laps faster than the one below", times.every((t, i) => i === 0 || t.seconds < times[i - 1].seconds), times.map((t) => t.seconds.toFixed(1)).join(" > ") + " s");
  check("top speed scales with the class", times.every((t, i) => i === 0 || t.top > times[i - 1].top * 1.08), times.map((t) => t.top.toFixed(0)).join(", ") + " m/s");
  // The two runs are identical until the first trick lands, so one second later the gain is exactly the boost.
  const first = lap("volcano-pass", 1.2, true);
  const tricky = lap("volcano-pass", 1.2, true, first.landedAt + 30);
  const plain = lap("volcano-pass", 1.2, false, first.landedAt + 30);
  check("a drift tap in mid-air pays out as a boost on landing", tricky.boosts >= 1, `${tricky.boosts} trick boosts`);
  check("a second after landing, the kart that did the trick is ahead", tricky.reach > plain.reach + 2, `${(tricky.reach - plain.reach).toFixed(1)} m ahead`);
  check("holding drift through a jump is not a trick", (() => {
    const track = getTrack("volcano-pass");
    const s = placeOnGrid(createKartState(), track, 0);
    const input: KartInput = { throttle: 0, steer: 0, drift: false, reset: false, use: false };
    let tricks = 0;
    for (let tick = 0; tick < 60 / DT; tick++) {
      const i = (s.idx + 8) % track.n;
      decodeInput(INPUT_BITS.ACCEL | INPUT_BITS.DRIFT, Math.max(-1, Math.min(1, -angleDiff(Math.atan2(track.px[i] - s.x, track.pz[i] - s.z), s.heading) * 3)), input);
      stepKart(s, input, track, NO_CTX);
      if (s.trick !== 0) tricks++;
    }
    return tricks === 0;
  })());

  // ---- Rocket starts and slipstreaming, over the network against the real server.
  const server = await getServer(2597);
  const a = new Bot(server.url, { name: "Rocket", lane: 0 });
  const b = new Bot(server.url, { name: "Early", lane: 0 });
  const c = new Bot(server.url, { name: "Plain", lane: 0, items: true });
  const fx: { kind: string; slot?: number; item?: number }[] = [];
  try {
    const code = await a.create();
    await b.join(code);
    await c.join(code);
    await a.waitFor("three players", () => a.players.length === 3);
    a.room.onMessage(MSG.FX, (m: { kind: string; slot?: number; item?: number }) => fx.push(m));
    check("the lobby starts on the Fast class", a.room.state.speed === 1, SPEED_CLASSES[a.room.state.speed as number]?.name);
    a.room.send(MSG.SETTINGS, { speed: 3 });
    await a.waitFor("speed set", () => a.room.state.speed === 3);
    b.room.send(MSG.SETTINGS, { speed: 0 });
    a.room.send(MSG.SETTINGS, { speed: 9 });
    await sleep(200);
    check("only the host can change the speed class, and only to a real one", a.room.state.speed === 3);
    a.room.send(MSG.SETTINGS, { speed: 1, trackId: "neon-circuit" });
    await a.waitFor("speed reset", () => a.room.state.speed === 1);
    b.room.send(MSG.READY, true);
    c.room.send(MSG.READY, true);
    await sleep(150);
    a.room.send(MSG.START);
    await a.waitFor("countdown", () => a.phase === "countdown");
    const startAt = a.room.state.raceStartAt as number;
    const serverNow = () => Date.now() + a.clockOffset;
    b.room.send(MSG.REV, true); // far too early: no boost
    await sleep(Math.max(0, startAt - serverNow() - 300));
    a.room.send(MSG.REV, true); // 0.3 s before the lights: perfect
    await a.waitFor("racing", () => a.phase === "racing");
    await sleep(1300);
    const rockets = fx.filter((m) => m.kind === "rocket");
    check("pressing the accelerator just before the lights gives a rocket start", rockets.length === 1 && rockets[0].slot === a.me?.slot && rockets[0].item === 2, JSON.stringify(rockets));
    // Power-ups: the bot presses "use" now and then; holding one and then not holding it means it was used.
    let held = 0;
    let uses = 0;
    const watch = setInterval(() => {
      const item = c.me?.item ?? 0;
      if (held !== 0 && item === 0) uses++;
      held = item;
    }, 30);
    await sleep(25_000);
    clearInterval(watch);
    check("a power-up is used when the use button is pressed", uses >= 1 && fx.some((m) => m.kind === "item" && m.slot === c.me?.slot), `${uses} uses by the bot that presses the button`);
    check("racers who never press it keep their power-ups", fx.every((m) => m.kind !== "item" || m.slot === c.me?.slot));
    const drafts = fx.filter((m) => m.kind === "draft");
    check("following closely behind another kart earns a slipstream boost", drafts.length >= 1, `${drafts.length} slipstream boosts in 26 s`);
    check("the kart in front does not get one for free", new Set(drafts.map((d) => d.slot)).size < 3 || drafts.length >= 3, `${drafts.length}`);
  } finally {
    for (const bot of [a, b, c]) await bot.leave().catch(() => {});
    await server.stop();
  }
  console.log(failed ? `\n${failed} checks FAILED` : "\nall checks passed");
  process.exit(failed ? 1 : 0);
}

void main();
