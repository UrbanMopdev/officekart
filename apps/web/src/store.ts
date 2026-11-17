import { create } from "zustand";
import type { Notice, RoomView } from "@office-kart/shared";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting";

export interface HudState {
  speed: number;
  driftCharge: number;
  driftLevel: number;
  boosting: boolean;
  offroad: boolean;
}

interface Store {
  name: string;
  status: ConnectionStatus;
  room: RoomView | null;
  myId: string;
  error: string | null;
  toast: Notice | null;
  pingMs: number;
  hud: HudState;
  setName(name: string): void;
  set(partial: Partial<Store>): void;
  showToast(notice: Notice): void;
}

const NAME_KEY = "office-kart:name";

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<Store>((set) => ({
  name: loadName(),
  status: "idle",
  room: null,
  myId: "",
  error: null,
  toast: null,
  pingMs: 0,
  hud: { speed: 0, driftCharge: 0, driftLevel: 0, boosting: false, offroad: false },
  setName(name) {
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* private mode: just keep it in memory */
    }
    set({ name });
  },
  set(partial) {
    set(partial);
  },
  showToast(notice) {
    set({ toast: notice });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), 3500);
  },
}));

export function useMe() {
  return useStore((s) => s.room?.players.find((p) => p.id === s.myId));
}
