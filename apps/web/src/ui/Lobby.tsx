import { useState } from "react";
import { AVATARS, CHAOS_LEVELS, KART, KART_COLORS, SPEED_CLASSES, MAX_LAPS, MAX_PLAYERS, MIN_LAPS, MSG, SURFACE_TYPES, TRACK_DEFS, VEHICLES, getTrack } from "@office-kart/shared";
import { net } from "../net/connection";
import { useMe, useStore, type Quality } from "../store";
import { BoardPanel } from "./Leaderboard";
import { Button, Panel } from "./common";

const AVATAR_ICONS = ["🟠", "🟢", "🔵", "🟣", "🔴"];
/** Stat bars: label, field, and the range across all vehicles. */
const STATS: [string, "speed" | "accel" | "turn" | "drift" | "weight", number, number][] = [
  ["Top speed", "speed", 0.97, 1.05],
  ["Acceleration", "accel", 0.8, 1.3],
  ["Handling", "turn", 0.9, 1.14],
  ["Drift", "drift", 0.9, 1.3],
  ["Weight", "weight", 0.65, 1.8],
];

export function Lobby() {
  const room = useStore((s) => s.room)!;
  const myId = useStore((s) => s.myId);
  const me = useMe();
  const [copied, setCopied] = useState<"idle" | "copied" | "manual">("idle");
  const quality = useStore((s) => s.quality);
  const setQuality = useStore((s) => s.setQuality);
  const settings = useStore((s) => s.settings);
  const touchUi = useStore((s) => s.touch);
  const setSettings = useStore((s) => s.setSettings);
  const isHost = room.hostId === myId;
  const link = `${location.origin}/r/${room.code}`;
  const others = room.players.filter((p) => p.connected && p.id !== room.hostId);
  const waiting = others.filter((p) => !p.ready).length;
  const hostName = room.players.find((p) => p.id === room.hostId)?.name ?? "the host";
  const taken = new Set(room.players.filter((p) => p.id !== myId).map((p) => p.color));

  const canSet = isHost && !room.weekly;
  const setGarage = useStore((s) => s.setGarage);
  /** Change vehicle or driver: remembered in this browser and sent to the room. */
  const pick = (patch: { vehicle?: number; avatar?: number }) => {
    setGarage(patch);
    net.send(MSG.KART, patch);
  };

  const copy = async () => {
    // On phones, open the share sheet (Messages, Slack, AirDrop...) instead of copying.
    if (touchUi && navigator.share) {
      try {
        await navigator.share({ title: "Office Kart", text: "Race me in Office Kart", url: link });
        return;
      } catch {
        /* cancelled: fall through to copying */
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopied("copied");
      setTimeout(() => setCopied("idle"), 2000);
    } catch {
      setCopied("manual");
    }
  };

  const actions = (
    <div className="flex gap-3">
      <Button variant="danger" onClick={() => net.leave()}>
        Leave
      </Button>
      {isHost ? (
        <Button className="flex-1 text-lg" disabled={waiting > 0} onClick={() => net.send(MSG.START)}>
          {waiting > 0 ? `Waiting for ${waiting} to ready up` : room.trial ? "Start run" : "Start race"}
        </Button>
      ) : (
        <Button className="flex-1 text-lg" variant={me?.ready ? "ghost" : "primary"} onClick={() => net.send(MSG.READY, !me?.ready)}>
          {me?.ready ? "Ready! (click to cancel)" : "I'm ready"}
        </Button>
      )}
    </div>
  );

  return (
    <div className={`absolute inset-0 overflow-y-auto bg-slate-950/45 p-4 ${touchUi ? "pb-28" : ""}`}>
      <div className="mx-auto grid max-w-4xl animate-rise gap-4 md:grid-cols-[1.15fr_1fr]">
        {room.trial ? (
          <Panel className="md:col-span-2">
            <div className="text-xs font-bold uppercase tracking-widest text-amber-300">{room.weekly ? "Weekly challenge" : "Time trial"}</div>
            <div className="text-3xl font-black">{TRACK_DEFS[room.trackId]?.name}</div>
            <p className="mt-1 text-sm text-white/60">
              Just you against the clock: {room.laps} laps, {SPEED_CLASSES[room.speed]?.name} speed, no power-ups and no chaos events. Your best time and best lap go on the leaderboard, and the record holder's ghost races with you.
              {room.weekly ? " Everyone gets the same track and speed this week." : ""}
            </p>
          </Panel>
        ) : (
        <Panel className="md:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-indigo-200">Lobby code</div>
                <div className="font-mono text-5xl font-black tracking-[0.25em] text-amber-300">{room.code}</div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Button variant="secondary" onClick={copy}>
                  {copied === "copied" ? "Link copied!" : touchUi ? "Share invite link" : "Copy invite link"}
                </Button>
                {copied === "manual" ? (
                  <input readOnly value={link} onFocus={(e) => e.target.select()} className="w-72 rounded-lg bg-white/10 px-2 py-1 font-mono text-xs text-white" />
                ) : (
                  <span className="text-xs text-white/50">Send the link to coworkers to let them in.</span>
                )}
              </div>
            </div>
          </Panel>
        )}

        {room.trial ? (
          <Panel>
            <h2 className="mb-3 text-lg font-black">Leaderboard</h2>
            <BoardPanel trackId={room.trackId} speed={room.speed} compact />
          </Panel>
        ) : (
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
        )}

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
            <h3 className="mb-1.5 mt-4 text-xs font-black uppercase tracking-widest text-indigo-200">Vehicle</h3>
            <div className="grid grid-cols-4 gap-1.5">
              {VEHICLES.map((v, i) => (
                <button key={v.name} type="button" aria-pressed={me?.vehicle === i} onClick={() => pick({ vehicle: i })} className={`rounded-xl border-2 px-1 py-2 text-center text-xs font-black transition ${me?.vehicle === i ? "border-amber-400 bg-amber-400/15" : "border-white/10 bg-white/5 hover:border-white/40"}`}>
                  {v.name}
                </button>
              ))}
            </div>
            {me && (
              <div className="mt-2 rounded-xl bg-white/5 p-3">
                <p className="mb-2 text-xs text-white/65">{VEHICLES[me.vehicle]?.tag}</p>
                <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-xs">
                  {STATS.map(([label, key, lo, hi]) => (
                    <div key={key} className="contents">
                      <dt className="text-white/55">{label}</dt>
                      <dd className="h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-amber-400 transition-[width]" style={{ width: `${Math.round(15 + (85 * (VEHICLES[me.vehicle][key] - lo)) / (hi - lo))}%` }} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            <h3 className="mb-1.5 mt-4 text-xs font-black uppercase tracking-widest text-indigo-200">Driver</h3>
            <div className="grid grid-cols-5 gap-1.5">
              {AVATARS.map((name, i) => (
                <button key={name} type="button" aria-pressed={me?.avatar === i} onClick={() => pick({ avatar: i })} className={`rounded-xl border-2 px-1 py-1.5 text-center text-xs font-bold transition ${me?.avatar === i ? "border-amber-400 bg-amber-400/15" : "border-white/10 bg-white/5 hover:border-white/40"}`}>
                  <span className="block text-lg leading-tight">{AVATAR_ICONS[i]}</span>
                  {name}
                </button>
              ))}
            </div>
          </Panel>

          <Panel>
            <h2 className="mb-3 text-lg font-black">{room.trial ? "Run settings" : "Race settings"}</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-white/60">Mode</dt>
                <dd className="font-bold">{room.weekly ? "Weekly Challenge" : room.trial ? "Time Trial" : "Quick Race"}</dd>
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
                        disabled={!canSet}
                        aria-pressed={selected}
                        onClick={() => net.send(MSG.SETTINGS, { trackId: t.id })}
                        className={`rounded-2xl border-2 px-3 py-2 text-left transition ${selected ? "border-amber-400 bg-amber-400/15" : "border-white/10 bg-white/5"} ${canSet && !selected ? "hover:border-white/40" : ""} ${!canSet && !selected ? "opacity-45" : ""}`}
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
              {!room.trial && (
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
              )}
              <div className="flex items-center justify-between gap-2">
                <dt className="text-white/60">Speed</dt>
                <dd className="flex rounded-xl bg-white/10 p-1">
                  {SPEED_CLASSES.map((c, i) => (
                    <button key={c.name} type="button" disabled={!canSet} aria-pressed={room.speed === i} title={`${c.tag} · top speed ${Math.round(KART.maxSpeed * c.k * 3.6)} km/h`} onClick={() => net.send(MSG.SETTINGS, { speed: i })} className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${room.speed === i ? (i === 3 ? "bg-rose-500 text-white" : "bg-amber-400 text-slate-900") : "text-white/70"}`}>
                      {c.name}
                    </button>
                  ))}
                </dd>
              </div>
              <div className="-mt-1 text-right text-xs text-white/50">
                {SPEED_CLASSES[room.speed]?.tag} · top speed {Math.round(KART.maxSpeed * (SPEED_CLASSES[room.speed]?.k ?? 1) * 3.6)} km/h
              </div>
              {!room.trial && (
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
              )}
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
              {touchUi && (
                <label className="flex items-center gap-2 text-white/80">
                  <input type="checkbox" checked={settings.autoGas} onChange={(e) => setSettings({ autoGas: e.target.checked })} className="accent-amber-400" /> Accelerate automatically
                </label>
              )}
              <label className="flex items-center gap-2 text-white/80">
                <input type="checkbox" checked={settings.shake} onChange={(e) => setSettings({ shake: e.target.checked })} className="accent-amber-400" /> Camera shake
              </label>
              <label className="flex items-center gap-2 text-white/80">
                <input type="checkbox" checked={settings.reducedFx} onChange={(e) => setSettings({ reducedFx: e.target.checked })} className="accent-amber-400" /> Reduced visual effects
              </label>
            </div>
          </Panel>

          {!touchUi && actions}
        </div>
      </div>
      {touchUi && (
        // On a phone the lobby is a long scroll, so Start / Ready stays pinned to the bottom.
        <div className="fixed inset-x-0 bottom-0 z-10 bg-slate-950/85 px-4 pt-3 backdrop-blur" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          <div className="mx-auto max-w-4xl">{actions}</div>
        </div>
      )}
    </div>
  );
}
