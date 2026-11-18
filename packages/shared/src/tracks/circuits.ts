/**
 * The four Office Kart circuits. Each layout is drawn corner by corner (see
 * layout.ts), so every bend has a chosen radius: hairpins at about 20 m,
 * chicanes, esses and long sweepers, with no straight longer than it needs to
 * be. Height, surfaces, jumps and hazards are data on top of the layout.
 */
import type { ElevationKey, GapDef, SurfaceDef, TrackDef } from "../track";
import { rounded } from "./layout";

/** A ramp, a gap and a landing. `L` is the lap length in metres. */
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

// ------------------------------------------------------------------ 1. Office
// Bus-stop chicane, a double hairpin round the meeting rooms, a table-top over
// the atrium, then two snaking runs between the desks.
const OL = 1749;
export const OFFICE_GRAND_PRIX: TrackDef = {
  ...BASE,
  id: "office-grand-prix",
  name: "Office Grand Prix",
  theme: "forest",
  difficulty: "Medium",
  music: 0,
  blurb: "The company's home circuit, cut through pine forest: a bus-stop chicane, a double hairpin over the hill, and a slalom back to the line.",
  features: ["Bus-stop chicane", "Double hairpin", "Forest slalom", "Rock falls"],
  controlPoints: rounded(
    [[-230, -170, 35], [-60, -170, 22], [-30, -135, 22], [40, -135, 22], [70, -170, 22], [230, -170, 35], [230, -60, 30], [120, -60, 20], [120, 20, 20], [230, 20, 24], [230, 170, 35], [60, 170, 30], [60, 90, 20], [-40, 90, 20], [-70, 10, 45], [-40, -70, 26], [-130, -70, 20], [-158, 10, 50], [-122, 90, 50], [-130, 170, 30], [-230, 170, 35], [-203, 0, 60]],
    { scale: 0.82, startAt: 0.6 },
  ),
  elevation: [[0, 0], [0.15, 0], [0.22, 8], [0.32, 8], [0.4, 3], ...table(OL, 0.456, 3, 5), [0.53, 0], [0.7, 0], [0.76, 6], [0.83, 6], [0.9, 0]],
  surfaces: [
    { type: "oil", from: 0.268, to: 0.288, lateral: [-5, 3] },
    { type: "conveyor", from: 0.585, to: 0.63, lateral: [-7.5, -0.4] },
    { type: "conveyorBack", from: 0.585, to: 0.63, lateral: [0.4, 7.5] },
    { type: "conveyor", from: 0.7, to: 0.74 },
  ],
  hazards: [
    { kind: "roller", at: 0.125, radius: 2.3, period: 4.6, amp: 6, look: "boulder" },
    { kind: "roller", at: 0.37, radius: 2.3, period: 3.8, amp: 6, phase: 0.4, look: "boulder" },
    { kind: "runner", from: 0.49, to: 0.425, lateral: 3.5, radius: 2.4, period: 7, look: "boulder" },
    { kind: "roller", at: 0.87, radius: 2.3, period: 4.2, amp: 6, phase: 0.7, look: "boulder" },
  ],
  itemRows: [0.105, 0.2, 0.35, 0.475, 0.6, 0.86],
  boostPads: PADS([0.11, 0.345, 0.43, 0.675, 0.92]),
};

