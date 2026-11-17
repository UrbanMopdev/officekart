import { useEffect, useMemo, useRef, useState } from "react";
import { EVENT_INFO, ITEMS, KART_COLORS, TICK_RATE, formatRaceTime, getTrack, ordinal } from "@office-kart/shared";
import { kartActive, kartPos } from "../game/shared";
import { net } from "../net/connection";
import { useMe, useStore } from "../store";
import { CONTROLS, Kbd } from "./common";

/** Run a callback every animation frame while mounted. */
function useRaf(fn: () => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let id = 0;
    const loop = () => {
      ref.current();
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);
}

function Countdown({ startAt }: { startAt: number }) {
  const [label, setLabel] = useState("");
  useRaf(() => {
    const left = startAt - net.serverNow();
    const next = left > 3000 ? "" : left > 0 ? String(Math.ceil(left / 1000)) : left > -1100 ? "GO!" : "";
    if (next !== label) setLabel(next);
  });
  if (!label) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div key={label} className={`animate-pop text-outline text-[10rem] font-black leading-none ${label === "GO!" ? "text-emerald-300" : "text-amber-300"}`}>
        {label}
      </div>
    </div>
  );
}

function RaceTimer({ startAt, frozenMs }: { startAt: number; frozenMs: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useRaf(() => {
    if (!ref.current) return;
    const ms = frozenMs > 0 ? frozenMs : Math.max(0, net.serverNow() - startAt);
    const text = ms > 0 ? formatRaceTime(ms) : "0:00.000";
    if (ref.current.textContent !== text) ref.current.textContent = text;
  });
  return <div ref={ref} className="text-outline font-mono text-3xl font-black tabular-nums" />;
}

function MiniMap({ trackId }: { trackId: string }) {
  const room = useStore((s) => s.room)!;
  const myId = useStore((s) => s.myId);
  const dots = useRef<(SVGCircleElement | null)[]>([]);
  const map = useMemo(() => {
    const t = getTrack(trackId);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let d = "";
    for (let i = 0; i < t.n; i += 2) {
      minX = Math.min(minX, t.px[i]);
      maxX = Math.max(maxX, t.px[i]);
      minZ = Math.min(minZ, t.pz[i]);
      maxZ = Math.max(maxZ, t.pz[i]);
      // Drawn rotated 180° so the start straight runs along the bottom of the map.
      d += `${i === 0 ? "M" : "L"}${(-t.px[i]).toFixed(1)} ${(-t.pz[i]).toFixed(1)}`;
    }
    const pad = 16;
    return { d: d + "Z", box: `${-maxX - pad} ${-maxZ - pad} ${maxX - minX + pad * 2} ${maxZ - minZ + pad * 2}`, sx: -t.px[0], sz: -t.pz[0] };
  }, [trackId]);

  useRaf(() => {
    for (let slot = 0; slot < 12; slot++) {
      const el = dots.current[slot];
      if (!el) continue;
      if (kartActive[slot]) {
        el.setAttribute("cx", String(-kartPos[slot * 2]));
        el.setAttribute("cy", String(-kartPos[slot * 2 + 1]));
        el.style.display = "";
      } else {
        el.style.display = "none";
      }
    }
  });

  return (
    <svg viewBox={map.box} className="h-40 w-52 drop-shadow-lg" aria-label="Mini-map">
      <path d={map.d} fill="none" stroke="rgba(15,23,42,0.75)" strokeWidth={17} strokeLinejoin="round" />
      <path d={map.d} fill="none" stroke="rgba(248,250,252,0.9)" strokeWidth={9} strokeLinejoin="round" />
      <rect x={map.sx - 2} y={map.sz - 9} width={4} height={18} fill="#0f172a" />
      {room.players.map((p) => (
        <circle
          key={p.slot}
          ref={(el) => {
            dots.current[p.slot] = el;
          }}
          r={p.id === myId ? 8 : 6}
          fill={KART_COLORS[p.color]}
          stroke={p.id === myId ? "#ffffff" : "#0f172a"}
          strokeWidth={p.id === myId ? 3.5 : 2}
          style={{ display: "none" }}
        />
      ))}
    </svg>
  );
}

const LEVEL_COLORS = ["bg-slate-300", "bg-sky-400", "bg-orange-400", "bg-fuchsia-400"];

function PingBadge() {
  const ping = useStore((s) => s.pingMs);
  const color = ping < 80 ? "bg-emerald-400" : ping < 160 ? "bg-amber-400" : "bg-rose-500";
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-slate-900/60 px-2.5 py-1 text-xs font-bold tabular-nums" title="Round-trip latency to the game server">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {ping} ms
    </div>
  );
}

