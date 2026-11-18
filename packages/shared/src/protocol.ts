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
  /** client -> server in a time trial: start the run again from the grid */
  RESTART: "restart",
  /** server -> client: how a time-trial run scored */
  TRIAL: "trial",
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
  vehicle?: number;
  avatar?: number;
  /** A random id kept in the browser, so leaderboard entries belong to one person across sessions. */
  pid?: string;
}

/** Options when creating a room. A trial room is a solo time trial. */
export interface CreateOptions extends JoinOptions {
  trial?: boolean;
  /** This week's challenge: the track and speed class are fixed by the server. */
  weekly?: boolean;
  trackId?: string;
  speed?: number;
}

export interface BoardEntry {
  pid: string;
  name: string;
  color: number;
  vehicle: number;
  avatar: number;
  raceMs: number;
  lapMs: number;
  at: number;
}

export interface Challenge {
  week: number;
  trackId: string;
  speed: number;
  startsAt: number;
  endsAt: number;
}

/** Sent to a time-trial driver when the run is over and has been scored. */
export interface TrialResult {
  raceMs: number;
  lapMs: number;
  /** Rank on the all-time board for this track and speed class (0 = not saved). */
  rank: number;
  weekRank: number;
  /** Previous best race time on the all-time board, 0 if this was the first run. */
  previousMs: number;
  improved: boolean;
  /** Fastest time on the board before this run (0 = board was empty). */
  recordMs: number;
  recordName: string;
  saved: boolean;
}

export interface GhostData {
  name: string;
  pid: string;
  ms: number;
  /** Base64 of 16-bit samples: x, y, z, heading every three ticks. */
  d: string;
  color: number;
  vehicle: number;
  avatar: number;
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
  vehicle: number;
  avatar: number;
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
  /** Solo time trial: no power-ups or chaos events, and the run is scored on the leaderboard. */
  trial: boolean;
  /** The trial is this week's challenge, so its settings are fixed. */
  weekly: boolean;
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
