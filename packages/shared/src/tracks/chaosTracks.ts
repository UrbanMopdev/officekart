/**
 * The eight Office Kart 2.0 circuits. Layouts are either hand-drawn control
 * points or lobed loops from `lobes()`; everything that makes a track play
 * differently (height, surfaces, jumps, hazards, wind, water) is data here.
 */
import type { ElevationKey, GapDef, SurfaceDef, TrackDef } from "../track";
import { NEON_NIGHTS } from "./neonNights";
import { OFFICE_DASH } from "./officeDash";
import { PROVING_GROUNDS } from "./provingGrounds";

/** A closed loop with `k` lobes: radius R, lobe depth `a`, stretched by sx/sz. */
function lobes(R: number, k: number, a: number, sx = 1, sz = 1, b = 0, m = 2, turn = 0): [number, number][] {
  const pts: [number, number][] = [];
  const N = 30;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const r = R * (1 + a * Math.sin(k * t) + b * Math.sin(m * t + 1.1));
    pts.push([Math.round(r * Math.cos(t + turn) * sx), Math.round(r * Math.sin(t + turn) * sz)]);
  }
  return pts;
}

const mirrorX = (p: [number, number][]): [number, number][] => p.map(([x, z]) => [-x, z]);
const mirrorZ = (p: [number, number][]): [number, number][] => p.map(([x, z]) => [x, -z]);

/**
 * A ramp, a gap and a landing. `L` is the lap length in metres. Returns the
 * height keys, the gap, and the boost road that guarantees enough speed.
 */
function jump(L: number, at: number, y0: number, rise: number, y1: number, gapMetres = 22): { keys: ElevationKey[]; gap: GapDef; boost: SurfaceDef } {
  const ramp = 24 / L;
  const g = gapMetres / L;
  return {
    keys: [
      [at - ramp, y0],
      [at, y0 + rise, "linear"],
      [at + g + 0.003, y1 + 1.5, "linear"],
      [at + g + 40 / L, y1],
    ],
    gap: { from: at + 0.001, to: at + g, respawn: at - 110 / L },
    boost: { type: "boost", from: at - 100 / L, to: at - 0.001 },
  };
}

/** A table-top: up a ramp and off the end, no gap. */
function table(L: number, at: number, y: number, rise = 5): ElevationKey[] {
  return [
    [at - 26 / L, y],
    [at, y + rise, "linear"],
    [at + 9 / L, y - 0.5, "linear"],
  ];
}

const BASE = { roadHalfWidth: 7.5, wallHalfWidth: 10.5, checkpointCount: 16, defaultLaps: 3, autoBank: 1 } as const;
const PADS = (ats: number[]) => ats.map((at, i) => ({ at, lateral: [0, 3.2, -3.2][i % 3], halfWidth: 2.6, length: 7 }));

// ---------------------------------------------------------------- 1. Office
const officeJump = jump(1875, 0.31, 24, 3, 3, 24);
export const OFFICE_APOCALYPSE: TrackDef = {
  ...BASE,
  id: "office-apocalypse",
  name: "Office Apocalypse",
  theme: "office",
  difficulty: "Medium",
  music: 0,
  blurb: "The office has lost it: runaway chairs, escalators, a coffee spill and a leap across the atrium.",
  features: ["Atrium jump", "Rolling chairs", "Escalators", "Coffee spill"],
  controlPoints: OFFICE_DASH.controlPoints,
  elevation: [[0, 0], [0.13, 0], [0.2, 14], [0.25, 24], ...officeJump.keys, [0.42, 0], [0.6, 0], ...table(1875, 0.7, 0, 5.5), [0.78, 0], [0.84, 9], [0.9, 9], [0.95, 0]],
  gaps: [officeJump.gap],
  surfaces: [
    officeJump.boost,
    { type: "conveyor", from: 0.43, to: 0.475, lateral: [-7.5, -0.4] },
    { type: "conveyorBack", from: 0.43, to: 0.475, lateral: [0.4, 7.5] },
    { type: "oil", from: 0.585, to: 0.61, lateral: [-5, 4] },
    { type: "conveyor", from: 0.8, to: 0.835 },
  ],
  hazards: [
    { kind: "roller", at: 0.075, radius: 2.3, period: 4.6, amp: 6, look: "chair" },
    { kind: "roller", at: 0.385, radius: 2.3, period: 3.8, amp: 6, phase: 0.4, look: "chair" },
    { kind: "runner", from: 0.56, to: 0.5, lateral: 3.5, radius: 2.4, period: 7, look: "cart" },
    { kind: "spinner", at: 0.655, length: 13, period: 4.2, look: "fan" },
    { kind: "roller", at: 0.76, radius: 2.3, period: 4.2, amp: 6, phase: 0.7, look: "chair" },
    { kind: "spinner", at: 0.875, length: 12, period: 5, look: "table" },
  ],
  boostPads: PADS([0.045, 0.37, 0.52, 0.73, 0.94]),
};

