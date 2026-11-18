/** Read-only leaderboard requests to the game server. Scores are written by the server itself when a run ends. */
import type { BoardEntry, Challenge, GhostData } from "@office-kart/shared";
import { useStore } from "../store";
import { SERVER_URL } from "./connection";

const BASE = SERVER_URL.replace(/^ws/i, "http");

export interface Board {
  race: BoardEntry[];
  lap: BoardEntry[];
  me: BoardEntry | null;
  myRank: number;
}

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

const pid = () => encodeURIComponent(useStore.getState().pid);

export function fetchBoard(trackId: string, speed: number, board: "all" | "week"): Promise<Board | null> {
  return get<Board>(`/api/board?track=${encodeURIComponent(trackId)}&speed=${speed}&board=${board}&pid=${pid()}`);
}

export function fetchChallenge(): Promise<(Board & { challenge: Challenge }) | null> {
  return get(`/api/challenge?pid=${pid()}`);
}

/** The fastest run on a board, to race against. */
export function fetchGhost(trackId: string, speed: number, board: "all" | "week"): Promise<GhostData | null> {
  return get<GhostData>(`/api/ghost?track=${encodeURIComponent(trackId)}&speed=${speed}&board=${board}`);
}
