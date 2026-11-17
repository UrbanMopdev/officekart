import { type Client, Room, ServerError } from "@colyseus/core";
import {
  COUNTDOWN_MS,
  DEFAULT_TRACK_ID,
  FINISH_GRACE_MS,
  FLAG,
  KART_COLORS,
  MAX_LAPS,
  MAX_PLAYERS,
  MAX_RACE_MS,
  MIN_LAPS,
  MSG,
  RECONNECT_SECONDS,
  SNAPSHOT_EVERY,
  TICK_MS,
  TRACK_DEFS,
  collideKarts,
  createKartState,
  decodeInput,
  driftLevel,
  getTrack,
  packKartState,
  placeOnGrid,
  sanitizeName,
  stepKart,
  wrapDelta,
  type JoinOptions,
  type KartInput,
  type KartState,
  type Notice,
  type Track,
} from "@office-kart/shared";
import { activeRoomCount, releaseCode, reserveCode } from "../util/codes";
import { errorFields, log } from "../util/log";
import { recordTick } from "../util/metrics";
import { TokenBucket } from "../util/rateLimit";
import { PlayerState, RaceState } from "./schema";

const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 100;
/** A kart may run at most this many ticks ahead of real time (absorbs jitter). */
const INPUT_SLACK_TICKS = 3;
/** Inputs buffered per player before the oldest are discarded. */
const MAX_QUEUE = 10;
/** After this many ticks without fresh input, a kart coasts instead of repeating. */
const IDLE_NEUTRAL_TICKS = 12;
const STRIKES_BEFORE_KICK = 300;

interface QueuedInput {
  seq: number;
  bits: number;
  steer: number;
}

interface Racer {
  id: string;
  slot: number;
  kart: KartState;
  input: KartInput;
  queue: QueuedInput[];
  /** Last input sequence number fed into the simulation (sent back as the ack). */
  lastSeq: number;
  /** Last input sequence number accepted into the queue. */
  lastQueuedSeq: number;
  /** Simulation ticks this kart has been advanced in the current race. */
  simTicks: number;
  idleTicks: number;
  /** Unwrapped distance travelled, in centreline samples. Negative on the grid. */
  travel: number;
  /** Checkpoints passed in order since the start (the start line is the first). */
  cpCount: number;
  lapStartMs: number;
  finished: boolean;
}

interface ClientMeta {
  inputBucket: TokenBucket;
  msgBucket: TokenBucket;
  strikes: number;
  kicked: boolean;
}

function newMeta(): ClientMeta {
  return { inputBucket: new TokenBucket(90, 60), msgBucket: new TokenBucket(30, 10), strikes: 0, kicked: false };
}

export class RaceRoom extends Room<RaceState> {
  /** Set on SIGTERM: no new rooms are created and no new races start. */
  static shuttingDown = false;

  maxClients = MAX_PLAYERS;
  patchRate = 50;
  state = new RaceState();

  private track: Track = getTrack(DEFAULT_TRACK_ID);
  private racers = new Map<string, Racer>();
  private order: Racer[] = [];
  private finishOrder: string[] = [];
  private raceTick = 0;
  private acc = 0;
  private finishDeadlineMs = 0;
  private nextCountdownSnapshot = 0;
  private closing = false;

  // ---------------------------------------------------------------- lifecycle

