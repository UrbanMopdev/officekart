import { useState } from "react";
import { KART_COLORS, MAX_LAPS, MAX_PLAYERS, MIN_LAPS, MSG, TRACK_DEFS } from "@office-kart/shared";
import { net } from "../net/connection";
import { useMe, useStore } from "../store";
import { Button, Panel } from "./common";

export function Lobby() {
  const room = useStore((s) => s.room)!;
  const myId = useStore((s) => s.myId);
  const me = useMe();
  const [copied, setCopied] = useState<"idle" | "copied" | "manual">("idle");
  const isHost = room.hostId === myId;
  const link = `${location.origin}/r/${room.code}`;
  const others = room.players.filter((p) => p.connected && p.id !== room.hostId);
  const waiting = others.filter((p) => !p.ready).length;
  const hostName = room.players.find((p) => p.id === room.hostId)?.name ?? "the host";
  const taken = new Set(room.players.filter((p) => p.id !== myId).map((p) => p.color));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied("copied");
      setTimeout(() => setCopied("idle"), 2000);
    } catch {
      setCopied("manual");
    }
  };

  return (
    <div className="absolute inset-0 overflow-y-auto bg-slate-950/45 p-4">
      <div className="mx-auto grid max-w-4xl animate-rise gap-4 md:grid-cols-[1.15fr_1fr]">
        <Panel className="md:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-indigo-200">Lobby code</div>
              <div className="font-mono text-5xl font-black tracking-[0.25em] text-amber-300">{room.code}</div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <Button variant="secondary" onClick={copy}>
                {copied === "copied" ? "Link copied!" : "Copy invite link"}
              </Button>
              {copied === "manual" ? (
                <input readOnly value={link} onFocus={(e) => e.target.select()} className="w-72 rounded-lg bg-white/10 px-2 py-1 font-mono text-xs text-white" />
              ) : (
                <span className="text-xs text-white/50">Send the link to coworkers to let them in.</span>
              )}
            </div>
          </div>
        </Panel>

        <Panel>
          <h2 className="mb-3 flex items-baseline justify-between text-lg font-black">
            Racers
            <span className="text-sm font-bold text-white/50">
              {room.players.length} / {MAX_PLAYERS}
            </span>
          </h2>
          <ul className="space-y-2">
            {room.players.map((p) => (
              <li key={p.id} className={`flex items-center gap-3 rounded-2xl px-3 py-2 ${p.id === myId ? "bg-white/15" : "bg-white/5"}`}>
                <span className="h-7 w-7 shrink-0 rounded-full border-2 border-white/70" style={{ background: KART_COLORS[p.color] }} />
                <span className="min-w-0 flex-1 truncate font-bold">
                  {p.name}
                  {p.id === myId && <span className="ml-2 text-xs font-normal text-white/50">you</span>}
                </span>
                {!p.connected ? (
                  <span className="rounded-full bg-rose-500/25 px-2.5 py-0.5 text-xs font-bold text-rose-200">Reconnecting…</span>
                ) : p.id === room.hostId ? (
                  <span className="rounded-full bg-amber-400/25 px-2.5 py-0.5 text-xs font-bold text-amber-200">Host</span>
                ) : p.ready ? (
                  <span className="rounded-full bg-emerald-400/25 px-2.5 py-0.5 text-xs font-bold text-emerald-200">Ready</span>
                ) : (
                  <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-bold text-white/60">Not ready</span>
                )}
              </li>
            ))}
          </ul>
          {room.players.length < 2 && <p className="mt-3 text-sm text-white/55">You're the only one here. Share the link, or start now for a solo practice run.</p>}
        </Panel>

        <div className="space-y-4">
          <Panel>
            <h2 className="mb-3 text-lg font-black">Your kart</h2>
            <div className="grid grid-cols-6 gap-2">
              {KART_COLORS.map((c, i) => {
                const mine = me?.color === i;
                const isTaken = taken.has(i);
                return (
                  <button
                    key={c}
                    type="button"
                    disabled={isTaken}
                    aria-label={`Kart colour ${i + 1}${isTaken ? " (taken)" : ""}`}
                    aria-pressed={mine}
                    onClick={() => net.send(MSG.KART, { color: i })}
                    className={`aspect-square rounded-xl border-4 transition ${mine ? "scale-110 border-white" : "border-transparent hover:border-white/50"} ${isTaken ? "cursor-not-allowed opacity-20" : ""}`}
                    style={{ background: c }}
                  />
                );
              })}
            </div>
          </Panel>

          <Panel>
            <h2 className="mb-3 text-lg font-black">Race settings</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-white/60">Mode</dt>
                <dd className="font-bold">Quick Race</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-white/60">Track</dt>
                <dd className="font-bold">{TRACK_DEFS[room.trackId]?.name ?? room.trackId}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-white/60">Laps</dt>
                <dd className="flex items-center gap-2 font-bold">
                  {isHost && (
                    <button type="button" aria-label="Fewer laps" disabled={room.laps <= MIN_LAPS} onClick={() => net.send(MSG.SETTINGS, { laps: room.laps - 1 })} className="h-8 w-8 rounded-lg bg-white/10 text-lg hover:bg-white/20 disabled:opacity-30">
                      −
                    </button>
                  )}
                  <span className="w-6 text-center text-lg">{room.laps}</span>
                  {isHost && (
                    <button type="button" aria-label="More laps" disabled={room.laps >= MAX_LAPS} onClick={() => net.send(MSG.SETTINGS, { laps: room.laps + 1 })} className="h-8 w-8 rounded-lg bg-white/10 text-lg hover:bg-white/20 disabled:opacity-30">
                      +
                    </button>
                  )}
                </dd>
              </div>
            </dl>
            {!isHost && <p className="mt-3 text-xs text-white/45">{hostName} picks the settings and starts the race.</p>}
          </Panel>

          <div className="flex gap-3">
            <Button variant="danger" onClick={() => net.leave()}>
              Leave
            </Button>
            {isHost ? (
              <Button className="flex-1 text-lg" disabled={waiting > 0} onClick={() => net.send(MSG.START)}>
                {waiting > 0 ? `Waiting for ${waiting} to ready up` : "Start race"}
              </Button>
            ) : (
              <Button className="flex-1 text-lg" variant={me?.ready ? "ghost" : "primary"} onClick={() => net.send(MSG.READY, !me?.ready)}>
                {me?.ready ? "Ready! (click to cancel)" : "I'm ready"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
