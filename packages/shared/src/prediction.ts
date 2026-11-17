/**
 * Client-side prediction and server reconciliation for the local kart.
 *
 * Every local tick the client applies its input immediately (so the kart
 * responds with zero latency), remembers that input, and sends it to the
 * server tagged with a sequence number. When the server's authoritative state
 * arrives with the last sequence number it processed, the client rewinds to
 * that state and replays the inputs the server has not seen yet. Any difference
 * from what was on screen is folded into a small visual offset that decays over
 * a few frames, so corrections are smooth instead of snapping.
 */
import { angleDiff, copyKartState, createKartState, decodeInput, stepKart, unpackKartState, type KartInput, type KartState } from "./physics";
import type { Track } from "./track";

interface PendingInput {
  seq: number;
  bits: number;
  steer: number;
}

export class Predictor {
  /** Predicted state after the latest local tick. */
  readonly state: KartState = createKartState();
  /** Predicted state one tick earlier (for render interpolation). */
  readonly prev: KartState = createKartState();
  /** Visual error offsets, decayed by the renderer. */
  errX = 0;
  errZ = 0;
  errH = 0;
  errY = 0;
  seq = 0;
  /** Largest and total correction distance since the last reset (diagnostics). */
  maxCorrection = 0;
  corrections = 0;

  private pending: PendingInput[] = [];
  private readonly input: KartInput = { throttle: 0, steer: 0, drift: false, reset: false };
  private readonly before: KartState = createKartState();
  private hasState = false;

  constructor(public track: Track) {}

  reset(track: Track = this.track): void {
    this.track = track;
    this.pending = [];
    this.seq = 0;
    this.errX = this.errZ = this.errH = this.errY = 0;
    this.maxCorrection = 0;
    this.corrections = 0;
    this.hasState = false;
  }

  get ready(): boolean {
    return this.hasState;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /** Advance the local kart one tick. Returns the input message to send. */
  tick(bits: number, steer: number): [number, number, number] {
    const seq = ++this.seq;
    this.pending.push({ seq, bits, steer });
    if (this.pending.length > 120) this.pending.shift();
    copyKartState(this.state, this.prev);
    stepKart(this.state, decodeInput(bits, steer, this.input), this.track);
    return [seq, bits, steer];
  }

  /**
   * Apply the server's authoritative state for our kart. `msg` is
   * [ackSeq, ...packKartState]. Returns the size of the correction in world units.
   */
  reconcile(msg: number[]): number {
    const ack = msg[0];
    copyKartState(this.state, this.before);
    const first = !this.hasState;

    unpackKartState(msg, 1, this.state);
    let k = 0;
    while (k < this.pending.length && this.pending[k].seq <= ack) k++;
    if (k > 0) this.pending.splice(0, k);
    copyKartState(this.state, this.prev);
    for (const p of this.pending) {
      copyKartState(this.state, this.prev);
      stepKart(this.state, decodeInput(p.bits, p.steer, this.input), this.track);
    }
    this.hasState = true;
    if (first) return 0;

    this.errY += this.before.y - this.state.y;
    const dx = this.before.x - this.state.x;
    const dz = this.before.z - this.state.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 12) {
      // Far too large to smooth (reset, respawn, long stall): snap.
      this.errX = this.errZ = this.errH = this.errY = 0;
    } else {
      this.errX += dx;
      this.errZ += dz;
      this.errH += angleDiff(this.before.heading, this.state.heading);
    }
    if (dist > 0.001) this.corrections++;
    if (dist > this.maxCorrection) this.maxCorrection = dist;
    return dist;
  }

  /** Decay the visual error. Call once per rendered frame. */
  decay(frameSeconds: number): void {
    const f = Math.exp(-frameSeconds * 12);
    this.errX *= f;
    this.errZ *= f;
    this.errH *= f;
    this.errY *= f;
  }
}