// --------------------------------------------------------------- 2. Volcano
const VL = 1650;
const volcanoJump = jump(VL, 0.63, 30, 6, 18);
export const VOLCANO_MAYHEM: TrackDef = {
  ...BASE,
  id: "volcano-mayhem",
  name: "Volcano Mayhem",
  theme: "volcano",
  difficulty: "Extreme",
  music: 1,
  blurb: "Up the side of an erupting volcano, along the crater rim with no barrier, and back down over lava.",
  features: ["58 m climb", "Falling boulders", "Steam geysers", "Lava jump"],
  controlPoints: lobes(205, 3, 0.2, 1.15, 0.9),
  elevation: [[0, 0], [0.05, 0], [0.16, 22], [0.3, 50], [0.36, 58], [0.46, 58], [0.54, 34], [0.59, 30], ...volcanoJump.keys, [0.76, 14], [0.84, 20], [0.92, 4], [0.97, 0]],
  gaps: [volcanoJump.gap],
  openSides: [{ from: 0.37, to: 0.45, side: 1 }],
  surfaces: [volcanoJump.boost, { type: "dirt", from: 0.2, to: 0.3 }, { type: "dirt", from: 0.8, to: 0.88, lateral: [-7.5, 0] }],
  hazards: [
    { kind: "runner", from: 0.3, to: 0.1, lateral: -3.5, radius: 2.6, period: 9, look: "boulder" },
    { kind: "runner", from: 0.33, to: 0.13, lateral: 3.5, radius: 2.6, period: 9, phase: 0.5, look: "boulder" },
    { kind: "geyser", at: 0.4, lateral: -3.5, radius: 3, period: 4.5, active: 0.3, power: 16 },
    { kind: "geyser", at: 0.43, lateral: 2.5, radius: 3, period: 4.5, active: 0.3, power: 16, phase: 0.5 },
    { kind: "collapse", from: 0.5, to: 0.515, period: 8, solid: 0.72 },
    { kind: "platform", from: 0.725, to: 0.74, halfWidth: 5.8, amp: 3, period: 6 },
    { kind: "roller", at: 0.88, radius: 2.4, period: 4, amp: 6, look: "boulder" },
  ],
  boostPads: PADS([0.03, 0.56, 0.78, 0.95]),
};

// ------------------------------------------------------------------ 3. Sea
const SL = 1573;
export const DEEP_SEA_DISASTER: TrackDef = {
  ...BASE,
  id: "deep-sea-disaster",
  name: "Deep Sea Disaster",
  theme: "sea",
  difficulty: "Hard",
  music: 2,
  blurb: "Off the beach, down a ramp into the ocean, through currents and propellers, and back out up a waterfall.",
  features: ["Underwater driving", "Currents", "Propellers", "Waterfall launch"],
  controlPoints: mirrorX(PROVING_GROUNDS.controlPoints),
  waterLevel: 0,
  elevation: [[0, 7], [0.06, 7], ...table(SL, 0.1, 7, 4), [0.2, -14], [0.3, -20], [0.42, -22], [0.52, -16], [0.6, -20], [0.68, -12], [0.76, 6], ...table(SL, 0.8, 6, 5), [0.9, 7], [0.97, 7]],
  surfaces: [
    { type: "boost", from: 0.4, to: 0.43 },
    { type: "boost", from: 0.69, to: 0.74 },
    { type: "sand", from: 0.86, to: 0.95, lateral: [1, 7.5] },
    { type: "sand", from: 0.02, to: 0.07, lateral: [-7.5, -1] },
  ],
  winds: [
    { from: 0.3, to: 0.37, push: 5.5 },
    { from: 0.46, to: 0.52, push: -6, period: 5 },
    { from: 0.58, to: 0.64, push: 5, period: 3.5 },
  ],
  hazards: [
    { kind: "spinner", at: 0.255, length: 12, period: 3.6, look: "propeller" },
    { kind: "roller", at: 0.34, radius: 2.5, period: 5.5, amp: 6, look: "jelly" },
    { kind: "runner", from: 0.5, to: 0.42, lateral: -3, radius: 2.8, period: 8, look: "fish" },
    { kind: "spinner", at: 0.56, length: 12, period: 3.2, phase: 0.3, look: "propeller" },
    { kind: "roller", at: 0.63, radius: 2.5, period: 4.5, amp: 6, phase: 0.5, look: "jelly" },
  ],
  boostPads: PADS([0.03, 0.22, 0.66, 0.84]),
};

