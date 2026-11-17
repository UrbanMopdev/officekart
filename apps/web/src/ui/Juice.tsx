/**
 * The parts of the screen that make racing feel fast and eventful: speed
 * lines, and short call-outs for things the player just pulled off.
 */
import { useEffect, useRef, useState } from "react";
import { KART, driftLevel } from "@office-kart/shared";
import { audio } from "../audio";
import { feel } from "../game/shared";
import { net } from "../net/connection";
import { useStore } from "../store";

/** Streaks rushing in from the edges of the screen, stronger the faster the kart goes. */
export function SpeedLines() {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useStore((s) => s.settings.reducedFx);
  useEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g || reduced) return;
    let id = 0;
    let shown = false;
    const draw = () => {
      id = requestAnimationFrame(draw);
      const rush = feel.rush;
      if (rush < 0.04) {
        if (shown) g.clearRect(0, 0, canvas.width, canvas.height);
        shown = false;
        return;
      }
      shown = true;
      // Drawn small and stretched: the lines are soft anyway, and it costs almost nothing.
      const w = 480;
      const h = Math.max(160, Math.round((480 * canvas.clientHeight) / Math.max(1, canvas.clientWidth)));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      g.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h * 0.46;
      const reach = Math.hypot(cx, cy);
      g.lineCap = "round";
      const n = Math.round(10 + rush * 46);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r0 = reach * (0.5 + Math.random() * 0.4);
        const r1 = r0 + reach * (0.12 + Math.random() * 0.3) * (0.5 + rush);
        g.strokeStyle = feel.draft ? `rgba(165,243,252,${0.1 + rush * 0.3})` : `rgba(255,255,255,${0.07 + rush * 0.26})`;
        g.lineWidth = 0.6 + Math.random() * 1.6;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        g.stroke();
      }
    };
    id = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(id);
  }, [reduced]);
  if (reduced) return null;
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />;
}

type Tone = "gold" | "cyan" | "pink" | "red" | "white";
const TONES: Record<Tone, string> = { gold: "text-amber-300", cyan: "text-cyan-300", pink: "text-fuchsia-300", red: "text-rose-300", white: "text-white" };

/** Short messages for things that just happened to you: tricks, turbos, overtakes, the final lap. */
export function Callouts() {
  const [shown, setShown] = useState<{ id: number; text: string; tone: Tone } | null>(null);
  const room = useStore((s) => s.room);
  const myId = useStore((s) => s.myId);
  const me = room?.players.find((p) => p.id === myId);
  const say = useRef((_text: string, _tone: Tone) => {});
  const seq = useRef(0);

  useEffect(() => {
    let timer = 0;
    say.current = (text, tone) => {
      seq.current++;
      setShown({ id: seq.current, text, tone });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setShown(null), 1500);
    };
    return () => window.clearTimeout(timer);
  }, []);

  // Things the server tells us about: rocket starts and slipstream boosts.
  useEffect(() => {
    const onFx = (fx: { kind: string; slot?: number; item?: number }) => {
      const st = useStore.getState();
      const mine = st.room?.players.find((p) => p.id === st.myId)?.slot === fx.slot;
      if (!mine) return;
      if (fx.kind === "rocket") say.current(fx.item === 2 ? "PERFECT START!" : "ROCKET START!", "gold");
      if (fx.kind === "draft") say.current("SLIPSTREAM!", "cyan");
    };
    net.fxListeners.add(onFx);
    return () => void net.fxListeners.delete(onFx);
  }, []);

  // Things our own kart does: tricks and drift turbos, read straight from the simulation.
  useEffect(() => {
    const last = { trick: 0, drift: 0, charge: 0, boost: 0 };
    const id = window.setInterval(() => {
      if (!net.isDriving()) return;
      const k = net.predictor.state;
      if (k.trick !== 0 && last.trick === 0) {
        say.current("TRICK!", "pink");
        audio.play("trick");
      }
      if (last.drift !== 0 && k.driftDir === 0 && k.boost > last.boost) {
        const level = driftLevel(last.charge);
        if (level >= 2) say.current(level === 3 ? "ULTRA TURBO!" : "SUPER TURBO!", level === 3 ? "pink" : "gold");
      }
      last.trick = k.trick;
      last.drift = k.driftDir;
      last.charge = k.driftCharge;
      last.boost = k.boost;
    }, 33);
    return () => window.clearInterval(id);
  }, []);

  // Places gained and lost, and the final lap.
  const prev = useRef({ race: -1, place: 0, lap: 0 });
  const place = me?.place ?? 0;
  const lap = me?.lap ?? 0;
  useEffect(() => {
    if (!room || !me?.racing || room.phase !== "racing" || me.finished) {
      if (room) prev.current = { race: room.raceNumber, place, lap };
      return;
    }
    const p = prev.current;
    if (p.race === room.raceNumber && net.serverNow() - room.raceStartAt > 4000) {
      if (p.place > 0 && place < p.place) {
        const passed = room.players.find((x) => x.racing && x.place === place + 1);
        say.current(passed ? `Passed ${passed.name}!` : "Overtake!", "gold");
      } else if (p.place > 0 && place > p.place) {
        const by = room.players.find((x) => x.racing && x.place === place - 1);
        if (by) say.current(`${by.name} got past you!`, "red");
      }
      if (lap > p.lap && lap >= room.laps && room.laps > 1) say.current("FINAL LAP!", "red");
    }
    prev.current = { race: room.raceNumber, place, lap };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place, lap, room?.raceNumber, room?.phase]);

  if (!shown) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[30%] flex justify-center">
      <div key={shown.id} className={`animate-callout text-outline text-center text-3xl font-black italic tracking-tight tall:text-5xl ${TONES[shown.tone]}`}>
        {shown.text}
      </div>
    </div>
  );
}

/** Shown on the grid: how to get a rocket start. */
export function RocketHint({ touchUi }: { touchUi: boolean }) {
  return (
    <div className="absolute inset-x-0 top-[62%] flex justify-center tall:top-[66%]">
      <div className="rounded-full bg-slate-900/70 px-4 py-1.5 text-center text-xs font-bold text-amber-200 tall:text-sm">
        Rocket start: {touchUi ? "press and hold DRIFT" : "hit the accelerator"} just after <span className="text-white">1</span> appears. Not before!
      </div>
    </div>
  );
}

/** Top speed of a class in the units the speedometer shows. */
export function classTopSpeed(k: number): number {
  return Math.round(KART.maxSpeed * k * 3.6);
}
