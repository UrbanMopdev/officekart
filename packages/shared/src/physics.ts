/**
 * Deterministic arcade kart simulation.
 *
 * The exact same step function runs on the server (authoritative) and on each
 * client (prediction of the local kart only). One call = one fixed tick. The
 * server never accepts positions from clients; it only accepts inputs and
 * feeds them through this function, so speed hacks and teleporting are not
 * expressible in the protocol.
 */
import { DT, KART, KART_RADIUS } from "./constants";
import { locate, onBoostPad, type Located, type Track } from "./track";

export interface KartInput {
  /** 1 accelerate, -1 brake/reverse, 0 coast. */
  throttle: number;
  /** -1 full left .. 1 full right. */
  steer: number;
  drift: boolean;
  reset: boolean;
}

export interface KartState {
  x: number;
  z: number;
  /** Direction the kart is pointing. Forward = (sin h, cos h). */
  heading: number;
  /** Direction the kart is actually travelling; lags heading while sliding. */
  vAngle: number;
  /** Signed speed along vAngle; negative means reversing. */
  speed: number;
  /** -1 drifting left, 1 drifting right, 0 not drifting. */
  driftDir: number;
  /** Seconds of accumulated drift charge. */
  driftCharge: number;
  /** Seconds of boost remaining. */
  boost: number;
  /** Nearest centreline sample (search hint). */
  idx: number;
  /** Fractional lap position in samples, 0..n. */
  pos: number;
  offroad: boolean;
}

export const INPUT_BITS = { ACCEL: 1, BRAKE: 2, DRIFT: 4, RESET: 8 } as const;

export const NEUTRAL_INPUT: KartInput = { throttle: 0, steer: 0, drift: false, reset: false };

export function decodeInput(bits: number, steer: number, out: KartInput): KartInput {
  const accel = (bits & INPUT_BITS.ACCEL) !== 0;
  const brake = (bits & INPUT_BITS.BRAKE) !== 0;
  out.throttle = accel && !brake ? 1 : brake && !accel ? -1 : 0;
  out.steer = steer < -1 ? -1 : steer > 1 ? 1 : steer;
  out.drift = (bits & INPUT_BITS.DRIFT) !== 0;
  out.reset = (bits & INPUT_BITS.RESET) !== 0;
  return out;
}

export function createKartState(): KartState {
  return { x: 0, z: 0, heading: 0, vAngle: 0, speed: 0, driftDir: 0, driftCharge: 0, boost: 0, idx: 0, pos: 0, offroad: false };
}

export function copyKartState(from: KartState, to: KartState): KartState {
  to.x = from.x;
  to.z = from.z;
  to.heading = from.heading;
  to.vAngle = from.vAngle;
  to.speed = from.speed;
  to.driftDir = from.driftDir;
  to.driftCharge = from.driftCharge;
  to.boost = from.boost;
  to.idx = from.idx;
  to.pos = from.pos;
  to.offroad = from.offroad;
  return to;
}

/** Wire format for the owner's authoritative state (used for reconciliation). */
export function packKartState(s: KartState): number[] {
  return [s.x, s.z, s.heading, s.vAngle, s.speed, s.driftDir, s.driftCharge, s.boost, s.idx, s.pos, s.offroad ? 1 : 0];
}

export function unpackKartState(a: number[], offset: number, s: KartState): KartState {
  s.x = a[offset];
  s.z = a[offset + 1];
  s.heading = a[offset + 2];
  s.vAngle = a[offset + 3];
  s.speed = a[offset + 4];
  s.driftDir = a[offset + 5];
  s.driftCharge = a[offset + 6];
  s.boost = a[offset + 7];
  s.idx = a[offset + 8];
  s.pos = a[offset + 9];
  s.offroad = a[offset + 10] === 1;
  return s;
}

/** 0 = no mini-turbo yet, 1..3 = charge level reached. */
export function driftLevel(charge: number): number {
  const l = KART.driftLevels;
  return charge >= l[2] ? 3 : charge >= l[1] ? 2 : charge >= l[0] ? 1 : 0;
}

