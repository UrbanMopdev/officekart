/**
 * Deterministic arcade kart simulation.
 *
 * The exact same step function runs on the server (authoritative) and on each
 * client (prediction of the local kart only). One call = one fixed tick. The
 * server never accepts positions from clients; it only accepts inputs and
 * feeds them through this function, so speed hacks and teleporting are not
 * expressible in the protocol.
 *
 * Everything that changes how a kart drives is in here: slopes, jumps,
 * surfaces, water, moving hazards and chaos events. Hazards and events are
 * functions of the kart's own tick counter, which travels with its state, so
 * the client's prediction and the server always agree.
 */
import { DT, EVENT, GRAVITY, KART, KART_RADIUS, SLOPE_PULL, SURFACE_PHYSICS, TRICK, VEHICLES } from "./constants";
import { groundHeight, hazardPose, locate, onBoostPad, surfaceAt, type HazardPose, type Located, type Track } from "./track";

export interface KartInput {
  /** 1 accelerate, -1 brake/reverse, 0 coast. */
  throttle: number;
  /** -1 full left .. 1 full right. */
  steer: number;
  drift: boolean;
  reset: boolean;
  /** Use the held power-up (handled by the server). */
  use: boolean;
}

/** Race-wide conditions set by the server: the current chaos event and how far hazards have been sped up. */
export interface RaceCtx {
  event: number;
  /** Kart ticks between which the event is active. */
  from: number;
  to: number;
  /** Extra seconds of hazard time accumulated by past Obstacle Frenzy events. */
  hzOff: number;
  /** Speed class multiplier (see SPEED_CLASSES). */
  speed: number;
}

export const NO_CTX: RaceCtx = { event: 0, from: 0, to: 0, hzOff: 0, speed: 1 };

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
  /** Height, vertical speed, and whether the wheels are off the ground. */
  y: number;
  vy: number;
  air: boolean;
  /** Surface index under the kart (see SURFACE_TYPES). */
  surf: number;
  /** Last sample where it was safe to be put back after a fall. */
  safe: number;
  /** Simulation ticks since the race started: the clock hazards and events run on. */
  tick: number;
  /** Status timers, in seconds. */
  spin: number;
  immune: number;
  shield: number;
  phantom: number;
  slow: number;
  reverse: number;
  emp: number;
  /** Size change: sizeK is -1 mini, 1 giant, for sizeT more seconds. */
  sizeT: number;
  sizeK: number;
  /** Ticks since the wheels left the ground. */
  airT: number;
  /** 1 once a trick has been pulled on the current jump; pays out as a boost on landing. */
  trick: number;
  /** Index into VEHICLES. Set on the grid and never changed during a race. */
  veh: number;
  water: boolean;
  /** The drift button was down on the previous tick (tricks need a fresh press). */
  dk: boolean;
}

export const INPUT_BITS = { ACCEL: 1, BRAKE: 2, DRIFT: 4, RESET: 8, USE: 16 } as const;

export const NEUTRAL_INPUT: KartInput = { throttle: 0, steer: 0, drift: false, reset: false, use: false };

/** Every input bit that exists; anything outside it is not a valid input. */
export const INPUT_MASK = INPUT_BITS.ACCEL | INPUT_BITS.BRAKE | INPUT_BITS.DRIFT | INPUT_BITS.RESET | INPUT_BITS.USE;

export function decodeInput(bits: number, steer: number, out: KartInput): KartInput {
  const accel = (bits & INPUT_BITS.ACCEL) !== 0;
  const brake = (bits & INPUT_BITS.BRAKE) !== 0;
  out.throttle = accel && !brake ? 1 : brake && !accel ? -1 : 0;
  out.steer = steer < -1 ? -1 : steer > 1 ? 1 : steer;
  out.drift = (bits & INPUT_BITS.DRIFT) !== 0;
  out.reset = (bits & INPUT_BITS.RESET) !== 0;
  out.use = (bits & INPUT_BITS.USE) !== 0;
  return out;
}

const NUMERIC: (keyof KartState)[] = ["x", "z", "heading", "vAngle", "speed", "driftDir", "driftCharge", "boost", "idx", "pos", "y", "vy", "surf", "safe", "tick", "spin", "immune", "shield", "phantom", "slow", "reverse", "emp", "sizeT", "sizeK", "airT", "trick", "veh"];
const FLAGS: (keyof KartState)[] = ["offroad", "air", "water", "dk"];
/** Numbers in the wire format of one kart state. */
export const STATE_SIZE = NUMERIC.length + FLAGS.length;

