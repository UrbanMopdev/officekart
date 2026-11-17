/**
 * A scripted network client used ONLY by the automated tests and the load
 * test. It connects through the real Colyseus protocol exactly like a browser
 * does and drives by sending inputs; it is not part of the game and the game
 * never adds computer-controlled racers.
 */
import { Client, type Room } from "colyseus.js";
import {
  DEFAULT_TRACK_ID,
  INPUT_BITS,
  MSG,
  Predictor,
  ROOM_NAME,
  TICK_MS,
  angleDiff,
  getTrack,
  type Notice,
  type Phase,
} from "@office-kart/shared";

export interface BotOptions {
  name: string;
  /** Preferred offset from the centreline. */
  lane?: number;
  drift?: boolean;
  /** Input send rate multiplier. >1 simulates a speed-hack attempt. */
  inputRate?: number;
  /** Press the item button now and then. */
  items?: boolean;
  /** If false the bot joins but never drives. */
  drive?: boolean;
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  slot: number;
  ready: boolean;
  connected: boolean;
  racing: boolean;
  lap: number;
  place: number;
  finished: boolean;
  finishMs: number;
  bestLapMs: number;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Bot {
  readonly client: Client;
  room!: Room;
  readonly predictor = new Predictor(getTrack(DEFAULT_TRACK_ID));
  /** The track of the current race (follows the lobby's selection). */
  get track() {
    return this.predictor.track;
  }
  notices: Notice[] = [];
  rtts: number[] = [];
  /** serverTime - localTime, from the lowest-latency ping. */
  clockOffset = 0;
  private bestRtt = Infinity;
  snapshotGaps: number[] = [];
  snapshots = 0;
  private lastSnapshotAt = 0;
  /** [localMs, x, z] samples of our authoritative position. */
  selfTrace: [number, number, number][] = [];
  maxServerSpeed = 0;
  inputsSent = 0;
  private raceLocalStart = 0;
  private timers: NodeJS.Timeout[] = [];
  private lastPhase: Phase = "lobby";
  closed = false;

  constructor(private readonly url: string, readonly opts: BotOptions) {
    this.client = new Client(url);
  }

  async create(): Promise<string> {
    this.bind(await this.client.create(ROOM_NAME, { name: this.opts.name }));
    return this.room.roomId;
  }

  async join(code: string): Promise<void> {
    this.bind(await this.client.joinById(code, { name: this.opts.name }));
  }

  /** Simulate a dropped connection (no goodbye sent). */
  async drop(): Promise<string> {
    const token = this.room.reconnectionToken;
    this.stopTimers();
    await this.room.leave(false);
    return token;
  }

  async reconnect(token: string): Promise<void> {
    this.predictor.reset();
    this.raceLocalStart = 0;
    this.inputsSent = 0;
    this.bind(await this.client.reconnect(token));
  }

  async leave(): Promise<void> {
    this.closed = true;
    this.stopTimers();
    await this.room.leave(true);
  }

  get phase(): Phase {
    return (this.room.state?.phase ?? "lobby") as Phase;
  }

  get players(): PlayerSnapshot[] {
    const out: PlayerSnapshot[] = [];
    this.room.state?.players?.forEach((p: PlayerSnapshot) => {
      out.push({ id: p.id, name: p.name, slot: p.slot, ready: p.ready, connected: p.connected, racing: p.racing, lap: p.lap, place: p.place, finished: p.finished, finishMs: p.finishMs, bestLapMs: p.bestLapMs });
    });
    return out;
  }

  get me(): PlayerSnapshot | undefined {
    return this.players.find((p) => p.id === this.room.sessionId);
  }

  async waitFor(what: string, cond: () => boolean, timeoutMs = 10_000): Promise<void> {
    const end = Date.now() + timeoutMs;
    while (!cond()) {
      if (Date.now() > end) throw new Error(`${this.opts.name}: timed out waiting for ${what}`);
      await sleep(25);
    }
  }

  private stopTimers(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private bind(room: Room): void {
    this.room = room;
    room.onMessage(MSG.NOTICE, (n: Notice) => this.notices.push(n));
    room.onMessage(MSG.PONG, ([t, serverNow]: [number, number]) => {
      const now = Date.now();
      const rtt = now - t;
      this.rtts.push(rtt);
      if (rtt <= this.bestRtt) {
        this.bestRtt = rtt;
        this.clockOffset = serverNow - (t + rtt / 2);
      }
    });
    room.onMessage(MSG.SNAPSHOT, () => {
      const now = performance.now();
      if (this.phase === "racing") {
        if (this.lastSnapshotAt) this.snapshotGaps.push(now - this.lastSnapshotAt);
        this.snapshots++;
      }
      this.lastSnapshotAt = now;
    });
    room.onMessage(MSG.SELF, (msg: number[]) => {
      this.predictor.reconcile(msg);
      if (this.phase === "racing") {
        this.selfTrace.push([performance.now(), msg[1], msg[2]]);
        this.maxServerSpeed = Math.max(this.maxServerSpeed, msg[5]);
      }
    });
    room.onMessage("*", () => {});
    room.onLeave(() => this.stopTimers());

    this.timers.push(setInterval(() => room.send(MSG.PING, Date.now()), 1000));
    room.send(MSG.PING, Date.now());
    this.timers.push(setInterval(() => this.driveTick(), 4));
  }

  private driveTick(): void {
    const phase = this.phase;
    if (phase !== this.lastPhase) {
      if (phase === "countdown") {
        this.predictor.reset(getTrack(this.room.state.trackId));
        this.selfTrace = [];
        this.maxServerSpeed = 0;
      }
      this.raceLocalStart = 0;
      this.inputsSent = 0;
      this.lastPhase = phase;
    }
    if (phase !== "racing" || !this.predictor.ready || this.opts.drive === false) return;
    if (this.me?.finished) return;

    const now = performance.now();
    if (!this.raceLocalStart) this.raceLocalStart = now;
    const owed = Math.floor(((now - this.raceLocalStart) / TICK_MS) * (this.opts.inputRate ?? 1)) - this.inputsSent;
    for (let i = 0; i < Math.min(owed, 6); i++) {
      const [bits, steer] = this.think();
      this.room.send(MSG.INPUT, this.predictor.tick(bits, steer));
      this.inputsSent++;
    }
  }

  /** Follow the centreline: aim at a point a little way ahead. */
  private think(): [number, number] {
    const s = this.predictor.state;
    const t = this.track;
    const ahead = Math.round(5 + Math.abs(s.speed) * 0.22);
    const i = (s.idx + ahead) % t.n;
    const lane = this.opts.lane ?? 0;
    const tx = t.px[i] + t.nx[i] * lane;
    const tz = t.pz[i] + t.nz[i] * lane;
    const want = Math.atan2(tx - s.x, tz - s.z);
    const diff = angleDiff(want, s.heading);
    const steer = Math.max(-1, Math.min(1, -diff * 3));
    let bits = INPUT_BITS.ACCEL;
    if (this.opts.drift && Math.abs(diff) > 0.3) bits |= INPUT_BITS.DRIFT;
    if (this.opts.items && Math.random() < 0.03) bits |= INPUT_BITS.USE;
    return [bits, steer];
  }
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
