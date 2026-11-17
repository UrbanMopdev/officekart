import { useState } from "react";
import { CHAOS_LEVELS, KART_COLORS, MAX_LAPS, MAX_PLAYERS, MIN_LAPS, MSG, SURFACE_TYPES, TRACK_DEFS, getTrack } from "@office-kart/shared";
import { net } from "../net/connection";
import { useMe, useStore, type Quality } from "../store";
import { Button, Panel } from "./common";

export function Lobby() {
  const room = useStore((s) => s.room)!;
  const myId = useStore((s) => s.myId);
  const me = useMe();
  const [copied, setCopied] = useState<"idle" | "copied" | "manual">("idle");
  const quality = useStore((s) => s.quality);
  const setQuality = useStore((s) => s.setQuality);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
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
                  {p.points > 0 && <span className="mr-2 rounded-full bg-white/15 px-2 py-0.5 text-xs tabular-nums">{p.points} pts</span>}
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
              <div>
                <dt className="mb-1.5 text-white/60">Track</dt>
                <dd className="grid max-h-64 gap-2 overflow-y-auto pr-1">
                  {Object.values(TRACK_DEFS).map((t) => {
                    const selected = t.id === room.trackId;
                    const lengthKm = (getTrack(t.id).length / 1000).toFixed(1);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        disabled={!isHost}
                        aria-pressed={selected}
                        onClick={() => net.send(MSG.SETTINGS, { trackId: t.id })}
                        className={`rounded-2xl border-2 px-3 py-2 text-left transition ${selected ? "border-amber-400 bg-amber-400/15" : "border-white/10 bg-white/5"} ${isHost && !selected ? "hover:border-white/40" : ""} ${!isHost && !selected ? "opacity-45" : ""}`}
                      >
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="font-black">{t.name}</span>
                          <span className="text-xs font-bold text-white/55">
                            {t.difficulty ? `${t.difficulty} · ` : ""}
                            {lengthKm} km lap
                          </span>
                        </span>
                        {selected && <span className="mt-0.5 block text-xs font-normal text-white/60">{t.blurb}</span>}
                      </button>
                    );
                  })}
                </dd>
              </div>
              <div className="rounded-2xl bg-white/5 px-3 py-2 text-xs text-white/70">
                {(() => {
                  const t = getTrack(room.trackId);
                  const minutes = Math.max(1, Math.round((t.length / 26) * room.laps / 60));
                  const terrain = [...new Set(t.zones.map((z) => SURFACE_TYPES[z.type].replace("conveyorBack", "conveyor")))];
                  if (t.waterLevel > -Infinity) terrain.push("water");
                  return (
                    <>
                      <div className="mb-1 flex flex-wrap gap-1.5">
                        {(t.def.features ?? []).map((f) => (
                          <span key={f} className="rounded-full bg-indigo-500/40 px-2 py-0.5 font-bold text-white">
                            {f}
                          </span>
                        ))}
                      </div>
                      <div>
                        {t.def.difficulty ?? "Medium"} · about {minutes} min race · {t.hazards.length} moving hazards · climbs {Math.round(t.maxY - t.minY)} m
                      </div>
                      <div>Terrain: {["asphalt", ...terrain].join(", ")}</div>
                    </>
                  );
                })()}
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-white/60">Chaos</dt>
                <dd className="flex rounded-xl bg-white/10 p-1">
                  {CHAOS_LEVELS.map((label, i) => (
                    <button key={label} type="button" disabled={!isHost} aria-pressed={room.chaos === i} onClick={() => net.send(MSG.SETTINGS, { chaos: i })} className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${room.chaos === i ? (i === 2 ? "bg-rose-500 text-white" : "bg-amber-400 text-slate-900") : "text-white/70"}`}>
                      {label}
                    </button>
                  ))}
                </dd>
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

          <Panel>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-black">Graphics and sound</h2>
              <div className="flex rounded-xl bg-white/10 p-1" role="group" aria-label="Graphics quality">
                {(["high", "medium", "low"] as Quality[]).map((q) => (
                  <button
                    key={q}
                    type="button"
                    aria-pressed={quality === q}
                    onClick={() => setQuality(q, true)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-bold capitalize transition ${quality === q ? "bg-amber-400 text-slate-900" : "text-white/70 hover:text-white"}`}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-2 text-xs text-white/45">High adds soft shadows, ambient occlusion and bloom. Drop to Medium or Low if the race feels choppy.</p>
            <div className="mt-3 space-y-2 text-sm">
              {(["master", "music", "sfx"] as const).map((k) => (
                <label key={k} className="flex items-center gap-3">
                  <span className="w-16 font-bold capitalize text-white/70">{k === "sfx" ? "Effects" : k}</span>
                  <input type="range" min={0} max={1} step={0.05} value={settings[k]} onChange={(e) => setSettings({ [k]: Number(e.target.value) })} className="flex-1 accent-amber-400" aria-label={`${k} volume`} />
                </label>
              ))}
              <label className="flex items-center gap-2 text-white/80">
                <input type="checkbox" checked={settings.shake} onChange={(e) => setSettings({ shake: e.target.checked })} className="accent-amber-400" /> Camera shake
              </label>
              <label className="flex items-center gap-2 text-white/80">
                <input type="checkbox" checked={settings.reducedFx} onChange={(e) => setSettings({ reducedFx: e.target.checked })} className="accent-amber-400" /> Reduced visual effects
              </label>
            </div>
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
