/** Time-trial leaderboards: this week's challenge, and the best race and lap times for any track. */
import { useEffect, useState } from "react";
import { KART_COLORS, SPEED_CLASSES, TRACK_DEFS, VEHICLES, formatRaceTime, type BoardEntry, type Challenge } from "@office-kart/shared";
import { fetchBoard, fetchChallenge, type Board } from "../net/api";
import { useStore } from "../store";
import { Button, Panel } from "./common";

const TRACKS = Object.values(TRACK_DEFS);

export function useBoard(trackId: string, speed: number, board: "all" | "week", refresh = 0): Board | null | undefined {
  // undefined = loading, null = could not be loaded
  const [data, setData] = useState<Board | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setData(undefined);
    void fetchBoard(trackId, speed, board).then((b) => live && setData(b));
    return () => {
      live = false;
    };
  }, [trackId, speed, board, refresh]);
  return data;
}

export function useChallenge(refresh = 0): (Board & { challenge: Challenge }) | null | undefined {
  const [data, setData] = useState<(Board & { challenge: Challenge }) | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void fetchChallenge().then((c) => live && setData(c));
    return () => {
      live = false;
    };
  }, [refresh]);
  return data;
}

export function timeLeft(endsAt: number): string {
  const s = Math.max(0, Math.floor((endsAt - Date.now()) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h left` : h > 0 ? `${h}h ${Math.floor((s % 3600) / 60)}m left` : `${Math.floor(s / 60)}m left`;
}

const MEDALS = ["🥇", "🥈", "🥉"];

/** A ranked list. `by` picks which time is the headline. */
export function BoardList({ entries, by, limit = 10, empty }: { entries: BoardEntry[]; by: "race" | "lap"; limit?: number; empty: string }) {
  const pid = useStore((s) => s.pid);
  if (entries.length === 0) return <p className="rounded-xl bg-white/5 px-3 py-3 text-sm text-white/55">{empty}</p>;
  return (
    <ol className="space-y-1">
      {entries.slice(0, limit).map((e, i) => (
        <li key={e.pid} className={`flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-sm ${e.pid === pid ? "bg-amber-400/20 ring-1 ring-amber-300/60" : "bg-white/5"}`}>
          <span className="w-6 shrink-0 text-center font-black tabular-nums">{MEDALS[i] ?? i + 1}</span>
          <span className="h-3 w-3 shrink-0 rounded-full border border-white/60" style={{ background: KART_COLORS[e.color % KART_COLORS.length] }} />
          <span className="min-w-0 flex-1 truncate font-bold">
            {e.name}
            {e.pid === pid && <span className="ml-1.5 text-xs font-normal text-white/50">you</span>}
          </span>
          <span className="hidden shrink-0 text-xs text-white/45 sm:inline">{VEHICLES[e.vehicle]?.name}</span>
          <span className="shrink-0 font-mono font-black tabular-nums">{formatRaceTime(by === "race" ? e.raceMs : e.lapMs)}</span>
        </li>
      ))}
    </ol>
  );
}

/** The weekly challenge on the front page. */
export function WeeklyCard({ busy, onRace, onTrial, onBoards }: { busy: boolean; onRace(): void; onTrial(): void; onBoards(): void }) {
  const data = useChallenge();
  const c = data?.challenge;
  const track = c ? TRACK_DEFS[c.trackId] : null;
  return (
    <Panel className="mt-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-black uppercase tracking-widest text-amber-300">Weekly challenge</h2>
        {c && <span className="text-xs font-bold text-white/55">{timeLeft(c.endsAt)}</span>}
      </div>
      {data === undefined ? (
        <p className="mt-2 text-sm text-white/50">Loading this week's track…</p>
      ) : !c || !track ? (
        <p className="mt-2 text-sm text-white/55">The leaderboard can't be reached right now. You can still race.</p>
      ) : (
        <>
          <div className="mt-1 text-2xl font-black">{track.name}</div>
          <p className="mb-3 text-xs text-white/55">
            Solo against the clock: 3 laps at {SPEED_CLASSES[c.speed].name} speed. <strong className="text-white/80">No power-ups</strong> here, so every time is fair. Fastest by Sunday night wins the week. For a race with power-ups, create a lobby above.
          </p>
          <BoardList entries={data.race} by="race" limit={3} empty="Nobody has set a time this week. Be the first." />
          {data.me && data.myRank > 3 && (
            <p className="mt-2 text-sm text-white/70">
              You are #{data.myRank} with <span className="font-mono font-bold">{formatRaceTime(data.me.raceMs)}</span>
            </p>
          )}
        </>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={onRace} className="flex-1 whitespace-nowrap">
          Race the challenge
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={onTrial} className="whitespace-nowrap">
          Time trial
        </Button>
        <Button type="button" variant="ghost" onClick={onBoards} className="basis-full whitespace-nowrap">
          Leaderboards
        </Button>
      </div>
    </Panel>
  );
}

const pill = (on: boolean) => `rounded-lg px-2.5 py-1 text-xs font-bold transition ${on ? "bg-amber-400 text-slate-900" : "text-white/70 hover:text-white"}`;

/** Race-time and lap-time tables for one track and speed class. */
export function BoardPanel({ trackId, speed, refresh = 0, compact = false }: { trackId: string; speed: number; refresh?: number; compact?: boolean }) {
  const [board, setBoard] = useState<"all" | "week">("all");
  const data = useBoard(trackId, speed, board, refresh);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex rounded-xl bg-white/10 p-1">
          <button type="button" className={pill(board === "all")} onClick={() => setBoard("all")}>
            All time
          </button>
          <button type="button" className={pill(board === "week")} onClick={() => setBoard("week")}>
            This week
          </button>
        </div>
        {data?.me && (
          <span className="text-xs text-white/60">
            You: #{data.myRank} · {formatRaceTime(data.me.raceMs)}
          </span>
        )}
      </div>
      {data === undefined ? (
        <p className="py-3 text-sm text-white/50">Loading…</p>
      ) : data === null ? (
        <p className="py-3 text-sm text-white/55">The leaderboard can't be reached right now.</p>
      ) : (
        <div className={`grid gap-4 ${compact ? "" : "sm:grid-cols-2"}`}>
          <div>
            <h3 className="mb-1.5 text-xs font-black uppercase tracking-widest text-indigo-200">Race time (3 laps)</h3>
            <BoardList entries={data.race} by="race" limit={compact ? 5 : 10} empty="No times yet." />
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-black uppercase tracking-widest text-indigo-200">Best lap</h3>
            <BoardList entries={data.lap} by="lap" limit={compact ? 3 : 10} empty="No laps yet." />
          </div>
        </div>
      )}
    </div>
  );
}

/** Full-screen browser: pick any track and speed class. */
export function LeaderboardBrowser({ onClose }: { onClose(): void }) {
  const challenge = useChallenge();
  const [trackId, setTrackId] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const shownTrack = trackId ?? challenge?.challenge.trackId ?? TRACKS[0].id;
  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-slate-950/85 p-4 backdrop-blur-sm" role="dialog" aria-label="Leaderboards">
      <Panel className="mx-auto max-w-3xl animate-rise">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-2xl font-black">Leaderboards</h2>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {TRACKS.map((t) => (
            <button key={t.id} type="button" onClick={() => setTrackId(t.id)} className={`rounded-xl px-3 py-1.5 text-sm font-bold transition ${shownTrack === t.id ? "bg-amber-400 text-slate-900" : "bg-white/10 text-white/75 hover:bg-white/20"}`}>
              {t.name}
              {challenge?.challenge.trackId === t.id && <span className="ml-1.5 text-xs">★ this week</span>}
            </button>
          ))}
        </div>
        <div className="mb-4 flex w-fit rounded-xl bg-white/10 p-1">
          {SPEED_CLASSES.map((c, i) => (
            <button key={c.name} type="button" className={pill(speed === i)} onClick={() => setSpeed(i)}>
              {c.name}
            </button>
          ))}
        </div>
        <BoardPanel trackId={shownTrack} speed={speed} />
        <p className="mt-4 text-xs text-white/45">Times come from solo time trials: three laps, no power-ups, no chaos events. The server times every run.</p>
      </Panel>
    </div>
  );
}
