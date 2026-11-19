import { useState, type FormEvent } from "react";
import { CODE_LENGTH, NAME_MAX_LENGTH, normalizeCode, sanitizeName } from "@office-kart/shared";
import { net } from "../net/connection";
import { useStore } from "../store";
import { Button, CONTROLS, Kbd, Panel } from "./common";
import { LeaderboardBrowser, WeeklyCard } from "./Leaderboard";

export function Menu({ inviteCode, onClearInvite }: { inviteCode: string | null; onClearInvite(): void }) {
  const name = useStore((s) => s.name);
  const setName = useStore((s) => s.setName);
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);
  const touchUi = useStore((s) => s.touch);
  const [code, setCode] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [boards, setBoards] = useState(false);
  const busy = status === "connecting";

  const validName = (): string | null => {
    const clean = sanitizeName(name);
    if (!clean) {
      setLocalError("Pick a nickname first (letters and numbers).");
      return null;
    }
    setLocalError(null);
    return clean;
  };

  const create = () => {
    const n = validName();
    if (n) void net.create(n);
  };

  /** A lobby that opens with computer-controlled cars in it; friends can still join with the code. */
  const vsCpu = () => {
    const n = validName();
    if (n) void net.create(n, { cpus: 5 });
  };

  /** Solo against the clock: this week's challenge, or any track. */
  const trial = (weekly: boolean) => {
    const n = validName();
    if (n) void net.create(n, weekly ? { weekly: true } : { trial: true });
  };

  const join = (raw: string) => {
    const n = validName();
    if (!n) return;
    const c = normalizeCode(raw);
    if (!c) {
      setLocalError(`Lobby codes are ${CODE_LENGTH} letters and numbers.`);
      return;
    }
    void net.join(c, n);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (inviteCode) join(inviteCode);
    else create();
  };

  const shown = localError ?? error;

  return (
    <div className="menu-bg flex h-full overflow-y-auto p-4">
      <div className="m-auto w-full max-w-md animate-rise">
        <div className="mb-3 text-center tall:mb-6">
          <div className="inline-block -rotate-2 rounded-2xl bg-amber-400 px-5 py-2 text-3xl font-black tracking-tight tall:text-5xl text-slate-900 shadow-[0_8px_0_#b45309]">
            OFFICE <span className="text-indigo-700">KART</span>
          </div>
          <p className="mt-3 text-sm text-indigo-100 tall:mt-5 tall:text-base">Race your coworkers around the office. Up to 12 karts per lobby.</p>
        </div>

        <Panel>
          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-bold uppercase tracking-widest text-indigo-200">Nickname</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={NAME_MAX_LENGTH}
                placeholder="e.g. Speedy Sam"
                autoFocus={!touchUi}
                autoComplete="nickname"
                className="w-full rounded-2xl border-2 border-white/20 bg-white/10 px-4 py-3 text-lg font-bold text-white placeholder:text-white/35 focus:border-amber-400 focus:outline-none"
              />
            </label>

            {inviteCode ? (
              <>
                <Button type="submit" disabled={busy} className="w-full text-lg">
                  {busy ? "Joining…" : `Join lobby ${inviteCode}`}
                </Button>
                <button type="button" onClick={onClearInvite} className="w-full text-sm text-indigo-200 underline-offset-4 hover:underline">
                  Create your own lobby instead
                </button>
              </>
            ) : (
              <>
                <Button type="submit" disabled={busy} className="w-full text-lg">
                  {busy ? "Creating…" : "Create private lobby"}
                </Button>
                <button type="button" disabled={busy} onClick={vsCpu} className="w-full rounded-2xl border-2 border-white/15 bg-white/5 px-4 py-2.5 text-sm font-bold text-white hover:border-white/40 disabled:opacity-50">
                  Race the computer <span className="font-normal text-white/55">· a lobby with 5 CPU cars</span>
                </button>
                <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-white/40">
                  <span className="h-px flex-1 bg-white/15" />
                  or join one
                  <span className="h-px flex-1 bg-white/15" />
                </div>
                <div className="flex gap-2">
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        join(code);
                      }
                    }}
                    placeholder="LOBBY CODE"
                    aria-label="Lobby code"
                    className="min-w-0 flex-1 rounded-2xl border-2 border-white/20 bg-white/10 px-4 py-3 text-center font-mono text-lg font-bold tracking-[0.3em] text-white placeholder:tracking-normal placeholder:text-white/35 focus:border-amber-400 focus:outline-none"
                  />
                  <Button type="button" variant="secondary" disabled={busy || code.length !== CODE_LENGTH} onClick={() => join(code)}>
                    Join
                  </Button>
                </div>
              </>
            )}

            {shown && (
              <p role="alert" className="rounded-xl bg-rose-500/20 px-3 py-2 text-sm text-rose-100">
                {shown}
              </p>
            )}
          </form>
        </Panel>

        {!inviteCode && <WeeklyCard busy={busy} onRace={() => trial(true)} onTrial={() => trial(false)} onBoards={() => setBoards(true)} />}
        {boards && <LeaderboardBrowser onClose={() => setBoards(false)} />}

        {touchUi && <p className="mt-5 text-center text-xs text-indigo-200">Touch controls appear when the race starts. Hold your phone sideways.</p>}
        <div className={`mt-5 flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-indigo-200 ${touchUi ? "hidden" : "flex"}`}>
          {CONTROLS.map(([key, what]) => (
            <span key={key}>
              <Kbd>{key}</Kbd> {what}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