// ------------------------------------------------------------------ 4. Sky
const KL = 1500;
const skyA = jump(KL, 0.2, 20, 5, 14);
const skyB = jump(KL, 0.5, 34, 5, 24);
const skyC = jump(KL, 0.8, 22, 6, 8, 26);
export const SKY_HIGH_INSANITY: TrackDef = {
  ...BASE,
  id: "sky-high-insanity",
  name: "Sky High Insanity",
  theme: "sky",
  difficulty: "Extreme",
  music: 3,
  blurb: "A road strung between skyscrapers: three building-to-building jumps, crosswinds, turbines and missing barriers.",
  features: ["Three rooftop jumps", "Crosswinds", "Wind turbines", "No barriers"],
  controlPoints: lobes(210, 5, 0.1, 1.2, 0.85),
  elevation: [[0, 10], [0.05, 10], [0.14, 20], ...skyA.keys, [0.34, 16], [0.44, 34], ...skyB.keys, [0.64, 26], [0.74, 22], ...skyC.keys, [0.93, 10], [0.97, 10]],
  gaps: [skyA.gap, skyB.gap, skyC.gap],
  openSides: [
    { from: 0.3, to: 0.38, side: 0 },
    { from: 0.6, to: 0.7, side: -1 },
    { from: 0.88, to: 0.94, side: 1 },
  ],
  surfaces: [skyA.boost, skyB.boost, skyC.boost],
  winds: [
    { from: 0.3, to: 0.38, push: 5, period: 4 },
    { from: 0.6, to: 0.7, push: -4.5, period: 5 },
  ],
  hazards: [
    { kind: "spinner", at: 0.1, length: 13, period: 3.4, look: "turbine" },
    { kind: "spinner", at: 0.41, length: 13, period: 3, phase: 0.4, look: "turbine" },
    { kind: "platform", from: 0.655, to: 0.67, halfWidth: 5.8, amp: 3, period: 5 },
    { kind: "spinner", at: 0.75, length: 13, period: 2.8, look: "turbine" },
    { kind: "gate", at: 0.96, period: 5, open: 0.65, look: "laser" },
  ],
  boostPads: PADS([0.03, 0.36, 0.72, 0.9]),
};

// --------------------------------------------------------------- 5. Frozen
const FL = 2470;
const frozenJump = jump(FL, 0.52, 14, 6, 4);
export const FROZEN_FRENZY: TrackDef = {
  ...BASE,
  id: "frozen-frenzy",
  name: "Frozen Frenzy",
  theme: "frozen",
  difficulty: "Hard",
  music: 4,
  blurb: "A long run down a mountain with a giant snowball behind you, a ski jump, and a frozen lake that cracks.",
  features: ["Avalanche chase", "Ski jumps", "Cracking ice", "Frozen lake"],
  controlPoints: mirrorZ(NEON_NIGHTS.controlPoints),
  elevation: [[0, 0], [0.04, 0], [0.12, 22], [0.2, 48], [0.24, 48], [0.33, 30], ...table(FL, 0.4, 24, 6), [0.47, 14], ...frozenJump.keys, [0.6, 0], [0.74, 0], [0.82, 10], [0.9, 2], [0.96, 0]],
  gaps: [frozenJump.gap],
  surfaces: [
    frozenJump.boost,
    { type: "snow", from: 0.12, to: 0.22 },
    { type: "ice", from: 0.26, to: 0.32 },
    { type: "ice", from: 0.61, to: 0.73 },
    { type: "snow", from: 0.8, to: 0.88, lateral: [-7.5, 0] },
  ],
  hazards: [
    { kind: "runner", from: 0.215, to: 0.46, lateral: 0, radius: 3.4, period: 26, look: "snowball" },
    { kind: "roller", at: 0.3, radius: 2.4, period: 4.4, amp: 6, look: "snowball" },
    { kind: "roller", at: 0.37, radius: 2.4, period: 3.8, amp: 6, phase: 0.5, look: "snowball" },
    { kind: "collapse", from: 0.64, to: 0.652, period: 7, solid: 0.7 },
    { kind: "collapse", from: 0.69, to: 0.702, period: 7, solid: 0.7, phase: 0.5 },
    { kind: "roller", at: 0.86, radius: 2.4, period: 4, amp: 6, look: "snowball" },
  ],
  boostPads: PADS([0.03, 0.23, 0.45, 0.76, 0.94]),
};