export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function placeOnGrid(s: KartState, track: Track, slot: number): KartState {
  const g = track.grid[slot % track.grid.length];
  s.x = g.x;
  s.z = g.z;
  s.heading = g.heading;
  s.vAngle = g.heading;
  s.speed = 0;
  s.driftDir = 0;
  s.driftCharge = 0;
  s.boost = 0;
  s.idx = g.idx;
  s.offroad = false;
  const loc = locate(track, s.x, s.z, s.idx, scratch);
  s.idx = loc.idx;
  s.pos = loc.idx + loc.along / track.spacing;
  return s;
}

const scratch: Located = { idx: 0, along: 0, lateral: 0 };

/** Advance one kart by one fixed tick. Mutates `s`. */
export function stepKart(s: KartState, input: KartInput, track: Track): void {
  const dt = DT;

  // --- Reset to the centreline (R key). Costs all speed, so it is never a gain.
  if (input.reset) {
    const i = s.idx;
    s.x = track.px[i];
    s.z = track.pz[i];
    s.heading = Math.atan2(track.tx[i], track.tz[i]);
    s.vAngle = s.heading;
    s.speed = 0;
    s.driftDir = 0;
    s.driftCharge = 0;
    s.boost = 0;
    s.offroad = false;
    s.pos = i;
    return;
  }

  const boosting = s.boost > 0;
  let maxSpeed: number = KART.maxSpeed;
  if (boosting) maxSpeed += KART.boostExtraSpeed;
  if (s.offroad) maxSpeed *= boosting ? KART.offroadBoostSpeedMul : KART.offroadSpeedMul;

  // --- Throttle, brake, reverse, drag.
  if (input.throttle > 0) {
    // Acceleration never pushes past top speed; it only gets you there.
    if (s.speed < maxSpeed) {
      const fade = 1 - 0.55 * Math.min(1, Math.max(0, s.speed) / maxSpeed);
      s.speed = Math.min(maxSpeed, s.speed + KART.accel * fade * (boosting ? KART.boostAccelMul : 1) * dt);
    }
  } else if (input.throttle < 0) {
    if (s.speed > 0.5) s.speed -= KART.brake * dt;
    else s.speed -= KART.reverseAccel * dt;
  } else {
    const d = KART.drag * dt;
    if (s.speed > d) s.speed -= d;
    else if (s.speed < -d) s.speed += d;
    else s.speed = 0;
  }
  if (boosting && s.speed < maxSpeed) s.speed = Math.min(maxSpeed, s.speed + KART.accel * dt); // boosts push even without throttle
  // Over the limit (boost just ended, or drove off the road): bleed speed off gradually.
  if (s.speed > maxSpeed) s.speed = Math.max(maxSpeed, s.speed - KART.overspeedDecel * dt);
  if (s.speed < -KART.maxReverse) s.speed = -KART.maxReverse;
  if (boosting) s.boost = Math.max(0, s.boost - dt);

  // --- Drift state. Hold drift while steering to start; release to cash in.
  const steer = input.steer;
  if (s.driftDir !== 0) {
    if (!input.drift || s.speed < KART.driftMinSpeed * 0.7) {
      const level = input.drift ? 0 : driftLevel(s.driftCharge);
      if (level > 0) s.boost = Math.max(s.boost, KART.driftBoost[level - 1]);
      s.driftDir = 0;
      s.driftCharge = 0;
    }
  } else if (input.drift && Math.abs(steer) > 0.3 && s.speed >= KART.driftMinSpeed) {
    s.driftDir = steer > 0 ? 1 : -1;
    s.driftCharge = 0;
  }

  // --- Steering. Heading decreases when turning right (see forward vector).
  const absSpeed = Math.abs(s.speed);
  const lowSpeed = Math.min(1, absSpeed / 7);
  let turn: number;
  let grip: number;
  if (s.driftDir !== 0) {
    const into = steer * s.driftDir; // 1 = steering into the drift, -1 = counter-steering
    turn = s.driftDir * KART.driftTurn * (0.62 + 0.5 * into);
    s.driftCharge += dt * (0.75 + 0.45 * Math.max(0, into));
    grip = KART.driftGrip;
  } else {
    const damp = 1 - KART.turnSpeedDamp * Math.min(1, absSpeed / KART.maxSpeed);
    turn = steer * KART.turnRate * damp;
    grip = KART.grip;
  }
  s.heading -= turn * lowSpeed * dt * (s.speed < 0 ? -1 : 1);
  s.vAngle += angleDiff(s.heading, s.vAngle) * Math.min(1, grip * dt);

  // --- Integrate.
  s.x += Math.sin(s.vAngle) * s.speed * dt;
  s.z += Math.cos(s.vAngle) * s.speed * dt;

  // --- Track boundaries.
  const loc = locate(track, s.x, s.z, s.idx, scratch);
  const i = loc.idx;
  const limit = track.def.wallHalfWidth - KART_RADIUS;
  let lateral = loc.lateral;
  const over = Math.abs(lateral) - limit;
  if (over > 0) {
    const side = lateral > 0 ? 1 : -1;
    const wnx = track.nx[i] * side;
    const wnz = track.nz[i] * side;
    s.x -= wnx * over;
    s.z -= wnz * over;
    lateral = side * limit;
    // Remove the velocity component going into the wall and scrub some speed.
    const vx = Math.sin(s.vAngle) * s.speed;
    const vz = Math.cos(s.vAngle) * s.speed;
    const into = vx * wnx + vz * wnz;
    if (into > 0) {
      const sx = vx - wnx * into;
      const sz = vz - wnz * into;
      const sl = Math.hypot(sx, sz);
      const kept = sl * 0.93;
      if (s.speed >= 0) {
        if (sl > 0.01) s.vAngle = Math.atan2(sx, sz);
        s.speed = kept;
      } else {
        if (sl > 0.01) s.vAngle = Math.atan2(-sx, -sz);
        s.speed = -kept;
      }
      s.heading += angleDiff(s.vAngle, s.heading) * 0.25;
      if (s.driftDir !== 0 && into > 6) {
        s.driftDir = 0;
        s.driftCharge = 0;
      }
    }
  }

  s.idx = i;
  s.pos = i + loc.along / track.spacing;
  s.offroad = Math.abs(lateral) > track.def.roadHalfWidth;

  if (onBoostPad(track, i, lateral)) s.boost = Math.max(s.boost, KART.boostPadSeconds);
}

