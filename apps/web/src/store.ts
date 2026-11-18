import { create } from "zustand";
import type { Notice, RoomView, TrialResult } from "@office-kart/shared";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting";
/** high: shadows, ambient occlusion, bloom. medium: shadows and bloom. low: neither. */
export type Quality = "high" | "medium" | "low";

export interface HudState {
  speed: number;
  driftCharge: number;
  driftLevel: number;
  boosting: boolean;
  offroad: boolean;
}

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  /** Camera shake on boosts and landings. */
  shake: boolean;
  /** Fewer particles and no screen effects. */
  reducedFx: boolean;
  /** Touch controls: accelerate automatically. */
  autoGas: boolean;
}

const SETTINGS_KEY = "office-kart:settings";
const DEFAULT_SETTINGS: Settings = { master: 0.8, music: 0.6, sfx: 0.9, shake: true, reducedFx: false, autoGas: true };

function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** True on phones and tablets, where the main way to point is a finger. */
export const IS_TOUCH = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;

interface Store {
  /** Show on-screen controls and the compact layout. */
  touch: boolean;
  settings: Settings;
  setSettings(patch: Partial<Settings>): void;
  /** Camera is below the water line. */
  underwater: boolean;
  /** Time of the ghost run being raced against right now (0 = none). */
  ghostMs: number;
  /** Time trial: whose record ghost is on track. */
  champion: { name: string; ms: number; mine: boolean } | null;
  /** How the last time-trial run scored. */
  trialResult: TrialResult | null;
  /** Chosen vehicle and driver look. */
  vehicle: number;
  avatar: number;
  setGarage(patch: { vehicle?: number; avatar?: number }): void;
  /** Random id kept in this browser so leaderboard entries stay with one person. */
  pid: string;
  /** While watching: which racer (by place order) the camera follows. */
  spectate: number;
  name: string;
  status: ConnectionStatus;
  room: RoomView | null;
  myId: string;
  error: string | null;
  toast: Notice | null;
  pingMs: number;
  hud: HudState;
  quality: Quality;
  /** True once the player has picked a quality level by hand; stops automatic changes. */
  qualityLocked: boolean;
  setQuality(quality: Quality, manual: boolean): void;
  setName(name: string): void;
  set(partial: Partial<Store>): void;
  showToast(notice: Notice): void;
}

const NAME_KEY = "office-kart:name";
const GARAGE_KEY = "office-kart:garage";
const PID_KEY = "office-kart:pid";

function loadGarage(): { vehicle: number; avatar: number } {
  try {
    const g = JSON.parse(localStorage.getItem(GARAGE_KEY) ?? "{}");
    return { vehicle: Number.isInteger(g.vehicle) ? g.vehicle : 0, avatar: Number.isInteger(g.avatar) ? g.avatar : 0 };
  } catch {
    return { vehicle: 0, avatar: 0 };
  }
}

function loadPid(): string {
  const make = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `p-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);
  try {
    let pid = localStorage.getItem(PID_KEY);
    if (!pid || !/^[a-z0-9-]{8,40}$/.test(pid)) {
      pid = make();
      localStorage.setItem(PID_KEY, pid);
    }
    return pid;
  } catch {
    return make();
  }
}
const QUALITY_KEY = "office-kart:quality";

function loadQuality(): Quality | null {
  try {
    const q = new URLSearchParams(location.search).get("q") ?? localStorage.getItem(QUALITY_KEY);
    return q === "high" || q === "medium" || q === "low" ? q : null;
  } catch {
    return null;
  }
}

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Start on a level the machine can hold, judged from its graphics chip. */
function detectQuality(): Quality {
  try {
    // Phones and tablets start light; it can be raised in the lobby.
    if (IS_TOUCH) return "low";
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return "low";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
    if (/swiftshader|llvmpipe|software|mali|adreno|powervr/i.test(name)) return "low";
    if (/intel|uhd|iris|hd graphics/i.test(name)) return "medium";
    return "high";
  } catch {
    return "medium";
  }
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<Store>((set) => ({
  name: loadName(),
  touch: IS_TOUCH,
  settings: loadSettings(),
  setSettings(patch) {
    set((s) => {
      const settings = { ...s.settings, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch {
        /* ignore */
      }
      return { settings };
    });
  },
  underwater: false,
  ghostMs: 0,
  champion: null,
  trialResult: null,
  ...loadGarage(),
  pid: loadPid(),
  setGarage(patch) {
    set(patch);
    try {
      const { vehicle, avatar } = useStore.getState();
      localStorage.setItem(GARAGE_KEY, JSON.stringify({ vehicle, avatar }));
    } catch {
      /* private mode: the choice lasts for this visit */
    }
  },
  spectate: 0,
  status: "idle",
  room: null,
  myId: "",
  error: null,
  toast: null,
  pingMs: 0,
  hud: { speed: 0, driftCharge: 0, driftLevel: 0, boosting: false, offroad: false },
  quality: loadQuality() ?? detectQuality(),
  qualityLocked: loadQuality() !== null,
  setQuality(quality, manual) {
    if (manual) {
      try {
        localStorage.setItem(QUALITY_KEY, quality);
      } catch {
        /* ignore */
      }
    }
    set(manual ? { quality, qualityLocked: true } : { quality });
  },
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
