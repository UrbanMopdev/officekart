/** Message names and wire shapes exchanged between client and game server. */

export type Phase = "lobby" | "countdown" | "racing" | "results";

export const MSG = {
  /** client -> server: [seq, inputBits, steer] */
  INPUT: "i",
  /** server -> all: [serverTimeMs, tick, [slot, x, z, heading, speed, flags] * karts] */
  SNAPSHOT: "s",
  /** server -> owner: [ackSeq, ...packKartState] */
  SELF: "m",
  /** client -> server: clientTimeMs */
  PING: "p",
  /** server -> client: [clientTimeMs, serverTimeMs] */
  PONG: "q",
  READY: "ready",
  KART: "kart",
  SETTINGS: "settings",
  START: "start",
  REMATCH: "rematch",
  TO_LOBBY: "lobby",
  /** server -> client: { level: "info" | "error", text } */
  NOTICE: "notice",
} as const;

/** Numbers per kart in a snapshot's flat array. */
export const SNAPSHOT_STRIDE = 6;

export interface JoinOptions {
  name: string;
  color?: number;
}

export interface Notice {
  level: "info" | "error";
  text: string;
}

/** Plain-object view of the synchronised room state, as the client uses it. */
export interface PlayerView {
  id: string;
  name: string;
  color: number;
  slot: number;
  ready: boolean;
  connected: boolean;
  racing: boolean;
  lap: number;
  place: number;
  finished: boolean;
  finishMs: number;
  bestLapMs: number;
}

export interface RoomView {
  code: string;
  phase: Phase;
  hostId: string;
  trackId: string;
  laps: number;
  raceStartAt: number;
  raceNumber: number;
  players: PlayerView[];
}
