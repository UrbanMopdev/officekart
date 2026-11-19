/**
 * Computer-controlled opponents. A CPU car is driven on the server through exactly the same inputs
 * and physics as a human's: this module only decides what it "presses" each tick. It is always
 * labelled as a CPU in the lobby, on name tags and in the results; it is never passed off as a person.
 */
import { KART, VEHICLES, angleDiff, type KartInput, type KartState, type Track } from "@office-kart/shared";

export interface CpuMind {
  /** Share of the top speed this driver is willing to hold. */
  pace: number;
  /** Where across the road it likes to run: -1 is the left edge, 1 the right. */
  lane: number;
  /** Whether it power-slides through corners for the boost. */
  drifts: boolean;
  /** Drift button held. */
  hold: boolean;
  /** Race tick at which it will use the power-up in its hand (0 = not decided yet). */
  itemAt: number;
  /** How long it sits on a power-up before using it, in ticks: least and extra. */
  patience: [number, number];
  /** Ticks spent going nowhere; long enough and it asks to be put back on the road. */
  stuck: number;
  /** Sideways move off its line, in metres, to go round a car in the way. Eases in and out. */
  shift: number;
}

/** Names say what they are. */
export const CPU_NAMES = ["CPU Ada", "CPU Bolt", "CPU Cruz", "CPU Dash", "CPU Echo", "CPU Flint", "CPU Gale"];

/** Three strengths: 0 gentle, 1 a fair race, 2 hard to beat. Each driver varies a little within its level. */
export function newMind(level: number, seat: number): CpuMind {
  const r = Math.random();
  const [lo, hi, drift, wait] = level <= 0 ? [0.8, 0.87, 0, 150] : level === 1 ? [0.89, 0.95, 0.5, 90] : [0.96, 1, 1, 40];
  const lanes = [-0.7, 0.7, -0.25, 0.25, 0, -0.5, 0.5];
  return { pace: lo + r * (hi - lo), lane: lanes[seat % lanes.length], drifts: Math.random() < drift, hold: false, itemAt: 0, patience: [wait * 0.3, wait], stuck: 0, shift: 0 };
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * Decide this tick's inputs. `bias` nudges the pace up when the car has dropped well behind the
 * people in the race and down when it is running away from them, so a race stays a race.
 *
 * `dodge` is which way to pull out to pass a car in the way: metres to the right, 0 for a clear road.
 */
export function cpuDrive(m: CpuMind, s: KartState, track: Track, speedK: number, inp: KartInput, tick: number, item: number, bias: number, dodge: number): void {
  const n = track.n;
  const i = (s.idx + Math.round(5 + Math.abs(s.speed) * 0.22)) % n;
  // Aim at a point ahead on its own line across the road, moved over when there is someone to go round.
  m.shift += (dodge - m.shift) * 0.07;
  const half = track.def.roadHalfWidth;
  const off = clamp(m.lane * half * 0.5 + m.shift, -half * 0.82, half * 0.82);
  const ax = track.px[i] + track.nx[i] * off;
  const az = track.pz[i] + track.nz[i] * off;
  let steer = clamp(-angleDiff(Math.atan2(ax - s.x, az - s.z), s.heading) * 3, -1, 1);

  // Curvature of the road just ahead (1/m): positive is a right-hander.
  const a = (s.idx + 2) % n;
  const b = (s.idx + 9) % n;
  const kappa = -angleDiff(Math.atan2(track.tx[b], track.tz[b]), Math.atan2(track.tx[a], track.tz[a])) / (7 * track.spacing);
  if (m.drifts) {
    if (!m.hold && Math.abs(kappa) > 1 / 75 && s.speed > 15 && !s.air) {
      m.hold = true;
      steer = Math.sign(kappa);
    } else if (m.hold && s.driftDir !== 0) {
      // Hold the arc the road needs, with a nudge back towards the line; steer by where the car is going.
      const err = -angleDiff(Math.atan2(ax - s.x, az - s.z), s.vAngle);
      const c = (s.driftDir * (kappa * s.speed + err * 1.6)) / Math.max(11, s.speed);
      const [wide, mid, tight] = KART.driftRadius;
      const into = c >= 1 / mid ? (c - 1 / mid) / (1 / tight - 1 / mid) : (c - 1 / mid) / (1 / mid - 1 / wide);
      steer = s.driftDir * clamp(into, -1, 1);
      if (Math.abs(kappa) < 1 / 160 && s.driftCharge > KART.driftLevels[0]) m.hold = false;
    } else if (m.hold && s.driftDir === 0 && s.speed < 12) m.hold = false;
    else if (m.hold && s.driftDir === 0 && Math.abs(kappa) < 1 / 160) m.hold = false;
  }

  const top = KART.maxSpeed * speedK * (VEHICLES[s.veh]?.speed ?? 1);
  inp.throttle = s.speed > top * clamp(m.pace + bias, 0.7, 1.02) ? 0 : 1;
  inp.steer = steer;
  inp.drift = m.hold;

  // Power-ups: hold one for a moment, then use it.
  inp.use = false;
  if (item === 0) m.itemAt = 0;
  else if (m.itemAt === 0) m.itemAt = tick + Math.round(m.patience[0] + Math.random() * m.patience[1]);
  else if (tick >= m.itemAt) {
    inp.use = true;
    m.itemAt = 0;
  }

  // Wedged against something: ask to be set back on the road, as a person would.
  inp.reset = false;
  if (tick > 120 && Math.abs(s.speed) < 1.5 && s.spin <= 0) {
    if (++m.stuck > 80) {
      inp.reset = true;
      m.stuck = 0;
    }
  } else m.stuck = 0;
}
