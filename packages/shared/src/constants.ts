/** Simulation and protocol constants shared by the client and the game server. */

/** Fixed simulation rate. One player input = one simulation tick. */
export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;
export const TICK_MS = 1000 / TICK_RATE;

/** Kart snapshots are sent every N simulation ticks. 1 = every tick (30 Hz), for the smoothest motion. */
export const SNAPSHOT_EVERY = 1;

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
  driftGrip: 3.1,
  /**
   * A drift follows an arc of a set radius whatever the speed, so it corners the same in every
   * speed class. Metres: steering fully against the slide, stick centred, steering fully into it.
   */
  driftRadius: [120, 44, 19],
  driftMinSpeed: 11,
  /** Radians the tail steps out the instant a drift starts. */
  driftKick: 0.11,
  /** Seconds of drift charge needed for each mini-turbo level. */
  driftLevels: [0.55, 1.3, 2.2],
  /** Boost duration (seconds) granted by each mini-turbo level. */
  driftBoost: [0.7, 1.2, 1.9],
  boostExtraSpeed: 10,
  boostAccelMul: 2.2,
  offroadSpeedMul: 0.5,
  offroadBoostSpeedMul: 0.85,
  boostPadSeconds: 1.1,
} as const;

/**
 * Vehicles. Each multiplier is applied on top of the base kart tuning:
 * `speed` top speed, `accel` acceleration, `turn` steering, `drift` how tight a
 * drift is and how fast it charges, `weight` who gets shoved in a collision.
 */
export const VEHICLES = [
  { name: "Go-Kart", tag: "Balanced. Good at everything.", speed: 1, accel: 1, turn: 1, drift: 1, weight: 1 },
  { name: "Motorbike", tag: "Quick off the line and nimble, but light and a little slower flat out.", speed: 0.975, accel: 1.3, turn: 1.14, drift: 1.05, weight: 0.65 },
  { name: "Race Car", tag: "Highest top speed. Slow to get going and wide in corners.", speed: 1.045, accel: 0.8, turn: 0.9, drift: 0.94, weight: 1.15 },
  { name: "Digger", tag: "Heavy. Shoves others aside and barely notices a bump.", speed: 1.005, accel: 0.95, turn: 0.95, drift: 0.92, weight: 1.8 },
  { name: "Hot Hatch", tag: "Drift specialist: tighter slides that charge faster.", speed: 0.99, accel: 1.05, turn: 1, drift: 1.3, weight: 0.9 },
] as const;

/** Driver looks. Purely cosmetic. */
export const AVATARS = ["Oobi", "Oodi", "Ooli", "Oopi", "Oozi"] as const;

/** Time trials: solo, no power-ups, no chaos events, always this many laps. */
export const TRIAL_LAPS = 3;
const WEEK_MS = 7 * 86400_000;
/** Weeks roll over on Monday at midnight Eastern (05:00 UTC). */
const WEEK_EPOCH = Date.UTC(2024, 0, 1, 5);
export function weekIndex(now: number): number {
  return Math.floor((now - WEEK_EPOCH) / WEEK_MS);
}
export function weekBounds(index: number): { startsAt: number; endsAt: number } {
  return { startsAt: WEEK_EPOCH + index * WEEK_MS, endsAt: WEEK_EPOCH + (index + 1) * WEEK_MS };
}

/**
 * Speed classes. `k` scales top speed, acceleration and boosts; steering does
 * not scale, so every step up makes corners tighter and drifting matter more.
 */
export const SPEED_CLASSES = [
  { name: "Cruise", tag: "Relaxed", k: 1 },
  { name: "Fast", tag: "Standard", k: 1.2 },
  { name: "Turbo", tag: "Hard", k: 1.4 },
  { name: "Ludicrous", tag: "Expert", k: 1.65 },
] as const;
export const DEFAULT_SPEED_CLASS = 1;

/** Jump tricks, slipstreaming and rocket starts. */
export const TRICK = { minAirTicks: 9, boost: 0.9 } as const;
export const DRAFT = { minDist: 3, maxDist: 17, halfWidth: 1.7, chargeTicks: 40, boost: 1.3 } as const;
/** Rocket start: press accelerate this long before the lights go green (ms). Earlier than `early` stalls the engine. */
export const ROCKET = { early: 1500, good: 1000, perfect: 450, late: 60, boost: [0, 0.9, 1.6], stall: 0.7 } as const;

/** Snapshot flag bits for remote karts. */
export const FLAG = {
  DRIFT_LEFT: 1,
  DRIFT_RIGHT: 2,
  BOOST: 4,
  LEVEL_SHIFT: 3, // bits 3-4 hold the drift level (0-3)
  OFFROAD: 32,
  FINISHED: 64,
  AIRBORNE: 128,
} as const;

/** Arcade gravity (m/s^2) for jumps, and how hard slopes pull on a kart. */
export const GRAVITY = 34;
export const SLOPE_PULL = 16;

/**
 * How each surface changes handling. Index matches SURFACE_TYPES: asphalt, dirt,
 * mud, ice, snow, sand, boost, oil, conveyor, conveyorBack. `push` carries the
 * kart along the road (m/s).
 */
