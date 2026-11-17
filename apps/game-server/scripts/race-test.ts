/**
 * End-to-end protocol test against a running game server: lobby rules,
 * synchronised countdown, authoritative racing, disconnect/reconnect,
 * a speed-hack attempt, results and a rematch in the same lobby.
 *
 *   npm run test:race                      (starts a local server)
 *   SERVER_URL=wss://<game-server> npm run test:race   (against Railway)
 *
 * This checks server behaviour through real network clients. It is not a
 * substitute for people racing from separate computers.
 */
import { KART, TICK_MS } from "@office-kart/shared";
import { MSG } from "@office-kart/shared";
import { Bot, sleep } from "./bot";
import { getServer } from "./spawn-server";

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function rejects(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as Error).message || String(e);
  }
}

async function main(): Promise<void> {
  const server = await getServer();
  const url = server.url;
  const host = new Bot(url, { name: "Ada", lane: -3 });
  const b = new Bot(url, { name: "Ben", lane: 3 });
  const c = new Bot(url, { name: "Cy", lane: 0 });
  const cheat = new Bot(url, { name: "Dee", lane: 1.5, inputRate: 1.9 });
  const quitter = new Bot(url, { name: "<b>Eve</b>", lane: -1.5 });
  const all = [host, b, c, cheat, quitter];

  try {
    // ---- Lobby
    const code = await host.create();
    check("host creates a private lobby with a six-character code", /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
    for (const bot of [b, c, cheat, quitter]) await bot.join(code);
    await host.waitFor("five players", () => host.players.length === 5);
    check("players join by code and everyone sees the same roster", all.every((x) => x.players.length === 5));
    check("nicknames are sanitised", quitter.me?.name === "bEveb", quitter.me?.name);

    const badCode = await rejects(new Bot(url, { name: "Nope" }).join("ZZZZZZ"));
    check("joining a wrong code is rejected", badCode !== null, badCode ?? "");
    const badName = await rejects(new Bot(url, { name: "   " }).join(code));
    check("an empty nickname is rejected", badName !== null, badName ?? "");
    const dup = new Bot(url, { name: "Ada" });
    await dup.join(code);
    await dup.waitFor("own player", () => !!dup.me);
    check("duplicate nicknames are made unique", dup.me?.name === "Ada 2", dup.me?.name);
    await dup.leave();
    await host.waitFor("dup gone", () => host.players.length === 5);

    b.room.send(MSG.SETTINGS, { laps: 7 });
    b.room.send(MSG.START);
    await sleep(300);
    check("non-host cannot change settings or start the race", host.room.state.laps === 3 && host.phase === "lobby");

    host.room.send(MSG.SETTINGS, { laps: 1 });
    host.room.send(MSG.START);
    await sleep(300);
    check("host cannot start until everyone is ready", host.phase === "lobby" && host.notices.length > 0);
    check("host settings sync to every player", all.every((x) => x.room.state.laps === 1));

    for (const bot of [b, c, cheat, quitter]) bot.room.send(MSG.READY, true);
    await host.waitFor("all ready", () => host.players.filter((p) => p.ready).length === 4);
    host.room.send(MSG.START);
    await Promise.all(all.map((x) => x.waitFor("countdown", () => x.phase === "countdown")));
    const starts = all.map((x) => x.room.state.raceStartAt as number);
    check("countdown is synchronised: every client has the same start time", starts.every((s) => s === starts[0] && s > 0));
    const untilStart = starts[0] - (Date.now() + host.clockOffset);
    check("countdown lasts about four seconds", untilStart > 3000 && untilStart < 4200, `${Math.round(untilStart)} ms left`);

    // ---- Race 1
    await Promise.all(all.map((x) => x.waitFor("race start", () => x.phase === "racing", 8000)));
    const late = await rejects(new Bot(url, { name: "Late" }).join(code));
    check("joining mid-race is rejected", late !== null, late ?? "");

    await sleep(5000);
    const token = await c.drop();
    await host.waitFor("Cy shown disconnected", () => host.players.find((p) => p.name === "Cy")?.connected === false, 8000);
    check("a dropped connection is detected and the race keeps running", host.phase === "racing");
    await sleep(2500);
    await c.reconnect(token);
    await host.waitFor("Cy back", () => host.players.find((p) => p.name === "Cy")?.connected === true, 5000);
    check("the dropped player reconnects into the same race", c.phase === "racing" && c.me?.racing === true);

    // A client that floods the server with junk is removed; nobody else is affected.
    let floodClosed = false;
    quitter.room.onLeave(() => (floodClosed = true));
    for (let i = 0; i < 3000; i++) quitter.room.send("junk", i);
    await host.waitFor("flooder removed", () => host.players.length === 4, 8000).catch(() => {});
    check("a client flooding messages is kicked and removed", floodClosed && host.players.length === 4);
    quitter.closed = true;
    check("the race carries on for everyone else", host.phase === "racing");

    await Promise.all([host, b, c, cheat].map((x) => x.waitFor("results", () => x.phase === "results", 240_000)));
    const view = host.players.filter((p) => p.racing).sort((x, y) => x.place - y.place);
    console.log(view.map((p) => `   ${p.place}. ${p.name.padEnd(6)} ${p.finished ? (p.finishMs / 1000).toFixed(2) + " s" : "DNF"}  best lap ${(p.bestLapMs / 1000).toFixed(2)} s`).join("\n"));
    check("every remaining racer finished", view.length === 4 && view.every((p) => p.finished));
    const places = view.map((p) => p.place);
    check("finishing places are unique and complete", places.join() === "1,2,3,4", places.join());
    check("server finishing order matches finish times", view.every((p, i) => i === 0 || p.finishMs >= view[i - 1].finishMs));
    const same = [b, c, cheat].every((x) => JSON.stringify(x.players.sort((p, q) => p.slot - q.slot)) === JSON.stringify(host.players.sort((p, q) => p.slot - q.slot)));
    check("all clients see identical results", same);

    // ---- Anti-cheat: Dee sent inputs at 1.9x the legal rate.
    const limit = KART.maxSpeed + KART.boostExtraSpeed;
    check("server-side speed never exceeds the kart's limits", [host, b, c, cheat].every((x) => x.maxServerSpeed <= limit + 0.01), `max ${Math.max(...[host, b, c, cheat].map((x) => x.maxServerSpeed)).toFixed(2)} of ${limit}`);
    const lapCheat = cheat.me?.finishMs ?? 0;
    const minPossible = (host.track.length / limit) * 1000;
    check("flooding inputs (1.9x rate) gives no speed advantage", lapCheat > minPossible, `Dee ${(lapCheat / 1000).toFixed(2)} s vs physical minimum ${(minPossible / 1000).toFixed(2)} s`);
    let worst = 0;
    const tr = cheat.selfTrace;
    for (let i = 0, j = 0; i < tr.length; i++) {
      while (tr[i][0] - tr[j][0] > 2000) j++;
      const dt = (tr[i][0] - tr[j][0]) / 1000;
      if (dt > 1.5) worst = Math.max(worst, Math.hypot(tr[i][1] - tr[j][1], tr[i][2] - tr[j][2]) / dt);
    }
    check("flooding kart's real-time speed stays within limits", worst <= limit * 1.1, `${worst.toFixed(1)} m/s peak over 2 s windows`);

    // ---- Prediction quality for an honest client.
    console.log(`   Ada prediction: ${host.predictor.corrections} corrections, largest ${host.predictor.maxCorrection.toFixed(3)} m in ${host.predictor.seq} predicted ticks (${TICK_MS.toFixed(1)} ms ticks)`);

    // ---- Rematch in the same lobby. Dee now plays fair, to compare times.
    cheat.opts.inputRate = 1;
    host.room.send(MSG.REMATCH);
    await Promise.all([host, b, c, cheat].map((x) => x.waitFor("rematch countdown", () => x.phase === "countdown", 5000)));
    check("rematch starts in the same lobby", host.room.roomId === code && host.room.state.raceNumber === 2);
    await Promise.all([host, b, c, cheat].map((x) => x.waitFor("results 2", () => x.phase === "results", 240_000)));
    check("second race completes", host.players.filter((p) => p.racing && p.finished).length === 4);
    const fair = cheat.me?.finishMs ?? 0;
    check("flooding was no faster than the same kart playing fair", lapCheat > fair - 750, `flooding ${(lapCheat / 1000).toFixed(2)} s, fair ${(fair / 1000).toFixed(2)} s`);
    host.room.send(MSG.TO_LOBBY);
    await host.waitFor("lobby", () => host.phase === "lobby", 5000);
    check("host can return everyone to the lobby", [b, c, cheat].every((x) => x.phase === "lobby"));

    // ---- Host migration
    await host.leave();
    await b.waitFor("new host", () => b.room.state.hostId !== "" && b.players.length === 3, 5000);
    check("host role passes on when the host leaves", b.players.some((p) => p.id === b.room.state.hostId));

    const health = (await (await fetch(`${server.httpUrl}/health`)).json()) as { status: string };
    check("/health responds ok", health.status === "ok", JSON.stringify(health));
  } finally {
    for (const bot of all) if (!bot.closed) await bot.leave().catch(() => {});
    await server.stop();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