  onCreate(): void {
    if (RaceRoom.shuttingDown) throw new ServerError(503, "The server is restarting. Try again in a moment.");
    if (activeRoomCount() >= MAX_ROOMS) throw new ServerError(503, "The server is full. Try again later.");

    const code = reserveCode();
    this.roomId = code;
    this.state.code = code;
    void this.setPrivate(true);

    this.onMessage(MSG.INPUT, (client, payload) => this.onInput(client, payload));

    this.onMessage(MSG.PING, (client, t) => {
      if (!this.allow(client)) return;
      if (typeof t === "number" && Number.isFinite(t)) client.send(MSG.PONG, [t, Date.now()]);
    });

    this.on(MSG.READY, (_client, player, ready) => {
      if (this.state.phase !== "lobby") return;
      player.ready = ready === true;
    });

    this.on(MSG.KART, (client, player, payload: { color?: unknown }) => {
      if (this.state.phase !== "lobby" && this.state.phase !== "results") return;
      const color = payload?.color;
      if (typeof color !== "number" || !Number.isInteger(color) || color < 0 || color >= KART_COLORS.length) return;
      for (const other of this.state.players.values()) {
        if (other !== player && other.color === color) {
          this.notify(client, "error", "That colour is taken.");
          return;
        }
      }
      player.color = color;
    });

    this.on(MSG.SETTINGS, (client, _player, payload: { laps?: unknown; trackId?: unknown }) => {
      if (!this.isHost(client) || this.state.phase !== "lobby") return;
      const laps = payload?.laps;
      if (typeof laps === "number" && Number.isInteger(laps) && laps >= MIN_LAPS && laps <= MAX_LAPS) {
        this.state.laps = laps;
      }
      const trackId = payload?.trackId;
      if (typeof trackId === "string" && Object.prototype.hasOwnProperty.call(TRACK_DEFS, trackId)) {
        this.state.trackId = trackId;
      }
    });

    this.on(MSG.START, (client) => {
      if (!this.isHost(client) || this.state.phase !== "lobby") return;
      for (const p of this.state.players.values()) {
        if (p.connected && p.id !== this.state.hostId && !p.ready) {
          this.notify(client, "error", "Everyone needs to be ready first.");
          return;
        }
      }
      this.startCountdown(client);
    });

    this.on(MSG.REMATCH, (client) => {
      if (!this.isHost(client) || this.state.phase !== "results") return;
      this.startCountdown(client);
    });

    this.on(MSG.TO_LOBBY, (client) => {
      if (!this.isHost(client) || this.state.phase !== "results") return;
      this.toLobby();
    });

    // Anything else is ignored, but still counts against the sender's rate limit.
    this.onMessage("*", (client) => void this.allow(client));

    this.setSimulationInterval((dt) => this.update(dt), TICK_MS);
    log.info("room_created", { room: code, rooms: activeRoomCount() });
  }

  onJoin(client: Client, options: JoinOptions): void {
    const name = sanitizeName(options?.name);
    if (!name) throw new ServerError(400, "Please enter a nickname.");
    if (this.state.phase === "countdown" || this.state.phase === "racing") {
      throw new ServerError(409, "A race is in progress. Try again when it finishes.");
    }

    client.userData = newMeta();
    const player = new PlayerState();
    player.id = client.sessionId;
    player.name = this.uniqueName(name);
    player.slot = this.freeSlot();
    player.color = this.pickColor(options?.color);
    this.state.players.set(client.sessionId, player);
    if (!this.state.players.has(this.state.hostId)) this.state.hostId = client.sessionId;
    log.info("player_joined", { room: this.roomId, player: client.sessionId, players: this.state.players.size });
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    const id = client.sessionId;
    const player = this.state.players.get(id);
    if (!player) return;
    player.connected = false;
    player.ready = false;
    const racer = this.racers.get(id);
    if (racer) racer.queue.length = 0;

    const kicked = (client.userData as ClientMeta | undefined)?.kicked === true;
    if (!consented && !this.closing && !kicked) {
      // Hold the seat (and the kart, if racing) so a dropped player can return.
      try {
        const returned = await this.allowReconnection(client, RECONNECT_SECONDS);
        returned.userData = newMeta();
        player.connected = true;
        if (racer) {
          // The client restarts its input sequence after reconnecting.
          racer.queue.length = 0;
          racer.lastSeq = 0;
          racer.lastQueuedSeq = 0;
        }
        log.info("player_reconnected", { room: this.roomId, player: id });
        return;
      } catch {
        // Reconnection window expired; fall through and remove the player.
      }
    }
    this.removePlayer(id);
  }

  onDispose(): void {
    releaseCode(this.roomId);
    log.info("room_disposed", { room: this.roomId, rooms: activeRoomCount() });
  }

  onBeforeShutdown(): void {
    this.closing = true;
    this.broadcast(MSG.NOTICE, { level: "error", text: "The server is restarting. Create a new lobby in a moment." } satisfies Notice);
    void this.disconnect();
  }

  /** Colyseus wraps every handler and timer with this, so one bad room never takes the process down. */
  onUncaughtException(err: Error, methodName: string): void {
    if (methodName === "onJoin") {
      // Rejected joins (bad nickname, race in progress) are expected, not faults.
      log.info("join_rejected", { room: this.roomId, reason: err.message });
      return;
    }
    log.error("room_error", { room: this.roomId, method: methodName, ...errorFields(err) });
  }