// ----------------------------------------------------------------- 2. Volcano
// Three stacked hairpins up the mountain, a jump over lava on the open crater
// rim, and a fast set of esses back down.
const VL = 1887;
const lavaJump = jump(VL, 0.685, 58, 5, 54);
export const VOLCANO_PASS: TrackDef = {
  ...BASE,
  id: "volcano-pass",
  name: "Volcano Pass",
  theme: "volcano",
  difficulty: "Hard",
  music: 1,
  blurb: "A mountain pass up an erupting volcano: three hairpins on the climb, a lava jump on the crater rim with no barrier, and esses all the way down.",
  features: ["Three hairpins", "58 m climb", "Lava jump", "Falling boulders"],
  controlPoints: rounded(
    [[-250, -150, 35], [-90, -150, 60], [-20, -185, 35], [60, -160, 35], [120, -90, 24], [240, -90, 22], [240, -30, 22], [140, -14, 60], [40, -30, 20], [40, 30, 20], [140, 44, 60], [240, 30, 22], [240, 95, 22], [100, 95, 26], [100, 170, 30], [-20, 197, 90], [-140, 170, 45], [-250, 110, 35], [-190, 30, 28], [-250, -50, 28]],
    { startAt: 0.55 },
  ),
  elevation: [[0, 0], [0.07, 0], [0.2, 13], [0.35, 29], [0.48, 45], [0.6, 58], ...lavaJump.keys, [0.78, 54], [0.85, 36], [0.91, 18], [0.965, 0]],
  gaps: [lavaJump.gap],
  openSides: [{ from: 0.725, to: 0.77, side: 1 }],
  surfaces: [lavaJump.boost, { type: "dirt", from: 0.335, to: 0.385 }, { type: "dirt", from: 0.86, to: 0.9, lateral: [-7.5, 0] }],
  hazards: [
    { kind: "runner", from: 0.33, to: 0.27, lateral: -3.5, radius: 2.6, period: 8, look: "boulder" },
    { kind: "runner", from: 0.46, to: 0.385, lateral: 3.5, radius: 2.6, period: 8, phase: 0.5, look: "boulder" },
    { kind: "collapse", from: 0.535, to: 0.548, period: 8, solid: 0.72 },
    { kind: "geyser", at: 0.74, lateral: -3.5, radius: 3, period: 4.5, active: 0.3, power: 16 },
    { kind: "geyser", at: 0.76, lateral: 2.5, radius: 3, period: 4.5, active: 0.3, power: 16, phase: 0.5 },
    { kind: "roller", at: 0.935, radius: 2.4, period: 4, amp: 6, look: "boulder" },
  ],
  itemRows: [0.05, 0.17, 0.3, 0.44, 0.58, 0.8],
  boostPads: PADS([0.02, 0.15, 0.42, 0.81]),
};

// -------------------------------------------------------------------- 3. Neon
// A street circuit: a long straight with a ramp jump into a hairpin, flyovers,
// two chicanes and laser gates.
const NL = 1829;
const neonJump = jump(NL, 0.085, 0, 5, 0);
export const NEON_CIRCUIT: TrackDef = {
  ...BASE,
  id: "neon-circuit",
  name: "Midnight Circuit",
  theme: "night",
  difficulty: "Hard",
  music: 6,
  blurb: "A night race under the moon: flat out down the main straight, over the ramp, hard on the brakes for the hairpin, then flyovers, chicanes and laser gates.",
  features: ["Ramp jump", "Braking hairpin", "Two chicanes", "Laser gates"],
  controlPoints: rounded(
    [[-250, -160, 28], [250, -160, 20], [250, -110, 20], [155, -94, 50], [60, -110, 22], [60, -30, 22], [150, -46, 50], [250, -30, 25], [250, 60, 25], [130, 60, 18], [100, 100, 18], [40, 100, 18], [10, 60, 18], [-80, 60, 20], [-80, -40, 20], [-170, -40, 20], [-148, 40, 45], [-187, 110, 32], [-170, 170, 24], [-250, 170, 30], [-250, 60, 20], [-215, 20, 20], [-215, -40, 20], [-250, -80, 20]],
    { scale: 0.85 },
  ),
  elevation: [[0, 0], [0.03, 0], ...neonJump.keys, [0.13, 0], [0.2, 8], [0.3, 16], [0.4, 16], [0.48, 6], [0.6, 6], [0.66, 0], [0.71, 0], [0.78, 10], [0.84, 10], [0.9, 0]],
  gaps: [neonJump.gap],
  surfaces: [neonJump.boost, { type: "oil", from: 0.345, to: 0.36, lateral: [-2, 6] }, { type: "boost", from: 0.6, to: 0.64, lateral: [-7.5, -3.5] }, { type: "oil", from: 0.745, to: 0.76, lateral: [-6, 1] }],
  hazards: [
    { kind: "roller", at: 0.225, radius: 2.3, period: 3.6, amp: 6.5, look: "boulder" },
    { kind: "gate", at: 0.32, period: 5, open: 0.66, look: "laser" },
    { kind: "roller", at: 0.44, radius: 2.3, period: 3.2, amp: 6.5, phase: 0.3, look: "boulder" },
    { kind: "gate", at: 0.565, period: 4.5, open: 0.62, phase: 0.4, look: "laser" },
    { kind: "roller", at: 0.865, radius: 2.3, period: 3, amp: 6.5, phase: 0.6, look: "boulder" },
  ],
  itemRows: [0.045, 0.21, 0.33, 0.46, 0.62, 0.88],
  boostPads: PADS([0.215, 0.335, 0.455, 0.68, 0.955]),
};

