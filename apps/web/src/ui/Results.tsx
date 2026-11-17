import { KART_COLORS, MSG, formatRaceTime, ordinal } from "@office-kart/shared";
import { net } from "../net/connection";
import { useStore } from "../store";
import { Button, Panel } from "./common";

const MEDALS = ["bg-amber-400 text-slate-900", "bg-slate-300 text-slate-900", "bg-orange-400 text-slate-900"];

export function Results() {
  const room = useStore((s) => s.room)!;
  const myId = useStore((s) => s.myId);
  const isHost = room.hostId === myId;
  const racers = room.players.filter((p) => p.racing).sort((a, b) => a.place - b.place);
  const waitingRoom = room.players.filter((p) => !p.racing);
  const fastest = racers.reduce((best, p) => (p.bestLapMs > 0 && (best === 0 || p.bestLapMs < best) ? p.bestLapMs : best), 0);
  const hostName = room.players.find((p) => p.id === room.hostId)?.name ?? "the host";

  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-slate-950/55 p-4">
      <Panel className="w-full max-w-2xl animate-rise">
        <h1 className="mb-1 text-center text-3xl font-black text-amber-300">Race results</h1>
        <p className="mb-5 text-center text-sm text-white/55">
          {racers[0] ? `${racers[0].name} takes the win!` : "Nobody finished."}
        </p>
        <table className="w-full border-separate border-spacing-y-1.5 text-left">
          <thead>
            <tr className="text-xs uppercase tracking-widest text-white/45">
              <th className="px-3 font-bold">Pos</th>
              <th className="px-3 font-bold">Racer</th>
              <th className="px-3 text-right font-bold">Time</th>
              <th className="px-3 text-right font-bold">Best lap</th>
            </tr>
          </thead>
          <tbody>
            {racers.map((p) => (
              <tr key={p.id} className={p.id === myId ? "bg-white/15" : "bg-white/5"}>
                <td className="rounded-l-2xl px-3 py-2.5">
                  <span className={`inline-flex h-8 min-w-12 items-center justify-center rounded-full px-2 text-sm font-black ${MEDALS[p.place - 1] ?? "bg-white/10 text-white"}`}>{ordinal(p.place)}</span>
                </td>
                <td className="px-3 py-2.5 font-bold">
                  <span className="mr-2 inline-block h-3.5 w-3.5 rounded-full align-middle" style={{ background: KART_COLORS[p.color] }} />
                  {p.name}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">{p.finished ? formatRaceTime(p.finishMs) : "Did not finish"}</td>
                <td className="rounded-r-2xl px-3 py-2.5 text-right font-mono tabular-nums">
                  {p.bestLapMs > 0 ? formatRaceTime(p.bestLapMs) : "–"}
                  {p.bestLapMs > 0 && p.bestLapMs === fastest && <span className="ml-2 rounded-full bg-fuchsia-500/30 px-2 py-0.5 font-sans text-xs font-bold text-fuchsia-200">Fastest</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {waitingRoom.length > 0 && <p className="mt-3 text-sm text-white/55">Joining the next race: {waitingRoom.map((p) => p.name).join(", ")}</p>}

        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="danger" onClick={() => net.leave()}>
            Leave
          </Button>
          {isHost ? (
            <>
              <Button variant="secondary" className="flex-1" onClick={() => net.send(MSG.TO_LOBBY)}>
                Return to lobby
              </Button>
              <Button className="flex-1 text-lg" onClick={() => net.send(MSG.REMATCH)}>
                Rematch
              </Button>
            </>
          ) : (
            <p className="flex flex-1 items-center justify-center rounded-2xl bg-white/5 px-4 text-sm text-white/60">Waiting for {hostName} to start a rematch…</p>
          )}
        </div>
      </Panel>
    </div>
  );
}