  // ------------------------------------------------------------------ helpers

  private on<T>(type: string, handler: (client: Client, player: PlayerState, payload: T) => void): void {
    this.onMessage(type, (client, payload) => {
      if (!this.allow(client)) return;
      const player = this.state.players.get(client.sessionId);
      if (player) handler(client, player, payload as T);
    });
  }

  /** General message rate limit. Persistent flooding gets the client removed. */
  private allow(client: Client): boolean {
    const meta = client.userData as ClientMeta | undefined;
    if (!meta) return false;
    if (meta.msgBucket.take()) return true;
    this.strike(client, meta);
    return false;
  }

  private strike(client: Client, meta: ClientMeta): void {
    meta.strikes++;
    if (meta.strikes === STRIKES_BEFORE_KICK) {
      meta.kicked = true;
      log.warn("client_kicked_rate_limit", { room: this.roomId, player: client.sessionId });
      client.leave(4003, "rate limit");
    }
  }

  private isHost(client: Client): boolean {
    return client.sessionId === this.state.hostId;
  }

  private notify(client: Client, level: Notice["level"], text: string): void {
    client.send(MSG.NOTICE, { level, text } satisfies Notice);
  }

  private uniqueName(name: string): string {
    const taken = new Set<string>();
    for (const p of this.state.players.values()) taken.add(p.name.toLowerCase());
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; i < 100; i++) {
      const candidate = `${name.slice(0, 13)} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return name;
  }

  private freeSlot(): number {
    const used = new Set<number>();
    for (const p of this.state.players.values()) used.add(p.slot);
    for (let s = 0; s < MAX_PLAYERS; s++) if (!used.has(s)) return s;
    return 0;
  }

  private pickColor(requested: unknown): number {
    const used = new Set<number>();
    for (const p of this.state.players.values()) used.add(p.color);
    if (typeof requested === "number" && Number.isInteger(requested) && requested >= 0 && requested < KART_COLORS.length && !used.has(requested)) {
      return requested;
    }
    for (let c = 0; c < KART_COLORS.length; c++) if (!used.has(c)) return c;
    return 0;
  }

  private removePlayer(id: string): void {
    this.state.players.delete(id);
    if (this.racers.delete(id)) this.order = [...this.racers.values()];
    if (this.state.hostId === id) {
      let next: PlayerState | undefined;
      for (const p of this.state.players.values()) {
        if (!next || (p.connected && !next.connected) || (p.connected === next.connected && p.slot < next.slot)) next = p;
      }
      this.state.hostId = next ? next.id : "";
    }
    log.info("player_left", { room: this.roomId, player: id, players: this.state.players.size });
    if ((this.state.phase === "racing" || this.state.phase === "countdown") && this.racers.size === 0) this.endRace();
  }

  // --------------------------------------------------------------- race flow

  private startCountdown(host: Client): void {
    if (RaceRoom.shuttingDown) {
      this.notify(host, "error", "The server is about to restart, so new races are paused.");
      return;
    }
    const st = this.state;
    this.track = getTrack(st.trackId);
    this.racers.clear();
    this.finishOrder = [];

    const entrants: PlayerState[] = [];
    for (const p of st.players.values()) {
      p.racing = false;
      p.finished = false;
      p.finishMs = 0;
      p.bestLapMs = 0;
      p.lap = 0;
      p.place = 0;
      if (p.connected) entrants.push(p);
    }
    // Random grid each race.
    for (let i = entrants.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [entrants[i], entrants[j]] = [entrants[j], entrants[i]];
    }
    entrants.forEach((p, gridPos) => {
      const kart = placeOnGrid(createKartState(), this.track, gridPos);
      this.racers.set(p.id, {
        id: p.id,
        slot: p.slot,
        kart,
        input: { throttle: 0, steer: 0, drift: false, reset: false },
        queue: [],
        lastSeq: 0,
        lastQueuedSeq: 0,
        simTicks: 0,
        idleTicks: 0,
        travel: wrapDelta(kart.pos, 0, this.track.n),
        cpCount: 0,
        lapStartMs: 0,
        finished: false,
      });
      p.racing = true;
      p.lap = 1;
      p.place = gridPos + 1;
    });
    this.order = [...this.racers.values()];

    this.raceTick = 0;
    this.acc = 0;
    this.finishDeadlineMs = 0;
    st.raceNumber++;
    st.raceStartAt = Date.now() + COUNTDOWN_MS;
    st.phase = "countdown";
    void this.lock();
    this.nextCountdownSnapshot = Date.now() + 250;
    this.sendSnapshot();
    log.info("race_countdown", { room: this.roomId, race: st.raceNumber, racers: this.racers.size, laps: st.laps, track: st.trackId });
  }

  private toLobby(): void {
    for (const p of this.state.players.values()) {
      p.racing = false;
      p.ready = false;
    }
    this.racers.clear();
    this.order = [];
    this.state.phase = "lobby";
  }

  private endRace(): void {
    const st = this.state;
    this.updatePlaces();
    st.phase = "results";
    for (const p of st.players.values()) p.ready = false;
    void this.unlock();

    const results: Record<string, unknown>[] = [];
    for (const p of st.players.values()) {
      if (p.racing) results.push({ name: p.name, place: p.place, finished: p.finished, finishMs: p.finishMs, bestLapMs: p.bestLapMs });
    }
    results.sort((a, b) => (a.place as number) - (b.place as number));
    // Phase 3 persists this validated result to PostgreSQL; for now it is logged.
    log.info("race_finished", { room: this.roomId, race: st.raceNumber, track: st.trackId, laps: st.laps, results });
  }

  // -------------------------------------------------------------- simulation

  private onInput(client: Client, payload: unknown): void {
    const meta = client.userData as ClientMeta | undefined;
    if (!meta) return;
    if (!meta.inputBucket.take()) return this.strike(client, meta);
    if (this.state.phase !== "racing") return;
    const racer = this.racers.get(client.sessionId);
    if (!racer || racer.finished) return;

    if (!Array.isArray(payload) || payload.length !== 3) return;
    const [seq, bits, steer] = payload as unknown[];
    if (typeof seq !== "number" || !Number.isInteger(seq)) return;
    if (typeof bits !== "number" || !Number.isInteger(bits) || bits < 0 || bits > 15) return;
    if (typeof steer !== "number" || !Number.isFinite(steer)) return;
    // Sequence numbers must move forward, and not by an absurd amount.
    if (seq <= racer.lastQueuedSeq || seq > racer.lastQueuedSeq + 600) return;

    racer.lastQueuedSeq = seq;
    racer.queue.push({ seq, bits, steer: Math.max(-1, Math.min(1, steer)) });
    if (racer.queue.length > MAX_QUEUE) racer.queue.splice(0, racer.queue.length - MAX_QUEUE / 2);
  }

  private update(dt: number): void {
    const st = this.state;
    if (st.phase === "countdown") {
      const now = Date.now();
      if (now >= st.raceStartAt) {
        st.phase = "racing";
        this.raceTick = 0;
        this.acc = 0;
      } else if (now >= this.nextCountdownSnapshot) {
        this.nextCountdownSnapshot = now + 250;
        this.sendSnapshot();
      }
      return;
    }
    if (st.phase !== "racing") return;

    this.acc = Math.min(this.acc + dt, 250);
    while (this.acc >= TICK_MS && this.state.phase === "racing") {
      this.acc -= TICK_MS;
      const t0 = performance.now();
      this.step();
      recordTick(performance.now() - t0);
    }
  }

  /** One fixed 30 Hz tick of the authoritative race. */
  private step(): void {
    this.raceTick++;
    const raceMs = this.raceTick * TICK_MS;
    const order = this.order;

    for (const r of order) {
      if (r.finished) {
        r.input.throttle = 0;
        r.input.steer = 0;
        r.input.drift = false;
        r.input.reset = false;
        this.simulate(r, raceMs);
        continue;
      }
      // A kart advances one tick per input. It may run a few ticks ahead of real
      // time to absorb network jitter, but never more, so withholding and then
      // flooding inputs cannot make a kart go faster than the clock.
      let steps = 0;
      while (r.queue.length > 0 && steps < 2 && r.simTicks < this.raceTick + INPUT_SLACK_TICKS) {
        const q = r.queue.shift()!;
        decodeInput(q.bits, q.steer, r.input);
        r.lastSeq = q.seq;
        r.idleTicks = 0;
        this.simulate(r, raceMs);
        steps++;
      }
      if (steps === 0 && r.simTicks < this.raceTick) {
        // No input arrived in time: repeat the last one briefly, then coast.
        r.idleTicks++;
        r.input.reset = false;
        if (r.idleTicks > IDLE_NEUTRAL_TICKS) {
          r.input.throttle = 0;
          r.input.steer = 0;
          r.input.drift = false;
        }
        this.simulate(r, raceMs);
      }
    }

    // Kart-to-kart collisions (finished karts become ghosts).
    for (let i = 0; i < order.length; i++) {
      const a = order[i];
      if (a.finished) continue;
      for (let j = i + 1; j < order.length; j++) {
        const b = order[j];
        if (!b.finished) collideKarts(a.kart, b.kart);
      }
    }

    if (this.raceTick % 3 === 0) this.updatePlaces();
    if (this.raceTick % SNAPSHOT_EVERY === 0) this.sendSnapshot();

    // End conditions.
    let racing = 0;
    for (const r of order) if (!r.finished) racing++;
    if (racing === 0 || (this.finishDeadlineMs > 0 && raceMs >= this.finishDeadlineMs) || raceMs >= MAX_RACE_MS) {
      this.sendSnapshot();
      this.endRace();
    }
  }

  private simulate(r: Racer, raceMs: number): void {
    const track = this.track;
    const before = r.kart.pos;
    stepKart(r.kart, r.input, track);
    r.input.reset = false;
    r.simTicks++;
    r.travel += wrapDelta(r.kart.pos, before, track.n);
    if (r.finished) return;

    // Checkpoints must be crossed in order. `travel` is continuous (a kart's
    // track position can only move to neighbouring samples), so the only way to
    // reach the next threshold is to drive there.
    const cps = track.checkpoints;
    const k = cps.length;
    for (;;) {
      const threshold = Math.floor(r.cpCount / k) * track.n + cps[r.cpCount % k];
      if (r.travel < threshold) break;
      r.cpCount++;
      const crossedLine = (r.cpCount - 1) % k === 0;
      if (!crossedLine || r.cpCount === 1) continue;

      const player = this.state.players.get(r.id);
      const lapMs = Math.round(raceMs - r.lapStartMs);
      r.lapStartMs = raceMs;
      const lapsDone = (r.cpCount - 1) / k;
      if (player) {
        if (player.bestLapMs === 0 || lapMs < player.bestLapMs) player.bestLapMs = lapMs;
        player.lap = Math.min(this.state.laps, lapsDone + 1);
      }
      if (lapsDone >= this.state.laps) {
        r.finished = true;
        this.finishOrder.push(r.id);
        if (player) {
          player.finished = true;
          player.finishMs = Math.round(raceMs);
          player.place = this.finishOrder.length;
        }
        if (this.finishDeadlineMs === 0) this.finishDeadlineMs = raceMs + FINISH_GRACE_MS;
        break;
      }
    }
  }

  private updatePlaces(): void {
    const sorted = [...this.order].sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished) return this.finishOrder.indexOf(a.id) - this.finishOrder.indexOf(b.id);
      return b.travel - a.travel;
    });
    for (let i = 0; i < sorted.length; i++) {
      const p = this.state.players.get(sorted[i].id);
      if (p && p.place !== i + 1) p.place = i + 1;
    }
  }

  private sendSnapshot(): void {
    const flat: number[] = [];
    for (const r of this.order) {
      const k = r.kart;
      let flags = 0;
      if (k.driftDir < 0) flags |= FLAG.DRIFT_LEFT;
      else if (k.driftDir > 0) flags |= FLAG.DRIFT_RIGHT;
      if (k.boost > 0) flags |= FLAG.BOOST;
      flags |= driftLevel(k.driftCharge) << FLAG.LEVEL_SHIFT;
      if (k.offroad) flags |= FLAG.OFFROAD;
      if (r.finished) flags |= FLAG.FINISHED;
      flat.push(r.slot, k.x, k.z, k.heading, k.speed, flags);
    }
    this.broadcast(MSG.SNAPSHOT, [Date.now(), this.raceTick, flat]);
    for (const client of this.clients) {
      const r = this.racers.get(client.sessionId);
      if (r) client.send(MSG.SELF, [r.lastSeq, ...packKartState(r.kart)]);
    }
  }
}
