/**
 * On-screen controls for phones and tablets. Left thumb steers by sliding
 * sideways anywhere on the left half; right thumb has drift, brake and the
 * power-up. Acceleration is automatic unless turned off in the lobby.
 */
import { useEffect, useRef, type PointerEvent, type ReactNode } from "react";
import { ITEMS } from "@office-kart/shared";
import { touch } from "../game/input";
import { useStore } from "../store";

/** How far the thumb slides for full lock, in CSS pixels. */
const STEER_TRAVEL = 64;
const LEVEL_RING = ["border-white/40", "border-sky-400", "border-orange-400", "border-fuchsia-400"];

function HoldButton({ onChange, className, label, children }: { onChange(down: boolean): void; className: string; label: string; children: ReactNode }) {
  const press = (down: boolean) => (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (down) e.currentTarget.setPointerCapture(e.pointerId);
    onChange(down);
  };
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={press(true)}
      onPointerUp={press(false)}
      onPointerCancel={press(false)}
      onContextMenu={(e) => e.preventDefault()}
      className={`pointer-events-auto flex touch-none select-none items-center justify-center rounded-full border-4 font-black text-white shadow-lg backdrop-blur-sm active:scale-95 active:brightness-125 ${className}`}
    >
      {children}
    </button>
  );
}

export function TouchControls({ item, charges, drift, level }: { item: number; charges: number; drift: number; level: number }) {
  const autoGas = useStore((s) => s.settings.autoGas);
  const knob = useRef<HTMLDivElement>(null);
  const pad = useRef<HTMLDivElement>(null);
  const origin = useRef<{ id: number; x: number } | null>(null);

  useEffect(() => {
    touch.autoGas = autoGas;
    return () => {
      // Leaving the race: let go of everything.
      touch.autoGas = false;
      touch.steering = false;
      touch.steer = 0;
      touch.gas = touch.brake = touch.drift = touch.use = false;
    };
  }, [autoGas]);

  const steerTo = (x: number) => {
    if (!origin.current) return;
    const v = Math.max(-1, Math.min(1, (x - origin.current.x) / STEER_TRAVEL));
    touch.steer = v;
    if (knob.current) knob.current.style.transform = `translateX(${v * STEER_TRAVEL}px)`;
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (origin.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    origin.current = { id: e.pointerId, x: e.clientX };
    touch.steering = true;
    touch.steer = 0;
    // The pad appears under the thumb, wherever it lands.
    if (pad.current) {
      const r = e.currentTarget.getBoundingClientRect();
      pad.current.style.left = `${e.clientX - r.left}px`;
      pad.current.style.top = `${e.clientY - r.top}px`;
      pad.current.style.opacity = "1";
    }
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (origin.current?.id === e.pointerId) steerTo(e.clientX);
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    if (origin.current?.id !== e.pointerId) return;
    origin.current = null;
    touch.steering = false;
    touch.steer = 0;
    if (knob.current) knob.current.style.transform = "translateX(0px)";
    if (pad.current) pad.current.style.opacity = "0.55";
  };

  const it = ITEMS[item];
  return (
    <div className="absolute inset-0">
      {/* Steering: the whole left half */}
      <div className="pointer-events-auto absolute bottom-0 left-0 top-1/4 w-1/2 touch-none" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div ref={pad} className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 opacity-55 transition-opacity" style={{ left: "26%", top: "62%" }}>
          <div className="flex h-16 w-48 items-center justify-center rounded-full border-2 border-white/35 bg-slate-900/35">
            <span className="absolute left-4 text-2xl text-white/60">‹</span>
            <span className="absolute right-4 text-2xl text-white/60">›</span>
            <div ref={knob} className="h-12 w-12 rounded-full border-2 border-white/80 bg-white/40" />
          </div>
        </div>
      </div>

      {/* Right thumb */}
      <div className="absolute bottom-3 flex items-end gap-3" style={{ right: "max(0.75rem, env(safe-area-inset-right))", bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
        <div className="flex flex-col items-center gap-3">
          <HoldButton label="Reset kart" onChange={(d) => d && (touch.reset = true)} className="h-11 w-11 border-white/30 bg-slate-900/50 text-xs">
            ↺
          </HoldButton>
          <HoldButton label="Brake" onChange={(d) => (touch.brake = d)} className="h-16 w-16 border-rose-300/70 bg-rose-600/55 text-xs">
            BRAKE
          </HoldButton>
        </div>
        <div className="flex flex-col items-center gap-3">
          <HoldButton label={item ? `Use ${it.name}` : "No power-up"} onChange={(d) => (touch.use = d)} className={`relative h-16 w-16 text-3xl ${item ? "animate-pop border-amber-300 bg-slate-900/70" : "border-white/25 bg-slate-900/35"}`}>
            {it?.icon}
            {charges > 1 && <span className="absolute -right-1 -top-1 rounded-full bg-amber-400 px-1.5 text-xs text-slate-900">{charges}</span>}
          </HoldButton>
          {!autoGas && (
            <HoldButton label="Accelerate" onChange={(d) => (touch.gas = d)} className="h-16 w-16 border-emerald-300/70 bg-emerald-600/55 text-xs">
              GAS
            </HoldButton>
          )}
        </div>
        <div className="relative">
          <HoldButton label="Drift" onChange={(d) => (touch.drift = d)} className={`h-24 w-24 bg-indigo-600/60 text-sm ${LEVEL_RING[level]}`}>
            DRIFT
          </HoldButton>
          {/* Drift charge fills up the edge of the button. */}
          <div className="pointer-events-none absolute inset-x-3 -top-3 h-2 overflow-hidden rounded-full bg-slate-900/60">
            <div className="h-full rounded-full bg-amber-300 transition-[width] duration-100" style={{ width: `${drift * 100}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