/**
 * Kart-to-kart collision between two karts (server-side). Pushes them apart
 * and trades part of their closing velocity. Returns true if they touched.
 */
export function collideKarts(a: KartState, b: KartState): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const min = KART_RADIUS * 2;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min) return false;
  const d = Math.sqrt(d2);
  const nx = d > 1e-4 ? dx / d : 1;
  const nz = d > 1e-4 ? dz / d : 0;
  const push = (min - d) / 2;
  a.x -= nx * push;
  a.z -= nz * push;
  b.x += nx * push;
  b.z += nz * push;

  const avx = Math.sin(a.vAngle) * a.speed;
  const avz = Math.cos(a.vAngle) * a.speed;
  const bvx = Math.sin(b.vAngle) * b.speed;
  const bvz = Math.cos(b.vAngle) * b.speed;
  const closing = (avx - bvx) * nx + (avz - bvz) * nz;
  if (closing > 0) {
    const j = closing * 0.75; // equal masses, partly elastic
    applyVelocity(a, avx - nx * j, avz - nz * j);
    applyVelocity(b, bvx + nx * j, bvz + nz * j);
  }
  return true;
}

function applyVelocity(s: KartState, vx: number, vz: number): void {
  // A shunt can never push a kart past its boosted top speed.
  const sp = Math.min(Math.hypot(vx, vz), KART.maxSpeed + KART.boostExtraSpeed);
  if (sp < 0.05) {
    s.speed = 0;
    return;
  }
  const forward = vx * Math.sin(s.heading) + vz * Math.cos(s.heading) >= 0;
  if (forward) {
    s.vAngle = Math.atan2(vx, vz);
    s.speed = sp;
  } else {
    s.vAngle = Math.atan2(-vx, -vz);
    s.speed = -sp;
  }
}
