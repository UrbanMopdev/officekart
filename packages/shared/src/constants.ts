/** Simulation and protocol constants shared by the client and the game server. */

/** Fixed simulation rate. One player input = one simulation tick. */
export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;
export const TICK_MS = 1000 / TICK_RATE;

/** Kart snapshots are sent every N simulation ticks (30 / 2 = 15 Hz). */
export const SNAPSHOT_EVERY = 2;

export const ROOM_NAME = "race";
export const MAX_PLAYERS = 12;
export const CODE_LENGTH = 6;
/** No 0/O/1/I/L so codes are easy to read aloud. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const COUNTDOWN_MS = 4000;
/** Once the first racer finishes, everyone else has this long to finish. */
export const FINISH_GRACE_MS = 45_000;
/** Hard cap on a single race. */
export const MAX_RACE_MS = 20 * 60_000;
/** How long a dropped player's seat is held for reconnection. */
export const RECONNECT_SECONDS = 30;

export const MIN_LAPS = 1;
export const MAX_LAPS = 5;

export const NAME_MAX_LENGTH = 16;

/** Kart collision radius (world units, roughly metres). */
export const KART_RADIUS = 1.15;

export const KART_COLORS = [
  "#ef4444", // red
  "#3b82f6", // blue
  "#22c55e", // green
  "#f59e0b", // amber
  "#a855f7", // purple
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f97316", // orange
  "#84cc16", // lime
  "#06b6d4", // cyan
  "#eab308", // yellow
  "#64748b", // slate
] as const;

/** Kart handling. Tuned for an approachable arcade feel. */
export const KART = {
  maxSpeed: 30,
  maxReverse: 9,
  accel: 17,
  brake: 34,
  reverseAccel: 12,
  drag: 9,
  overspeedDecel: 14,
  turnRate: 2.35,
  /** Fraction of turn rate lost at top speed (speed-sensitive steering). */
  turnSpeedDamp: 0.38,
  grip: 9,
  driftGrip: 2.4,
  driftTurn: 2.05,
  driftMinSpeed: 13,
  /** Seconds of drift charge needed for each mini-turbo level. */
  driftLevels: [0.7, 1.6, 2.6],
  /** Boost duration (seconds) granted by each mini-turbo level. */
  driftBoost: [0.55, 1.0, 1.7],
  boostExtraSpeed: 10,
  boostAccelMul: 2.2,
  offroadSpeedMul: 0.5,
  offroadBoostSpeedMul: 0.85,
  boostPadSeconds: 1.1,
} as const;

/** Snapshot flag bits for remote karts. */
export const FLAG = {
  DRIFT_LEFT: 1,
  DRIFT_RIGHT: 2,
  BOOST: 4,
  LEVEL_SHIFT: 3, // bits 3-4 hold the drift level (0-3)
  OFFROAD: 32,
  FINISHED: 64,
} as const;