export function createKartState(): KartState {
  const s = {} as Record<string, number | boolean>;
  for (const k of NUMERIC) s[k] = 0;
  for (const k of FLAGS) s[k] = false;
  return s as unknown as KartState;
}

export function copyKartState(from: KartState, to: KartState): KartState {
  const a = from as unknown as Record<string, number | boolean>;
  const b = to as unknown as Record<string, number | boolean>;
  for (const k of NUMERIC) b[k] = a[k];
  for (const k of FLAGS) b[k] = a[k];
  return to;
}

/** Wire format for the owner's authoritative state (used for reconciliation). */
export function packKartState(s: KartState): number[] {
  const a = s as unknown as Record<string, number | boolean>;
  const out: number[] = [];
  for (const k of NUMERIC) out.push(a[k] as number);
  for (const k of FLAGS) out.push(a[k] ? 1 : 0);
  return out;
}

export function unpackKartState(arr: number[], offset: number, s: KartState): KartState {
  const b = s as unknown as Record<string, number | boolean>;
  let i = offset;
  for (const k of NUMERIC) b[k] = arr[i++];
  for (const k of FLAGS) b[k] = arr[i++] === 1;
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

/** The clock hazards run on, in seconds. Obstacle Frenzy makes it run faster. */
export function hazardTime(tick: number, ctx: RaceCtx): number {
  let t = tick * DT + ctx.hzOff;
  if (ctx.event === EVENT.FRENZY && tick > ctx.from) t += (Math.min(tick, ctx.to) - ctx.from) * DT * 0.7;
  return t;
}

/** Kart collision radius, allowing for Giant and Mini modes. */
export function kartRadius(s: KartState): number {
  return s.sizeT > 0 ? (s.sizeK > 0 ? KART_RADIUS * 1.9 : KART_RADIUS * 0.6) : KART_RADIUS;
}

/**
 * Something hit this kart. Returns true if it spun out; false if a bubble,
 * Phantom Mode, Giant Mode or recent-hit protection absorbed it.
 */
export function hitKart(s: KartState): boolean {
  if (s.immune > 0 || s.phantom > 0 || (s.sizeT > 0 && s.sizeK > 0)) return false;
  if (s.shield > 0) {
    s.shield = 0;
    s.immune = 1;
    return false;
  }
  s.spin = 0.9;
  // A grace period after every hit, so nobody is hit over and over.
  s.immune = 2.4;
  s.speed *= 0.3;
  s.driftDir = 0;
  s.driftCharge = 0;
  s.boost = 0;
  return true;
}

const scratch: Located = { idx: 0, along: 0, lateral: 0 };
const pose: HazardPose = { x: 0, y: 0, z: 0, lat: 0, ang: 0, on: true, warn: false };

export function placeOnGrid(s: KartState, track: Track, slot: number): KartState {
  copyKartState(createKartState(), s);
  const g = track.grid[slot % track.grid.length];
  s.x = g.x;
  s.z = g.z;
  s.heading = g.heading;
  s.vAngle = g.heading;
  const loc = locate(track, s.x, s.z, g.idx, scratch);
  s.idx = loc.idx;
  s.pos = loc.idx + loc.along / track.spacing;
  s.y = groundHeight(track, loc.idx, loc.along, loc.lateral);
  s.safe = loc.idx;
  return s;
}

/** Put a kart back on the centreline at sample `i`, stationary. Used by reset and after a fall. */
export function respawnKart(s: KartState, track: Track, i: number): void {
  s.x = track.px[i];
  s.z = track.pz[i];
  s.heading = Math.atan2(track.tx[i], track.tz[i]);
  s.vAngle = s.heading;
  s.speed = 0;
  s.driftDir = 0;
  s.driftCharge = 0;
  s.boost = 0;
  s.offroad = false;
  s.idx = i;
  s.pos = i;
  s.y = track.hy[i];
  s.vy = 0;
  s.air = false;
  s.airT = 0;
  s.trick = 0;
  s.surf = 0;
  s.safe = i;
  s.spin = 0;
  s.immune = 1.5;
  s.water = s.y < track.waterLevel - 0.8;
}

function inRange(i: number, i0: number, i1: number): boolean {
  return i0 <= i1 ? i >= i0 && i <= i1 : i >= i0 || i <= i1;
}

/** Advance one kart by one fixed tick. Mutates `s`. */
export function stepKart(s: KartState, input: KartInput, track: Track, ctx: RaceCtx = NO_CTX): void {
  const dt = DT;
  s.tick++;
  const time = hazardTime(s.tick, ctx);
  if (s.spin > 0) s.spin = Math.max(0, s.spin - dt);
  if (s.immune > 0) s.immune = Math.max(0, s.immune - dt);
  if (s.shield > 0) s.shield = Math.max(0, s.shield - dt);
  if (s.phantom > 0) s.phantom = Math.max(0, s.phantom - dt);
  if (s.slow > 0) s.slow = Math.max(0, s.slow - dt);
  if (s.reverse > 0) s.reverse = Math.max(0, s.reverse - dt);
  if (s.emp > 0) s.emp = Math.max(0, s.emp - dt);
  if (s.sizeT > 0) s.sizeT = Math.max(0, s.sizeT - dt);

  // --- Reset to the centreline (R key). Costs all speed, so it is never a gain.
  if (input.reset) {
    respawnKart(s, track, track.unsafe[s.idx] ? track.respawnAt[s.idx] : s.idx);
    return;
  }

  const ev = ctx.event !== 0 && s.tick >= ctx.from && s.tick < ctx.to ? ctx.event : 0;
  const spinning = s.spin > 0;
  const throttle = spinning ? 0 : input.throttle;
  const steer = spinning ? 0 : s.reverse > 0 ? -input.steer : input.steer;
  const driftKey = !spinning && input.drift;
  const driftPress = driftKey && !s.dk;
  s.dk = input.drift;
  const k = ctx.speed;
  const V = VEHICLES[s.veh] ?? VEHICLES[0];
  const giant = s.sizeT > 0 && s.sizeK > 0;
  const mini = s.sizeT > 0 && s.sizeK < 0;

  if (s.emp > 0) s.boost = 0;
  const boosting = s.boost > 0;
  // A kart that has only just left the ground (a bump, a crest) still drives normally,
  // so small hops never cut the throttle or the steering.
  const grounded = !s.air || s.airT < 4;
  const surface = SURFACE_PHYSICS[grounded ? s.surf : 0];
  let maxSpeed: number = KART.maxSpeed * k * V.speed;
  if (boosting) maxSpeed += KART.boostExtraSpeed * k;
  if (s.offroad) maxSpeed *= boosting ? KART.offroadBoostSpeedMul : KART.offroadSpeedMul;
  else if (!boosting) maxSpeed *= surface.speed;
  if (s.water) maxSpeed *= 0.84;
  if (s.slow > 0) maxSpeed *= 0.6;
  if (giant) maxSpeed *= 1.06;

  // Slope of the ground in the direction the kart is moving (rise over run).
  const dirT = Math.sin(s.vAngle) * track.tx[s.idx] + Math.cos(s.vAngle) * track.tz[s.idx];
  const slopeDir = grounded ? track.slope[s.idx] * dirT : 0;
  // Gravity helps downhill and fights uphill; top speed shifts the same way.
  maxSpeed *= Math.max(0.72, Math.min(1.35, 1 - slopeDir * 0.9));
  if (grounded) s.speed -= slopeDir * SLOPE_PULL * dt;

  // --- Throttle, brake, reverse, drag.
  const accelMul = surface.accel * (s.water ? 0.75 : 1) * V.accel;
  if (!grounded) {
    // In the air (or drifting through water) the wheels do nothing.
    s.speed -= s.speed * (s.water ? 0.25 : 0.06) * dt;
  } else if (throttle > 0) {
    // Acceleration never pushes past top speed; it only gets you there.
    if (s.speed < maxSpeed) {
      const fade = 1 - 0.55 * Math.min(1, Math.max(0, s.speed) / maxSpeed);
      s.speed = Math.min(maxSpeed, s.speed + KART.accel * k * accelMul * fade * (boosting ? KART.boostAccelMul : 1) * dt);
    }
  } else if (throttle < 0) {
    // Braking in a drift only trims speed, so a slide can be tightened without ending it.
    if (s.speed > 0.5) s.speed -= KART.brake * k * (s.driftDir !== 0 ? 0.4 : 1) * dt;
    else s.speed -= KART.reverseAccel * dt;
  } else {
    const d = (spinning ? KART.drag * 2.5 : KART.drag) * dt;
    if (s.speed > d) s.speed -= d;
    else if (s.speed < -d) s.speed += d;
    else s.speed = 0;
  }
  if (boosting && grounded && !spinning && s.speed < maxSpeed) s.speed = Math.min(maxSpeed, s.speed + KART.accel * k * dt); // boosts push even without throttle
  // Over the limit (boost just ended, or drove off the road): bleed speed off gradually.
  if (grounded && s.speed > maxSpeed) s.speed = Math.max(maxSpeed, s.speed - KART.overspeedDecel * k * dt);
  if (s.speed < -KART.maxReverse) s.speed = -KART.maxReverse;
  if (boosting) s.boost = Math.max(0, s.boost - dt);

  // --- Drift state. Hold drift while steering to start; release to cash in.
  if (s.driftDir !== 0) {
    if (!driftKey || s.speed < KART.driftMinSpeed * 0.7) {
      const level = driftKey ? 0 : driftLevel(s.driftCharge);
      if (level > 0 && s.emp <= 0) s.boost = Math.max(s.boost, KART.driftBoost[level - 1]);
      // The slide snaps straight on release, so the turbo fires where the nose points.
      if (level > 0) s.vAngle += angleDiff(s.heading, s.vAngle) * 0.7;
      s.driftDir = 0;
      s.driftCharge = 0;
    }
  } else if (grounded && !s.water && driftKey && Math.abs(steer) > 0.2 && s.speed >= KART.driftMinSpeed) {
    s.driftDir = steer > 0 ? 1 : -1;
    s.driftCharge = 0;
    // The tail steps out the moment the button goes down.
    s.heading -= s.driftDir * KART.driftKick;
  }

  // --- Steering. Heading decreases when turning right (see forward vector).
  const absSpeed = Math.abs(s.speed);
  const lowSpeed = Math.min(1, absSpeed / 7);
  const gripMul = surface.grip * (ev === EVENT.SLIPPERY && s.surf !== 3 ? 0.38 : 1) * (ev === EVENT.STORM ? 0.72 : 1);
  const turnMul = surface.turn * (s.water ? 0.85 : 1) * (mini ? 1.3 : 1);
  let turn: number;
  let grip: number;
  if (s.driftDir !== 0) {
    const into = steer * s.driftDir; // 1 = steering into the drift, -1 = counter-steering
    // Steering into the slide pulls it tight; steering against it runs it wide. Both keep the drift alive.
    const [wide, mid, tight] = KART.driftRadius;
    const curve = into >= 0 ? 1 / mid + (Math.sqrt(V.drift) / tight - 1 / mid) * into : 1 / mid + (1 / mid - 1 / wide) * into;
    turn = s.driftDir * Math.max(absSpeed, KART.driftMinSpeed) * curve;
    if (grounded) s.driftCharge += dt * (0.7 + 0.6 * Math.max(0, into)) * V.drift;
    grip = KART.driftGrip * Math.max(0.35, gripMul);
  } else {
    const damp = 1 - KART.turnSpeedDamp * Math.min(1, absSpeed / (KART.maxSpeed * k));
    turn = steer * KART.turnRate * damp * turnMul * V.turn;
    grip = KART.grip * gripMul;
  }
  if (!grounded) {
    // Limited air control: the nose turns, the flight path barely does.
    turn *= s.water ? 0.8 : 0.45;
    grip = s.water ? 3 : 0.9;
  }
  s.heading -= turn * lowSpeed * dt * (s.speed < 0 ? -1 : 1);
  s.vAngle += angleDiff(s.heading, s.vAngle) * Math.min(1, grip * dt);

  // --- Integrate, plus anything that carries the kart: conveyors, wind, currents.
  s.x += Math.sin(s.vAngle) * s.speed * dt;
  s.z += Math.cos(s.vAngle) * s.speed * dt;
  const i0 = s.idx;
  if (grounded && surface.push !== 0) {
    s.x += track.tx[i0] * surface.push * dt;
    s.z += track.tz[i0] * surface.push * dt;
  }
  let side = 0;
  for (const w of track.winds) {
    if (inRange(i0, w.i0, w.i1)) side += w.period > 0 ? w.push * Math.sin((time / w.period) * Math.PI * 2) : w.push;
  }
  if (ev === EVENT.WIND && !s.water) side += 7.5 * Math.sin(s.tick * DT * 1.1);
  if (side !== 0 && !giant) {
    s.x += track.nx[i0] * side * dt;
    s.z += track.nz[i0] * side * dt;
  }

  // --- Track boundaries.
  const loc = locate(track, s.x, s.z, s.idx, scratch);
  const i = loc.idx;
  const limit = track.def.wallHalfWidth - KART_RADIUS;
  let lateral = loc.lateral;
  const over = Math.abs(lateral) - limit;
  const openEdge = lateral > 0 ? (track.open[i] & 2) !== 0 : (track.open[i] & 1) !== 0;
  if (over > 0 && !openEdge) {
    const sgn = lateral > 0 ? 1 : -1;
    const wnx = track.nx[i] * sgn;
    const wnz = track.nz[i] * sgn;
    s.x -= wnx * over;
    s.z -= wnz * over;
    lateral = sgn * limit;
    // Remove the velocity component going into the wall and scrub some speed.
    const vx = Math.sin(s.vAngle) * s.speed;
    const vz = Math.cos(s.vAngle) * s.speed;
    const into = vx * wnx + vz * wnz;
    if (into > 0) {
      const sx = vx - wnx * into;
      const sz = vz - wnz * into;
      const sl = Math.hypot(sx, sz);
      // A graze costs little; driving into a wall costs a lot. Corners have to be driven, not bounced round.
      const kept = sl * (0.93 - Math.min(0.4, Math.max(0, into - 3) * 0.035));
      if (into > 9) s.boost = 0;
      if (s.speed >= 0) {
        if (sl > 0.01) s.vAngle = Math.atan2(sx, sz);
        s.speed = kept;
      } else {
        if (sl > 0.01) s.vAngle = Math.atan2(-sx, -sz);
        s.speed = -kept;
      }
      s.heading += angleDiff(s.vAngle, s.heading) * 0.14;
      if (s.driftDir !== 0 && into > 6) {
        s.driftDir = 0;
        s.driftCharge = 0;
      }
    }
  }
  s.idx = i;
  s.pos = i + loc.along / track.spacing;

  // --- Height: follow the road, leave it over crests and ramps, land again.
  const g = GRAVITY * (s.water ? 0.3 : 1) * (ev === EVENT.LOW_GRAVITY ? 0.42 : 1);
  const gy = groundHeight(track, i, loc.along, lateral, time);
  if (!s.air) {
    const ballistic = s.y + s.vy * dt - 0.5 * g * dt * dt;
    if (gy === -Infinity || ballistic > gy + 0.1) {
      s.air = true;
      s.y = ballistic;
      s.vy -= g * dt;
    } else {
      s.vy = Math.max(-60, Math.min(60, (gy - s.y) / dt));
      s.y = gy;
    }
  } else {
    // A fresh press of drift in mid-air is a trick: it pays out as a boost on landing.
    if (driftPress && !s.water && s.airT >= 3 && s.trick === 0) s.trick = 1;
    // Under water, holding drift swims upward a little.
    if (s.water && driftKey) s.vy = Math.min(7, s.vy + 34 * dt);
    s.vy -= g * dt;
    if (s.water && s.vy < -9) s.vy = -9;
    s.y += s.vy * dt;
    if (s.y <= gy) {
      // Touch down and pick up the road's own vertical speed so it does not bounce.
      s.y = gy;
      s.air = false;
      s.vy = track.slope[i] * s.speed * (Math.sin(s.vAngle) * track.tx[i] + Math.cos(s.vAngle) * track.tz[i]);
      if (s.driftDir !== 0 && s.airT > 6) s.driftCharge = Math.min(s.driftCharge, KART.driftLevels[0]);
      if (s.trick !== 0 && s.airT >= TRICK.minAirTicks && s.emp <= 0) s.boost = Math.max(s.boost, TRICK.boost);
      s.trick = 0;
    }
  }
  s.airT = s.air ? s.airT + 1 : 0;
  // Fell into a gap or off an open edge: back to the last safe spot, stationary.
  if (s.y < track.hy[i] - 28 || s.y < track.minY - 40) {
    respawnKart(s, track, track.unsafe[s.safe] ? track.respawnAt[s.safe] : s.safe);
    return;
  }
  s.water = s.y < track.waterLevel - 0.8;

  // --- Moving hazards.
  const radius = kartRadius(s);
  for (const h of track.hazards) {
    const d = h.def;
    if (d.kind === "collapse" || d.kind === "platform") continue;
    // Skip hazards nowhere near this kart.
    const near = d.kind === "runner" ? true : Math.abs(h.x - s.x) < 40 && Math.abs(h.z - s.z) < 40;
    if (!near) continue;
    hazardPose(track, h, time, pose);
    if (d.kind === "roller" || d.kind === "runner") {
      if (!pose.on) continue;
      const dx = s.x - pose.x;
      const dz = s.z - pose.z;
      const reach = d.radius + radius;
      if (dx * dx + dz * dz < reach * reach && s.y < pose.y + d.radius && s.y > pose.y - d.radius - 2.5 && hitKart(s)) {
        // Knocked away from the thing that hit it.
        const l = Math.hypot(dx, dz) || 1;
        s.x += (dx / l) * 1.2;
        s.z += (dz / l) * 1.2;
      }
    } else if (d.kind === "spinner") {
      if (Math.abs(s.y - h.y) > 2.2) continue;
      const ax = Math.sin(pose.ang);
      const az = Math.cos(pose.ang);
      const rx = s.x - h.x;
      const rz = s.z - h.z;
      const along = Math.max(-d.length / 2, Math.min(d.length / 2, rx * ax + rz * az));
      const px = rx - ax * along;
      const pz = rz - az * along;
      if (px * px + pz * pz < (0.55 + radius) * (0.55 + radius)) hitKart(s);
    } else if (d.kind === "gate") {
      if (pose.on && Math.abs(s.y - h.y) < 4) {
        let dd = s.pos - h.i0;
        if (dd > track.n / 2) dd -= track.n;
        else if (dd < -track.n / 2) dd += track.n;
        if (Math.abs(dd) * track.spacing < 1.4 && hitKart(s)) s.speed = -Math.abs(s.speed) * 0.5;
      }
    } else if (d.kind === "geyser") {
      if (pose.on && !s.air) {
        const dx = s.x - h.x;
        const dz = s.z - h.z;
        if (dx * dx + dz * dz < d.radius * d.radius) {
          s.air = true;
          s.vy = d.power;
          s.y += 0.2;
        }
      }
    }
  }

  if (s.air) return;
  if (!track.unsafe[i]) s.safe = i;
  s.offroad = Math.abs(lateral) > track.def.roadHalfWidth;
  s.surf = s.offroad ? 0 : surfaceAt(track, i, lateral);
  if (s.emp > 0) return;
  if (s.surf === 6) s.boost = Math.max(s.boost, 0.35);
  if (onBoostPad(track, i, lateral)) s.boost = Math.max(s.boost, KART.boostPadSeconds);
}

/**
 * Kart-to-kart collision between two karts (server-side). Pushes them apart
 * and trades part of their closing velocity. Returns true if they touched.
 */
export function collideKarts(a: KartState, b: KartState): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const min = kartRadius(a) + kartRadius(b);
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min || Math.abs(a.y - b.y) > 1.6) return false;
  const d = Math.sqrt(d2);
  const nx = d > 1e-4 ? dx / d : 1;
  const nz = d > 1e-4 ? dz / d : 0;
  // Heavier vehicles give less ground and take less of the bump.
  const ma = (VEHICLES[a.veh] ?? VEHICLES[0]).weight;
  const mb = (VEHICLES[b.veh] ?? VEHICLES[0]).weight;
  const sa = mb / (ma + mb);
  const sb = ma / (ma + mb);
  const push = min - d;
  a.x -= nx * push * sa;
  a.z -= nz * push * sa;
  b.x += nx * push * sb;
  b.z += nz * push * sb;

  const avx = Math.sin(a.vAngle) * a.speed;
  const avz = Math.cos(a.vAngle) * a.speed;
  const bvx = Math.sin(b.vAngle) * b.speed;
  const bvz = Math.cos(b.vAngle) * b.speed;
  const closing = (avx - bvx) * nx + (avz - bvz) * nz;
  if (closing > 0) {
    const j = closing * 1.5; // partly elastic, shared out by weight
    applyVelocity(a, avx - nx * j * sa, avz - nz * j * sa);
    applyVelocity(b, bvx + nx * j * sb, bvz + nz * j * sb);
  }
  return true;
}

function applyVelocity(s: KartState, vx: number, vz: number): void {
  // A shunt can never push a kart past its boosted top speed.
  const sp = Math.min(Math.hypot(vx, vz), (KART.maxSpeed + KART.boostExtraSpeed) * 1.7);
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
