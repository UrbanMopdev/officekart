/** What you see after a time-trial run: your time, how it ranks, and the board. */
import { useEffect } from "react";
import { MSG, SPEED_CLASSES, TRACK_DEFS, formatRaceTime } from "@office-kart/shared";
import { net } from "../net/connection";
import { useMe, useStore } from "../store";
import { BoardPanel } from "./Leaderboard";
import { Button, Panel } from "./common";

const gap = (ms: number) => `${ms >= 0 ? "+" : "−"}${(Math.abs(ms) / 1000).toFixed(3)} s`;

export function TrialResults() {
  const room = useStore((s) => s.room)!;
  const result = useStore((s) => s.trialResult);
  const me = useMe();
  const finished = me?.finished === true;

  // Enter starts the next run straight away.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Enter" && !e.repeat) net.send(MSG.REMATCH);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  let headline = "Run complete";
  let tone = "text-amber-300";
  let detail = "";
  if (!finished) {
    headline = "Run not finished";
    tone = "text-white/70";
  } else if (!result) {
    detail = "Checking the leaderboard…";
  } else if (!result.saved) {
    detail = "The leaderboard could not be reached, so this run was not saved.";
  } else if (result.recordMs === 0 || result.raceMs < result.recordMs) {
    headline = "New track record!";
    tone = "text-fuchsia-300";
    detail = result.recordMs > 0 ? `You beat ${result.recordName}'s ${formatRaceTime(result.recordMs)} by ${((result.recordMs - result.raceMs) / 1000).toFixed(3)} s.` : "First time on this board. It is yours to defend.";
  } else if (result.improved) {
    headline = "New personal best!";
    tone = "text-emerald-300";
    detail = `${result.previousMs > 0 ? `${gap(result.raceMs - result.previousMs)} on your old best. ` : ""}${gap(result.raceMs - result.recordMs)} off ${result.recordName}'s record.`;
  } else {
    detail = `Your best is still ${formatRaceTime(result.previousMs)} (${gap(result.raceMs - result.previousMs)} this run). ${gap(result.raceMs - result.recordMs)} off the record.`;
  }

  return (
    <div className="absolute inset-0 overflow-y-auto bg-slate-950/55 p-4">
      <div className="mx-auto max-w-3xl animate-rise space-y-4">
        <Panel>
          <div className="text-center text-xs font-bold uppercase tracking-widest text-indigo-200">
            {room.weekly ? "Weekly challenge" : "Time trial"} · {TRACK_DEFS[room.trackId]?.name} · {SPEED_CLASSES[room.speed]?.name}
          </div>
          <h1 className={`mt-1 text-center text-3xl font-black ${tone}`}>{headline}</h1>
          {finished && me && (
            <div className="mt-3 flex items-end justify-center gap-8">
              <div className="text-center">
                <div className="font-mono text-5xl font-black tabular-nums">{formatRaceTime(me.finishMs)}</div>
                <div className="text-xs uppercase tracking-widest text-white/50">Race time</div>
              </div>
              <div className="text-center">
                <div className="font-mono text-2xl font-black tabular-nums text-white/85">{formatRaceTime(me.bestLapMs)}</div>
                <div className="text-xs uppercase tracking-widest text-white/50">Best lap</div>
              </div>
            </div>
          )}
          {detail && <p className="mt-3 text-center text-sm text-white/70">{detail}</p>}
          {result?.saved && (
            <p className="mt-1 text-center text-sm font-bold text-white/85">
              All-time rank #{result.rank} · this week #{result.weekRank}
            </p>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            <Button variant="danger" onClick={() => net.leave()}>
              Leave
            </Button>
            <Button variant="secondary" className="flex-1" onClick={() => net.send(MSG.TO_LOBBY)}>
              {room.weekly ? "Change vehicle" : "Change track or vehicle"}
            </Button>
            <Button className="flex-1 text-lg" onClick={() => net.send(MSG.REMATCH)}>
              Go again
            </Button>
          </div>
        </Panel>
        <Panel>
          <BoardPanel trackId={room.trackId} speed={room.speed} refresh={result ? result.raceMs + result.rank : 0} />
        </Panel>
      </div>
    </div>
  );
}