/** Announces a chaos event four seconds ahead, then counts it down. */
function EventBanner() {
  const room = useStore((s) => s.room)!;
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);
  if (!room.eventId || room.phase !== "racing") return null;
  const tick = net.raceTick();
  if (tick >= room.eventTo) return null;
  const info = EVENT_INFO[room.eventId];
  const coming = tick < room.eventFrom;
  const seconds = Math.max(0, Math.ceil(((coming ? room.eventFrom : room.eventTo) - tick) / TICK_RATE));
  return (
    <div className="absolute inset-x-0 top-24 flex justify-center">
      <div className={`animate-pop rounded-2xl px-5 py-2.5 text-center shadow-xl ${coming ? "bg-amber-400 text-slate-900" : "bg-rose-600 text-white"}`}>
        <div className="text-xs font-black uppercase tracking-widest">{coming ? `Incoming in ${seconds}` : `${seconds} s left`}</div>
        <div className="text-2xl font-black">{info.name}</div>
        <div className="text-sm font-bold opacity-80">{info.text}</div>
      </div>
    </div>
  );
}

function ItemSlot({ item, charges }: { item: number; charges: number }) {
  const it = ITEMS[item];
  return (
    <div className="absolute left-1/2 top-[4.6rem] -translate-x-1/2 text-center">
      <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border-4 text-4xl ${item ? "animate-pop border-amber-300 bg-slate-900/75" : "border-white/25 bg-slate-900/40"}`} key={item}>
        {it?.icon}
        {charges > 1 && <span className="absolute -right-1 -top-1 rounded-full bg-amber-400 px-1.5 text-xs font-black text-slate-900">{charges}</span>}
      </div>
      {item > 0 && (
        <div className="text-outline mt-1 text-xs font-black">
          {it.name} <span className="font-bold text-white/70">· Shift</span>
        </div>
      )}
    </div>
  );
}

export function Hud() {
  const room = useStore((s) => s.room)!;
  const myId = useStore((s) => s.myId);
  const hud = useStore((s) => s.hud);
  const me = useMe();
  const racers = room.players.filter((p) => p.racing).sort((a, b) => a.place - b.place);
  const spectating = !me?.racing;
  const underwater = useStore((s) => s.underwater);
  const watching = spectating || !!me?.finished;

  return (
    <div className="pointer-events-none absolute inset-0 select-none p-4">
      {underwater && <div className="absolute inset-0 bg-cyan-500/15 mix-blend-screen" />}
      {!spectating && !me?.finished && me && <ItemSlot item={me.item} charges={me.charges} />}
      <EventBanner />
      {watching && racers.length > 1 && (
        <div className="absolute inset-x-0 bottom-24 text-center">
          <span className="rounded-full bg-slate-900/70 px-4 py-2 text-sm font-bold">
            Spectating · <Kbd>←</Kbd> <Kbd>→</Kbd> switch racer
          </span>
        </div>
      )}
      {/* Position and lap */}
      {!spectating && me && (
        <div className="absolute left-4 top-4">
          <div className="text-outline text-7xl font-black leading-none text-amber-300">
            {ordinal(me.place || 1)}
            <span className="ml-2 text-2xl text-white/80">/ {racers.length}</span>
          </div>
          <div className="text-outline mt-2 text-2xl font-black">
            {me.lap >= room.laps && room.laps > 1 && !me.finished ? <span className="text-rose-300">Final lap</span> : <>Lap {Math.max(1, me.lap)} <span className="text-white/70">/ {room.laps}</span></>}
          </div>
        </div>
      )}

      {/* Timer */}
      <div className="absolute left-1/2 top-4 -translate-x-1/2 text-center">
        <RaceTimer startAt={room.raceStartAt} frozenMs={me?.finished ? me.finishMs : 0} />
        {me && me.bestLapMs > 0 && <div className="text-outline text-sm font-bold text-white/85">Best lap {formatRaceTime(me.bestLapMs)}</div>}
      </div>

      {/* Standings */}
      <div className="absolute right-4 top-4 flex w-52 flex-col items-end gap-2">
        <PingBadge />
        <ol className="w-full space-y-1">
          {racers.map((p) => (
            <li key={p.id} className={`flex items-center gap-2 rounded-xl px-2.5 py-1 text-sm font-bold ${p.id === myId ? "bg-amber-400 text-slate-900" : "bg-slate-900/60"} ${p.connected ? "" : "opacity-50"}`}>
              <span className="w-4 text-right tabular-nums">{p.place}</span>
              <span className="h-3 w-3 shrink-0 rounded-full border border-white/70" style={{ background: KART_COLORS[p.color] }} />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.finished ? <span aria-label="finished">🏁</span> : !p.connected ? <span className="text-xs font-normal">offline</span> : null}
            </li>
          ))}
        </ol>
      </div>

      {/* Mini-map */}
      <div className="absolute bottom-4 left-4">
        <MiniMap trackId={room.trackId} />
      </div>

      {/* Speed and drift charge */}
      {!spectating && !me?.finished && (
        <div className="absolute bottom-4 right-4 w-52 text-right">
          <div className={`mb-1 h-6 text-sm font-black uppercase tracking-widest ${hud.boosting ? "text-orange-300" : "text-teal-200"}`}>{hud.boosting ? "Boost!" : hud.offroad ? "Off the track" : ""}</div>
          <div className="text-outline text-6xl font-black tabular-nums leading-none">
            {hud.speed}
            <span className="ml-1 text-xl text-white/70">km/h</span>
          </div>
          <div className="mt-2 h-4 overflow-hidden rounded-full border-2 border-slate-900/70 bg-slate-900/55" role="meter" aria-label="Drift charge" aria-valuenow={Math.round(hud.driftCharge * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full rounded-full transition-[width] duration-100 ${LEVEL_COLORS[hud.driftLevel]}`} style={{ width: `${hud.driftCharge * 100}%` }} />
          </div>
          <div className="mt-1 text-xs font-bold uppercase tracking-widest text-white/75">Drift charge</div>
        </div>
      )}

      {room.phase === "countdown" && !spectating && (
        <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-wrap justify-center gap-x-4 gap-y-1 rounded-2xl bg-slate-900/65 px-4 py-2 text-xs text-white/90">
          {CONTROLS.map(([key, what]) => (
            <span key={key}>
              <Kbd>{key}</Kbd> {what}
            </span>
          ))}
        </div>
      )}

      {me?.finished && room.phase === "racing" && (
        <div className="absolute inset-x-0 top-1/3 text-center">
          <div className="animate-pop text-outline text-7xl font-black text-emerald-300">FINISHED!</div>
          <div className="text-outline mt-2 text-3xl font-black">
            {ordinal(me.place)} place · {formatRaceTime(me.finishMs)}
          </div>
          <div className="text-outline mt-2 text-sm text-white/85">Waiting for the others to cross the line…</div>
        </div>
      )}

      {spectating && (
        <div className="absolute inset-x-0 bottom-8 text-center">
          <span className="rounded-full bg-slate-900/70 px-4 py-2 text-sm font-bold">Watching this race. You'll be on the grid for the next one.</span>
        </div>
      )}

      {(room.phase === "countdown" || room.phase === "racing") && <Countdown startAt={room.raceStartAt} />}
    </div>
  );
}
