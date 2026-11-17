/**
 * Load test: fills one lobby with 12 network clients and runs a full race,
 * reporting server CPU/memory, simulation tick cost, snapshot delivery and
 * round-trip latency.
 *
 *   npm run test:load                                   (local server)
 *   SERVER_URL=wss://<game-server> npm run test:load    (deployed server)
 *
 * Against a local server the latency figures only show processing overhead.
 * Run it against the Railway URL to measure real network latency.
 */
import { readFileSync } from "node:fs";
import { DEFAULT_TRACK_ID, MAX_PLAYERS, MSG, SNAPSHOT_EVERY, TICK_MS } from "@office-kart/shared";
import { Bot, percentile, sleep } from "./bot";
import { getServer } from "./spawn-server";

const LAPS = Number(process.env.LAPS) || 3;
const TRACK = process.env.TRACK || DEFAULT_TRACK_ID;

function procCpuSeconds(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return (Number(fields[11]) + Number(fields[12])) / 100; // utime + stime, in clock ticks (100/s)
  } catch {
    return null;
  }
}

function procRssMb(pid: number): number | null {
  try {
    const m = readFileSync(`/proc/${pid}/status`, "utf8").match(/VmRSS:\s+(\d+) kB/);
    return m ? Number(m[1]) / 1024 : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const server = await getServer(2598);
  const pid = server.child?.pid;
  const bots = Array.from({ length: MAX_PLAYERS }, (_, i) => new Bot(server.url, { name: `Racer ${i + 1}`, lane: -4.5 + (i % 6) * 1.8, drift: i % 4 === 0 }));
  let ok = true;
  try {
    const code = await bots[0].create();
    await Promise.all(bots.slice(1).map((b) => b.join(code)));
    await bots[0].waitFor("full lobby", () => bots[0].players.length === MAX_PLAYERS);
    console.log(`Lobby ${code}: ${MAX_PLAYERS} clients connected to ${server.url}`);
    const overflow = await new Bot(server.url, { name: "Thirteenth" }).join(code).then(() => false, () => true);
    console.log(`${overflow ? "PASS" : "FAIL"}  a 13th player is turned away`);
    ok &&= overflow;

    bots[0].room.send(MSG.SETTINGS, { laps: LAPS, trackId: TRACK });
    for (const b of bots.slice(1)) b.room.send(MSG.READY, true);
    await bots[0].waitFor("all ready", () => bots[0].players.filter((p) => p.ready).length === MAX_PLAYERS - 1);
    bots[0].room.send(MSG.START);
    await Promise.all(bots.map((b) => b.waitFor("race start", () => b.phase === "racing", 10_000)));

    const cpuSamples: number[] = [];
    let rssPeak = 0;
    let lastCpu = pid ? procCpuSeconds(pid) : null;
    let lastAt = Date.now();
    const sampler = setInterval(() => {
      if (!pid) return;
      const cpu = procCpuSeconds(pid);
      const now = Date.now();
      if (cpu !== null && lastCpu !== null) cpuSamples.push(((cpu - lastCpu) / ((now - lastAt) / 1000)) * 100);
      lastCpu = cpu;
      lastAt = now;
      rssPeak = Math.max(rssPeak, procRssMb(pid) ?? 0);
    }, 1000);

    const t0 = Date.now();
    await Promise.all(bots.map((b) => b.waitFor("results", () => b.phase === "results", 480_000)));
    clearInterval(sampler);
    const seconds = (Date.now() - t0) / 1000;

    const health = (await (await fetch(`${server.httpUrl}/health`)).json()) as { tick: { avgMs: number; maxMs: number }; memoryMb: number };
    const gaps = bots.flatMap((b) => b.snapshotGaps);
    const rtts = bots.flatMap((b) => b.rtts);
    const finished = bots[0].players.filter((p) => p.finished).length;
    const expectedGap = TICK_MS * SNAPSHOT_EVERY;
    const rate = bots.reduce((s, b) => s + b.snapshots, 0) / bots.length / seconds;

    console.log(`\n12-player race on ${TRACK}, ${LAPS} laps, ${seconds.toFixed(0)} s`);
    console.log(`  finishers             ${finished} / ${MAX_PLAYERS}`);
    console.log(`  simulation tick       avg ${health.tick.avgMs} ms, max ${health.tick.maxMs} ms (budget ${TICK_MS.toFixed(1)} ms)`);
    if (cpuSamples.length) {
      console.log(`  server CPU            avg ${(cpuSamples.reduce((a, b) => a + b, 0) / cpuSamples.length).toFixed(1)} %, peak ${Math.max(...cpuSamples).toFixed(1)} % of one core`);
      console.log(`  server memory (RSS)   peak ${rssPeak.toFixed(0)} MB`);
    } else {
      console.log(`  server memory (RSS)   ${health.memoryMb} MB`);
    }
    console.log(`  snapshot rate         ${rate.toFixed(1)} per second per client (target ${(1000 / expectedGap).toFixed(0)})`);
    console.log(`  snapshot interval     p50 ${percentile(gaps, 50).toFixed(0)} ms, p95 ${percentile(gaps, 95).toFixed(0)} ms, p99 ${percentile(gaps, 99).toFixed(0)} ms (target ${expectedGap.toFixed(0)})`);
    console.log(`  round-trip latency    p50 ${percentile(rtts, 50).toFixed(0)} ms, p95 ${percentile(rtts, 95).toFixed(0)} ms`);
    console.log(`  prediction            largest correction ${Math.max(...bots.map((b) => b.predictor.maxCorrection)).toFixed(2)} m across all clients`);

    const checks: [string, boolean][] = [
      ["all 12 racers finish", finished === MAX_PLAYERS],
      ["average tick uses under 20% of its budget", health.tick.avgMs < TICK_MS * 0.2],
      ["no tick overruns its budget", health.tick.maxMs < TICK_MS],
      ["snapshots arrive at the target rate", rate > (1000 / expectedGap) * 0.9],
      ["p95 snapshot interval under 1.5x target", percentile(gaps, 95) < expectedGap * 1.5],
    ];
    console.log("");
    for (const [name, pass] of checks) {
      console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
      ok &&= pass;
    }
  } finally {
    for (const b of bots) await b.leave().catch(() => {});
    await sleep(200);
    await server.stop();
  }
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