export const SURFACE_PHYSICS = [
  { speed: 1, accel: 1, grip: 1, turn: 1, push: 0 },
  { speed: 0.88, accel: 0.85, grip: 0.55, turn: 1, push: 0 },
  { speed: 0.6, accel: 0.45, grip: 0.8, turn: 0.85, push: 0 },
  { speed: 1, accel: 0.55, grip: 0.16, turn: 0.8, push: 0 },
  { speed: 0.82, accel: 0.7, grip: 0.5, turn: 0.95, push: 0 },
  { speed: 0.8, accel: 0.55, grip: 0.9, turn: 0.9, push: 0 },
  { speed: 1, accel: 1, grip: 1, turn: 1, push: 0 },
  { speed: 1, accel: 0.7, grip: 0.1, turn: 0.75, push: 0 },
  { speed: 1, accel: 1, grip: 1, turn: 1, push: 8 },
  { speed: 1, accel: 1, grip: 1, turn: 1, push: -7 },
] as const;

/** Second flag byte in snapshots: status effects on a kart. */
export const FX = { SPIN: 1, SHIELD: 2, PHANTOM: 4, GIANT: 8, MINI: 16, SLOW: 32, WATER: 64, REVERSED: 128, DRAFT: 256, TRICK: 512 } as const;

/** Race-wide chaos events. */
export const EVENT = { NONE: 0, LOW_GRAVITY: 1, SLIPPERY: 2, WIND: 3, FRENZY: 4, DOUBLE: 5, METEORS: 6, STORM: 7 } as const;
export const EVENT_INFO: { name: string; text: string }[] = [
  { name: "", text: "" },
  { name: "Low Gravity", text: "Jumps go much further." },
  { name: "Slippery Road", text: "The whole track handles like ice." },
  { name: "Mega Windstorm", text: "Gusts push karts sideways." },
  { name: "Obstacle Frenzy", text: "Every hazard speeds up." },
  { name: "Double Power-Ups", text: "Item boxes refill instantly." },
  { name: "Meteor Shower", text: "Get out of the red circles." },
  { name: "Thunderstorm", text: "Less grip, and lightning strikes." },
];
export const CHAOS_LEVELS = ["Normal", "Chaotic", "Absolute Mayhem"] as const;

/** Power-ups. `w` is the pick weight for a kart in the front, middle and back third of the field. */
export const ITEMS: { id: number; name: string; icon: string; text: string; w: [number, number, number] }[] = [
  { id: 0, name: "", icon: "", text: "", w: [0, 0, 0] },
  { id: 1, name: "Turbo Rocket", icon: "🚀", text: "Instant speed boost", w: [6, 8, 6] },
  { id: 2, name: "Slime Trap", icon: "🟢", text: "Drop a slippery puddle", w: [9, 5, 2] },
  { id: 3, name: "Homing Orb", icon: "🔮", text: "Chases the kart ahead", w: [1, 7, 7] },
  { id: 4, name: "Shockwave", icon: "💥", text: "Spins out karts around you", w: [3, 6, 5] },
  { id: 5, name: "Protective Bubble", icon: "🫧", text: "Blocks the next hit", w: [8, 5, 3] },
  { id: 6, name: "Lightning Pulse", icon: "⚡", text: "Slows everyone ahead of you", w: [0, 2, 6] },
  { id: 7, name: "Triple Turbo", icon: "⏩", text: "Three boosts", w: [1, 5, 7] },
  { id: 8, name: "Phantom Mode", icon: "👻", text: "Pass through karts and hazards", w: [3, 5, 4] },
  { id: 9, name: "Swap Portal", icon: "🌀", text: "Trade places with the kart ahead", w: [0, 2, 4] },
  { id: 10, name: "Mega Boost", icon: "🔥", text: "Long comeback boost", w: [0, 1, 7] },
  { id: 11, name: "Giant Magnet", icon: "🧲", text: "Drags nearby karts back to you", w: [0, 4, 5] },
  { id: 12, name: "Rocket Barrage", icon: "🎆", text: "Three rockets down the road", w: [1, 5, 5] },
  { id: 13, name: "Reverse Controls", icon: "🔄", text: "Flips the steering of the kart ahead", w: [0, 4, 5] },
  { id: 14, name: "Tornado", icon: "🌪️", text: "A twister runs up the track", w: [0, 3, 5] },
  { id: 15, name: "Giant Mode", icon: "🦖", text: "Grow huge and flatten karts", w: [0, 2, 5] },
  { id: 16, name: "Mini Mode", icon: "🐜", text: "Shrink for sharper steering", w: [4, 4, 2] },
  { id: 17, name: "Banana Storm", icon: "🍌", text: "Drop three slippery peels", w: [8, 4, 2] },
  { id: 18, name: "EMP Blast", icon: "📡", text: "Kills nearby boosts", w: [2, 4, 4] },
  { id: 19, name: "Teleport Dash", icon: "✨", text: "Warp a short way up the road", w: [0, 3, 6] },
  { id: 20, name: "Chaos Bomb", icon: "💣", text: "Big blast just ahead of you", w: [0, 4, 5] },
  { id: 21, name: "Gravity Pulse", icon: "🪐", text: "Flings nearby karts into the air", w: [2, 4, 4] },
  { id: 22, name: "Decoy Box", icon: "🎁", text: "Drop a fake item box", w: [8, 4, 1] },
];

/** Things the server puts on the track: [id, type, x, y, z, aux] in snapshots. */
export const ENTITY = { SLIME: 1, BANANA: 2, DECOY: 3, ORB: 4, ROCKET: 5, TORNADO: 6, METEOR: 7, BLAST: 8 } as const;
export const ENTITY_STRIDE = 6;

/** Grand-Prix style points by finishing place. */
export const POINTS = [15, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1, 0];