// --------------------------------------------------------------- 6. Jungle
const JL = 1600;
export const JUNGLE_TEMPLE_CHAOS: TrackDef = {
  ...BASE,
  id: "jungle-temple-chaos",
  name: "Jungle Temple Chaos",
  theme: "jungle",
  difficulty: "Hard",
  music: 5,
  blurb: "Swamp mud, root ramps, a corridor of swinging pendulums and a boulder that will not stop rolling.",
  features: ["Pendulum corridor", "Rolling boulder", "Swamp mud", "Rope bridge"],
  controlPoints: lobes(200, 4, 0.14, 1.25, 0.9, 0.04, 3),
  elevation: [[0, 2], [0.05, 2], [0.14, 0], [0.26, 0], ...table(JL, 0.31, 2, 5), [0.4, 12], [0.5, 20], [0.58, 20], [0.68, 8], ...table(JL, 0.74, 8, 5.5), [0.84, 3], [0.95, 2]],
  surfaces: [
    { type: "mud", from: 0.14, to: 0.19, lateral: [-7.5, 1] },
    { type: "mud", from: 0.2, to: 0.25, lateral: [-1, 7.5] },
    { type: "dirt", from: 0.33, to: 0.4 },
    { type: "mud", from: 0.86, to: 0.9, lateral: [-7.5, -1] },
  ],
  hazards: [
    { kind: "collapse", from: 0.37, to: 0.383, period: 8, solid: 0.74 },
    { kind: "roller", at: 0.455, radius: 2.2, period: 3.4, amp: 6.5, look: "pendulum" },
    { kind: "roller", at: 0.49, radius: 2.2, period: 3.4, amp: 6.5, phase: 0.33, look: "pendulum" },
    { kind: "roller", at: 0.525, radius: 2.2, period: 3.4, amp: 6.5, phase: 0.66, look: "pendulum" },
    { kind: "runner", from: 0.585, to: 0.7, lateral: 0, radius: 3.4, period: 13, look: "boulder" },
    { kind: "spinner", at: 0.8, length: 12, period: 4, look: "gear" },
    { kind: "gate", at: 0.92, period: 6, open: 0.66, look: "wall" },
    { kind: "spinner", at: 0.09, length: 12, period: 4.6, phase: 0.5, look: "gear" },
  ],
  boostPads: PADS([0.03, 0.28, 0.6, 0.71, 0.96]),
};

// ----------------------------------------------------------------- 7. Neon
const NL = 2470;
const neonJump = jump(NL, 0.47, 14, 6, 6, 26);
export const NEON_CYBER_CITY: TrackDef = {
  ...BASE,
  id: "neon-cyber-city",
  name: "Neon Cyber City",
  theme: "neon",
  difficulty: "Extreme",
  music: 6,
  blurb: "Climb a skyscraper, plunge down its spiral, dodge cross traffic and laser gates, and jump the highway gap.",
  features: ["54 m spiral drop", "Laser gates", "Cross traffic", "Boost lanes"],
  controlPoints: NEON_NIGHTS.controlPoints,
  elevation: [[0, 4], [0.04, 4], [0.14, 30], [0.24, 54], [0.28, 54], [0.37, 16], [0.43, 14], ...neonJump.keys, [0.6, 6], [0.7, 18], [0.78, 18], [0.88, 4], [0.96, 4]],
  gaps: [neonJump.gap],
  openSides: [{ from: 0.245, to: 0.275, side: 0 }],
  surfaces: [
    neonJump.boost,
    { type: "boost", from: 0.6, to: 0.68, lateral: [-7.5, -3.5] },
    { type: "boost", from: 0.84, to: 0.9, lateral: [3.5, 7.5] },
  ],
  hazards: [
    { kind: "gate", at: 0.09, period: 5, open: 0.66, look: "laser" },
    { kind: "roller", at: 0.19, radius: 2.3, period: 3.6, amp: 6.5, look: "car" },
    { kind: "roller", at: 0.56, radius: 2.3, period: 3.2, amp: 6.5, phase: 0.3, look: "car" },
    { kind: "gate", at: 0.63, period: 4.5, open: 0.62, phase: 0.4, look: "laser" },
    { kind: "roller", at: 0.74, radius: 2.3, period: 3, amp: 6.5, phase: 0.6, look: "car" },
    { kind: "spinner", at: 0.81, length: 13, period: 3.4, look: "bar" },
    { kind: "gate", at: 0.92, period: 5.5, open: 0.6, phase: 0.2, look: "laser" },
  ],
  boostPads: PADS([0.03, 0.3, 0.41, 0.72, 0.95]),
};

