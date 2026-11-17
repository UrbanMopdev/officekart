import { useEffect, useState } from "react";
import { normalizeCode } from "@office-kart/shared";
import { Game } from "./game/Game";
import { net } from "./net/connection";
import { useStore } from "./store";
import { Hud } from "./ui/Hud";
import { Lobby } from "./ui/Lobby";
import { Menu } from "./ui/Menu";
import { Results } from "./ui/Results";

/** Invitation links look like /r/ABC123 (or ?room=ABC123). */
function codeFromUrl(): string | null {
  const path = location.pathname.match(/^\/r\/([A-Za-z0-9]+)\/?$/);
  return normalizeCode(path?.[1] ?? new URLSearchParams(location.search).get("room") ?? "");
}

export function App() {
  const room = useStore((s) => s.room);
  const status = useStore((s) => s.status);
  const toast = useStore((s) => s.toast);
  const [inviteCode, setInviteCode] = useState<string | null>(codeFromUrl);
  const [booting, setBooting] = useState(true);

  // After a refresh, try to take back the seat we were holding.
  useEffect(() => {
    let alive = true;
    void net.resume().finally(() => alive && setBooting(false));
    return () => {
      alive = false;
    };
  }, []);

  // Keep the address bar pointing at the lobby so it can be shared or refreshed.
  const code = room?.code;
  useEffect(() => {
    if (code) {
      if (location.pathname !== `/r/${code}`) history.replaceState(null, "", `/r/${code}`);
      setInviteCode(code);
    }
  }, [code]);

  const clearInvite = () => {
    history.replaceState(null, "", "/");
    setInviteCode(null);
  };

  let screen;
  if (booting) {
    screen = <div className="menu-bg flex h-full items-center justify-center text-lg font-bold text-indigo-100">Loading…</div>;
  } else if (!room) {
    screen = <Menu inviteCode={inviteCode} onClearInvite={clearInvite} />;
  } else {
    screen = (
      <div className="relative h-full">
        <Game />
        {room.phase === "lobby" && <Lobby />}
        {(room.phase === "countdown" || room.phase === "racing") && <Hud />}
        {room.phase === "results" && <Results />}
      </div>
    );
  }

  return (
    <div className="h-full">
      {screen}
      {status === "reconnecting" && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/70">
          <div className="rounded-3xl bg-slate-900 px-8 py-6 text-center shadow-2xl">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-white/20 border-t-amber-400" />
            <div className="text-lg font-black">Connection lost. Reconnecting…</div>
            <div className="mt-1 text-sm text-white/60">Your seat is held for 30 seconds.</div>
            <button type="button" onClick={() => net.leave()} className="mt-4 text-sm text-indigo-200 underline-offset-4 hover:underline">
              Give up and return to the menu
            </button>
          </div>
        </div>
      )}
      {toast && (
        <div role="status" className={`absolute left-1/2 top-5 z-30 -translate-x-1/2 animate-rise rounded-2xl px-5 py-3 text-sm font-bold shadow-xl ${toast.level === "error" ? "bg-rose-600 text-white" : "bg-slate-800 text-white"}`}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