// ------------------------------------------------------------------ 4. Frozen
// Flowing and fast, on a surface that does not want to turn: an icy S, a snowy
// hairpin and esses across the frozen lake.
const FL = 1709;
export const FROZEN_LAKE: TrackDef = {
  ...BASE,
  id: "frozen-lake",
  name: "Frozen Lake",
  theme: "frozen",
  difficulty: "Hard",
  music: 4,
  blurb: "Fast, flowing and slippery: a long icy S, a snowed-in hairpin, and esses across a frozen lake that cracks under you.",
  features: ["Ice sweepers", "Snow hairpin", "Cracking ice", "Giant snowballs"],
  controlPoints: rounded([[-240, -140, 40], [60, -150, 70], [160, -95, 70], [250, -75, 45], [224, 5, 50], [250, 70, 40], [150, 160, 35], [20, 160, 22], [20, 95, 22], [130, 95, 22], [130, 0, 28], [50, -26, 40], [-30, 0, 30], [-90, 90, 30], [-170, 90, 25], [-240, 20, 35], [-208, -40, 30]]),
  elevation: [[0, 0], [0.1, 0], [0.25, 12], [0.33, 22], ...table(FL, 0.365, 22, 5), [0.42, 26], [0.5, 26], [0.6, 14], [0.7, 14], ...table(FL, 0.74, 14, 4.5), [0.8, 8], [0.86, 4], [0.9, 0]],
  surfaces: [
    { type: "ice", from: 0.075, to: 0.19 },
    { type: "snow", from: 0.435, to: 0.505 },
    { type: "ice", from: 0.625, to: 0.715 },
    { type: "snow", from: 0.86, to: 0.92, lateral: [-7.5, 0] },
  ],
  hazards: [
    { kind: "roller", at: 0.215, radius: 2.4, period: 4.4, amp: 6, look: "snowball" },
    { kind: "runner", from: 0.4, to: 0.3, lateral: 0, radius: 3.2, period: 12, look: "snowball" },
    { kind: "roller", at: 0.575, radius: 2.4, period: 3.8, amp: 6, phase: 0.5, look: "snowball" },
    { kind: "collapse", from: 0.645, to: 0.657, period: 7, solid: 0.7 },
    { kind: "collapse", from: 0.69, to: 0.702, period: 7, solid: 0.7, phase: 0.5 },
    { kind: "roller", at: 0.82, radius: 2.4, period: 4, amp: 6, look: "snowball" },
  ],
  itemRows: [0.04, 0.21, 0.34, 0.53, 0.74, 0.88],
  boostPads: PADS([0.03, 0.23, 0.55, 0.8, 0.95]),
};

export const CIRCUITS: TrackDef[] = [OFFICE_GRAND_PRIX, VOLCANO_PASS, NEON_CIRCUIT, FROZEN_LAKE];
