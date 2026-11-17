import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-amber-400 text-slate-900 shadow-[0_5px_0_#b45309] hover:bg-amber-300 active:translate-y-1 active:shadow-[0_1px_0_#b45309]",
  secondary: "bg-indigo-500 text-white shadow-[0_5px_0_#312e81] hover:bg-indigo-400 active:translate-y-1 active:shadow-[0_1px_0_#312e81]",
  ghost: "bg-white/10 text-white hover:bg-white/20",
  danger: "bg-white/10 text-rose-200 hover:bg-rose-500/30",
};

export function Button({ variant = "primary", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...rest}
      className={`rounded-2xl px-5 py-3 text-base font-bold tracking-wide transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:active:translate-y-0 ${VARIANTS[variant]} ${className}`}
    />
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-white/15 bg-slate-900/80 p-6 shadow-2xl backdrop-blur-md ${className}`}>{children}</div>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-white/25 bg-white/10 px-1.5 py-0.5 font-mono text-xs text-white">{children}</kbd>;
}

export const CONTROLS: [string, string][] = [
  ["W / ↑", "Accelerate"],
  ["S / ↓", "Brake / reverse"],
  ["A D / ← →", "Steer"],
  ["Space", "Hold while steering to drift"],
  ["R", "Reset kart"],
];
