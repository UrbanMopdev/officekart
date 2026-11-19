/**
 * Computer-controlled opponents: none unless the host asks, clearly marked when present, driven
 * by the server through a whole race on every circuit, and gone again when the host turns them off.
 */
import { MSG, TRACK_DEFS } from "@office-kart/shared";
import { Bot, sleep } from "./bot";
import { getServer } from "./spawn-server";

interface P { id: string; name: string; cpu: boolean; ready: boolean; lap: number; place: number; finished: boolean; racing: boolean; points: number }
const players = (bot: Bot): P[] => [...(bot.room.state.players as Map<string, P>).values()];
let failed = 0;
const check = (ok: boolean, text: string): void => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${text}`);
  if (!ok) failed++;
};

async function main(): Promise<void> {
  const server = await getServer();
  const host = new Bot(server.url, { name: "Host", lane: 0, drift: true });
  try {
    await host.create();
    await sleep(300);
    check(players(host).length === 1 && (host.room.state as { cpus: number }).cpus === 0, "a new lobby has no computer-controlled cars");

    host.room.send(MSG.SETTINGS, { cpus: 3, cpuLevel: 1, laps: 2, chaos: 0 });
    await sleep(400);
    let cpus = players(host).filter((p) => p.cpu);
    check(cpus.length === 3, `the host can add three (got ${cpus.length})`);
    check(cpus.every((p) => p.name.startsWith("CPU ") && p.ready), `each is named and flagged as a CPU and counts as ready (${cpus.map((p) => p.name).join(", ")})`);
    host.room.send(MSG.SETTINGS, { cpus: 99 });
    await sleep(200);
    check(players(host).filter((p) => p.cpu).length === 3, "an out-of-range request is ignored");

    for (const trackId of Object.keys(TRACK_DEFS).slice(0, 4)) {
      host.room.send(MSG.SETTINGS, { trackId });
      await sleep(200);
      host.room.send(MSG.START);
      const started = Date.now();
      while (Date.now() - started < 240_000 && host.phase !== "results") await sleep(250);
      cpus = players(host).filter((p) => p.cpu);
      const done = cpus.filter((p) => p.finished || p.lap >= 2).length;
      const places = new Set(players(host).map((p) => p.place));
      check(host.phase === "results", `${trackId}: the race ran to its results`);
      check(done === cpus.length, `${trackId}: every CPU car raced its laps (${cpus.map((p) => `${p.name} lap ${p.lap}${p.finished ? " finished" : ""} P${p.place}`).join("; ")})`);
      check(places.size === players(host).length, `${trackId}: everyone has their own finishing place`);
      host.room.send(MSG.TO_LOBBY);
      await sleep(400);
    }

    host.room.send(MSG.SETTINGS, { cpus: 0 });
    await sleep(300);
    check(players(host).every((p) => !p.cpu), "turning them off removes them");

    // "Race the computer" from the front page: the lobby opens with CPU cars, and the person keeps the first seat.
    const solo = new Bot(server.url, { name: "Solo", lane: 0, join: { cpus: 2, color: 0 } });
    await solo.create();
    await sleep(400);
    const there = players(solo);
    const me = there.find((p) => !p.cpu) as (P & { slot: number; color: number }) | undefined;
    check(there.filter((p) => p.cpu).length === 2 && !!me && me.slot === 0 && me.color === 0, `a lobby can open with CPU cars already in it (${there.map((p) => p.name).join(", ")})`);
    solo.room.leave();
  } finally {
    host.room?.leave();
    await server.stop();
  }
  process.exitCode = failed ? 1 : 0;
}

void main();
