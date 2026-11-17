/** Message names and wire shapes exchanged between client and game server. */

export type Phase = "lobby" | "countdown" | "racing" | "results";

export const MSG = {
  /** client -> server: [seq, inputBits, steer] */
  INPUT: "i",
  /** server -> all: [serverTimeMs, tick, [slot, x, z, heading, speed, flags, y, fx] * karts, entities, takenBoxes] */
  SNAPSHOT: "s",
  /** server -> owner: [ackSeq, ...packKartState] */
  SELF: "m",
  /** client -> server: clientTimeMs */
  PING: "p",
  /** server -> client: [clientTimeMs, serverTimeMs] */
  PONG: "q",
  /** client -> server during the countdown: true/false as the accelerator goes down/up (rocket starts) */
  REV: "rev",
  READY: "ready",
  KART: "kart",
  SETTINGS: "settings",
  START: "start",
  REMATCH: "rematch",
  TO_LOBBY: "lobby",
  /** client -> server: "same" | "random" | "harder" | "mayhem" */
  VOTE: "vote",
  /** server -> all: { kind, slot?, x?, y?, z?, item? } one-off happenings for sound and effects */
  FX: "fx",
  /** server -> client: { level: "info" | "error", text } */
  NOTICE: "notice",
} as const;

/** Numbers per kart in a snapshot's flat array. */
export const SNAPSHOT_STRIDE = 8;

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
  item: number;
  charges: number;
  wins: number;
  points: number;
  vote: string;
  note: string;
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
  chaos: number;
  /** Index into SPEED_CLASSES. */
  speed: number;
  eventId: number;
  eventFrom: number;
  eventTo: number;
  hzOff: number;
  voteEndsAt: number;
  awards: { title: string; name: string; detail: string }[];
}

export interface FxMessage {
  kind: string;
  slot?: number;
  x?: number;
  y?: number;
  z?: number;
  item?: number;
}