// ---------------------------------------------------------------- 8. Chaos
const CL = 1750;
const chaosA = jump(CL, 0.19, 24, 6, 10);
const chaosB = jump(CL, 0.69, 30, 6, 18, 26);
export const CHAOS_DIMENSION: TrackDef = {
  ...BASE,
  id: "chaos-dimension",
  name: "Chaos Dimension",
  theme: "chaos",
  difficulty: "Insane",
  music: 7,
  blurb: "Everything at once: ice, mud, a dive under water, a volcano climb, two jumps and every hazard in the game.",
  features: ["Every terrain", "Underwater dive", "Two jumps", "All hazards"],
  controlPoints: lobes(215, 6, 0.075, 1.2, 0.9, 0.05, 2),
  waterLevel: -4,
  elevation: [[0, 4], [0.04, 4], [0.1, 14], [0.15, 24], ...chaosA.keys, [0.3, -6], [0.36, -14], [0.44, -14], [0.5, 2], [0.58, 22], [0.64, 30], ...chaosB.keys, [0.82, 12], [0.9, 18], [0.96, 4]],
  gaps: [chaosA.gap, chaosB.gap],
  openSides: [{ from: 0.59, to: 0.635, side: -1 }],
  surfaces: [
    chaosA.boost,
    chaosB.boost,
    { type: "ice", from: 0.04, to: 0.09 },
    { type: "mud", from: 0.5, to: 0.54, lateral: [-7.5, 0] },
    { type: "oil", from: 0.84, to: 0.86, lateral: [-4, 5] },
    { type: "conveyorBack", from: 0.91, to: 0.94, lateral: [0, 7.5] },
    { type: "snow", from: 0.55, to: 0.59 },
  ],
  winds: [
    { from: 0.34, to: 0.42, push: 5.5, period: 4 },
    { from: 0.59, to: 0.635, push: -4, period: 5 },
  ],
  hazards: [
    { kind: "roller", at: 0.07, radius: 2.3, period: 3.6, amp: 6, look: "snowball" },
    { kind: "spinner", at: 0.13, length: 13, period: 3.2, look: "bar" },
    { kind: "roller", at: 0.39, radius: 2.5, period: 4.5, amp: 6, look: "jelly" },
    { kind: "geyser", at: 0.47, lateral: 0, radius: 3, period: 4, active: 0.3, power: 15 },
    { kind: "collapse", from: 0.545, to: 0.558, period: 7, solid: 0.7 },
    { kind: "runner", from: 0.66, to: 0.56, lateral: 3.5, radius: 2.6, period: 8, look: "boulder" },
    { kind: "platform", from: 0.785, to: 0.8, halfWidth: 5.8, amp: 3, period: 5 },
    { kind: "gate", at: 0.88, period: 5, open: 0.62, look: "laser" },
    { kind: "roller", at: 0.95, radius: 2.3, period: 3.4, amp: 6, phase: 0.5, look: "pendulum" },
  ],
  boostPads: PADS([0.03, 0.28, 0.48, 0.8, 0.97]),
};

export const CHAOS_TRACKS: TrackDef[] = [OFFICE_APOCALYPSE, VOLCANO_MAYHEM, DEEP_SEA_DISASTER, SKY_HIGH_INSANITY, FROZEN_FRENZY, JUNGLE_TEMPLE_CHAOS, NEON_CYBER_CITY, CHAOS_DIMENSION];
