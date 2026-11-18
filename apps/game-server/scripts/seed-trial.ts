/** Test helper: one bot sets a time-trial time so a browser has a champion to race. */
import { MSG } from "@office-kart/shared";
import { Bot } from "./bot";
async function main() {
  const a = new Bot(process.env.SERVER_URL ?? "ws://127.0.0.1:2567", { name: "Trialist", lane: 0, join: { trial: true, trackId: "volcano-pass", speed: 3, vehicle: 2, avatar: 2, pid: "seed-driver-0001" } });
  await a.create();
  a.room.send(MSG.START);
  await a.waitFor("finish", () => a.me?.finished === true, 240_000);
  console.log("seeded", a.me?.finishMs);
  await new Promise((r) => setTimeout(r, 800));
  await a.leave();
  process.exit(0);
}
void main();
