import { useEffect, useState } from "react";
import { KART_COLORS, MSG, POINTS, formatRaceTime, ordinal } from "@office-kart/shared";
import { net } from "../net/connection";
import { useMe, useStore } from "../store";
import { Button, Panel } from "./common";

const MEDALS = ["bg-amber-400 text-slate-900", "bg-slate-300 text-slate-900", "bg-orange-400 text-slate-900"];
const VOTES: [string, string][] = [
  ["same", "Same track"],
  ["random", "Random track"],
  ["harder", "Harder track"],
  ["mayhem", "Absolute Mayhem"],
];

/** Best time per track and lap count, kept in this browser. */
function usePersonalBest(trackId: string, laps: number, speed: number, finishMs: number): boolean {
  const [best, setBest] = useState(false);
  useEffect(() => {
    if (finishMs <= 0) return;
    try {
      const key = `office-kart:best:${trackId}:${laps}:${speed}`;
      const prev = Number(localStorage.getItem(key)) || Infinity;
      if (finishMs < prev) {
        localStorage.setItem(key, String(finishMs));
        setBest(prev !== Infinity);
      }
    } catch {
      /* ignore */
    }
  }, [trackId, laps, speed, finishMs]);
  return best;
}

export function Results() {
  const room = useStore((s) => s.room)!;
  const myId = useStore((s) => s.myId);
  const me = useMe();
  const isHost = room.hostId === myId;
  const racers = room.players.filter((p) => p.racing).sort((a, b) => a.place - b.place);
  const waitingRoom = room.players.filter((p) => !p.racing);
  const fastest = racers.reduce((best, p) => (p.bestLapMs > 0 && (best === 0 || p.bestLapMs < best) ? p.bestLapMs : best), 0);
  const hostName = room.players.find((p) => p.id === room.hostId)?.name ?? "the host";
  const personalBest = usePersonalBest(room.trackId, room.laps, room.speed, me?.finished ? me.finishMs : 0);
  const note = personalBest ? "New personal best!" : me?.note;
  const standings = [...room.players].sort((a, b) => b.points - a.points);
  const tally = (v: string) => room.players.filter((p) => p.vote === v).length;

  return (
    <div className="absolute inset-0 overflow-y-auto bg-slate-950/55 p-4">
      <div className="mx-auto grid max-w-5xl animate-rise gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Panel>
          <h1 className="mb-1 text-center text-3xl font-black text-amber-300">Race results</h1>
          <p className="mb-4 text-center text-sm text-white/55">{racers[0] ? `${racers[0].name} takes the win!` : "Nobody finished."}</p>
          {note && <p className="mb-4 rounded-2xl bg-emerald-500/25 px-4 py-2 text-center font-black text-emerald-100">{note}</p>}
          <table className="w-full border-separate border-spacing-y-1.5 text-left">
            <thead>
              <tr className="text-xs uppercase tracking-widest text-white/45">
                <th className="px-3 font-bold">Pos</th>
                <th className="px-3 font-bold">Racer</th>
                <th className="px-3 text-right font-bold">Time</th>
                <th className="px-3 text-right font-bold">Best lap</th>
                <th className="px-3 text-right font-bold">Pts</th>
              </tr>
            </thead>
            <tbody>
              {racers.map((p) => (
                <tr key={p.id} className={p.id === myId ? "bg-white/15" : "bg-white/5"}>
                  <td className="rounded-l-2xl px-3 py-2">
                    <span className={`inline-flex h-8 min-w-12 items-center justify-center rounded-full px-2 text-sm font-black ${MEDALS[p.place - 1] ?? "bg-white/10 text-white"}`}>{ordinal(p.place)}</span>
                  </td>
                  <td className="px-3 py-2 font-bold">
                    <span className="mr-2 inline-block h-3.5 w-3.5 rounded-full align-middle" style={{ background: KART_COLORS[p.color] }} />
                    {p.name}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{p.finished ? formatRaceTime(p.finishMs) : "Did not finish"}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {p.bestLapMs > 0 ? formatRaceTime(p.bestLapMs) : "–"}
                    {p.bestLapMs > 0 && p.bestLapMs === fastest && <span className="ml-2 rounded-full bg-fuchsia-500/30 px-2 py-0.5 font-sans text-xs font-bold text-fuchsia-200">Fastest</span>}
                  </td>
                  <td className="rounded-r-2xl px-3 py-2 text-right font-black tabular-nums">+{POINTS[p.place - 1] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {waitingRoom.length > 0 && <p className="mt-3 text-sm text-white/55">Joining the next race: {waitingRoom.map((p) => p.name).join(", ")}</p>}

          <h2 className="mb-2 mt-5 text-sm font-black uppercase tracking-widest text-white/60">Vote for the next race</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {VOTES.map(([id, label]) => (
              <button key={id} type="button" aria-pressed={me?.vote === id} onClick={() => net.send(MSG.VOTE, id)} className={`rounded-2xl border-2 px-2 py-2.5 text-sm font-black transition ${me?.vote === id ? "border-amber-400 bg-amber-400/20" : "border-white/10 bg-white/5 hover:border-white/40"} ${id === "mayhem" ? "text-rose-200" : ""}`}>
                {label}
                <span className="mt-0.5 block text-xs font-bold text-white/50">{tally(id)} vote{tally(id) === 1 ? "" : "s"}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-center text-xs text-white/50">{room.voteEndsAt > 0 ? "Everyone has voted. Starting…" : "The race starts when everyone has voted."}</p>

          <div className="mt-4 flex flex-wrap gap-3">
            <Button variant="danger" onClick={() => net.leave()}>
              Leave
            </Button>
            {isHost ? (
              <>
                <Button variant="secondary" className="flex-1" onClick={() => net.send(MSG.TO_LOBBY)}>
                  Return to lobby
                </Button>
                <Button className="flex-1 text-lg" onClick={() => net.send(MSG.REMATCH)}>
                  Rematch now
                </Button>
              </>
            ) : (
              <p className="flex flex-1 items-center justify-center rounded-2xl bg-white/5 px-4 text-sm text-white/60">{hostName} can also start a rematch straight away.</p>
            )}
          </div>
        </Panel>

        <div className="space-y-4">
          {room.awards.length > 0 && (
            <Panel>
              <h2 className="mb-3 text-lg font-black">Awards</h2>
              <ul className="space-y-2">
                {room.awards.map((a) => (
                  <li key={a.title} className="rounded-2xl bg-white/5 px-3 py-2">
                    <div className="text-xs font-black uppercase tracking-widest text-amber-300">{a.title}</div>
                    <div className="font-black">{a.name}</div>
                    <div className="text-xs text-white/60">{a.detail}</div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel>
            <h2 className="mb-3 text-lg font-black">Session standings</h2>
            <ol className="space-y-1.5">
              {standings.map((p, i) => (
                <li key={p.id} className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-bold ${p.id === myId ? "bg-white/15" : "bg-white/5"}`}>
                  <span className="w-5 text-right tabular-nums text-white/60">{i + 1}</span>
                  <span className="h-3 w-3 rounded-full" style={{ background: KART_COLORS[p.color] }} />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="text-xs font-normal text-white/50">
                    {p.wins} win{p.wins === 1 ? "" : "s"}
                  </span>
                  <span className="tabular-nums">{p.points} pts</span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  );
}
