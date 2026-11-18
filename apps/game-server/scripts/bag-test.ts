/**
 * Reserve power-ups: a racer who never presses the item button should fill the hand and both
 * reserve slots, and one who does should see the next power-up move up.
 */
import { MSG } from "@office-kart/shared";
import { Bot } from "./bot";
import { getServer } from "./spawn-server";

async function main(): Promise<void> {
  const server = await getServer();
  const hoarder = new Bot(server.url, { name: "Hoarder", lane: 0 });
  try {
    await hoarder.create();
    hoarder.room.send(MSG.SETTINGS, { laps: 3, chaos: 0 });
    hoarder.room.send(MSG.START);
    let most = 0;
    let promoted = false;
    let wasFull = false;
    const started = Date.now();
    while (Date.now() - started < 150_000 && hoarder.phase !== "results") {
      await new Promise((r) => setTimeout(r, 200));
      const p = hoarder.room.state.players.get(hoarder.room.sessionId) as { item: number; item2: number; item3: number } | undefined;
      if (!p) continue;
      const held = [p.item, p.item2, p.item3].filter((v) => v > 0).length;
      most = Math.max(most, held);
      if (held === 3 && !wasFull) {
        wasFull = true;
        // Use one: the hand should refill from the reserve at once.
        hoarder.opts.items = true;
      }
      if (wasFull && held === 2 && p.item > 0 && p.item3 === 0) {
        promoted = true;
        break;
      }
    }
    console.log(`${most === 3 ? "PASS" : "FAIL"}  a racer can carry three power-ups (most held: ${most})`);
    console.log(`${promoted ? "PASS" : "FAIL"}  using one moves the next up from the reserve`);
    process.exitCode = most === 3 && promoted ? 0 : 1;
  } finally {
    hoarder.room?.leave();
    await server.stop();
  }
}

void main();
