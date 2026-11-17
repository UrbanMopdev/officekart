import { type Client, Room, ServerError } from "@colyseus/core";
import {
  COUNTDOWN_MS,
  DEFAULT_TRACK_ID,
  DT,
  EVENT,
  FX,
  POINTS,
  TICK_RATE,
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
  type RaceCtx,
  type Track,
  DRAFT,
  ROCKET,
  SPEED_CLASSES,
  KART,
} from "@office-kart/shared";
import { CHAOS_PACE, ItemWorld, pickEvent, rollItem } from "./items";
import { activeRoomCount, releaseCode, reserveCode } from "../util/codes";
import { errorFields, log } from "../util/log";
import { recordTick } from "../util/metrics";
import { TokenBucket } from "../util/rateLimit";
import { AwardState, PlayerState, RaceState } from "./schema";

const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 100;
/** A kart may run at most this many ticks ahead of real time (absorbs jitter). */
const INPUT_SLACK_TICKS = 3;
/** Inputs buffered per player before the oldest are discarded. */
const MAX_QUEUE = 10;
/** After this many ticks without fresh input, a kart coasts instead of repeating. */
const IDLE_NEUTRAL_TICKS = 12;
const STRIKES_BEFORE_KICK = 300;
const CHAOS_ENABLED = process.env.CHAOS_EVENTS !== "off";
/** Tracks from gentlest to hardest, for the "harder track" rematch vote. */
const DIFFICULTY_RANK = ["Easy", "Medium", "Hard", "Extreme", "Insane"];

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
  item: number;
  charges: number;
  useHeld: boolean;
  itemSpin: boolean;
  gridPlace: number;
  /** Ticks spent tucked in behind another kart; pays out as a slipstream boost. */
  draft: number;
  /** Server time the accelerator went down during the countdown (0 = not held). */
  revAt: number;
  stats: { peak: number; driftBoosts: number; airTicks: number; hazardHits: number; itemHits: number; tricks: number; drafts: number };
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
  private readonly items = new ItemWorld(this.track);
  private readonly ctx: RaceCtx = { event: 0, from: 0, to: 0, hzOff: 0, speed: 1 };
  /** Tick at which each item box is available again. */
  private boxReady: number[] = [];
  private nextEventTick = 0;
  private lastEvent = 0;
  private voteTimer: ReturnType<typeof setTimeout> | undefined;
  /** Consecutive wins of one player over another this session, keyed "winner>loser". */
  private readonly streaks = new Map<string, number>();

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

    this.items.onFx = (fx) => this.broadcast(MSG.FX, fx);

    this.on(MSG.VOTE, (_client, player, choice) => {
      if (this.state.phase !== "results") return;
      if (choice !== "same" && choice !== "random" && choice !== "harder" && choice !== "mayhem") return;
      player.vote = choice;
      this.checkVotes();
    });

    this.on(MSG.SETTINGS, (client, _player, payload: { laps?: unknown; trackId?: unknown; chaos?: unknown; speed?: unknown }) => {
      if (!this.isHost(client) || this.state.phase !== "lobby") return;
      const laps = payload?.laps;
      if (typeof laps === "number" && Number.isInteger(laps) && laps >= MIN_LAPS && laps <= MAX_LAPS) {
        this.state.laps = laps;
      }
      const trackId = payload?.trackId;
      if (typeof trackId === "string" && Object.prototype.hasOwnProperty.call(TRACK_DEFS, trackId)) {
        this.state.trackId = trackId;
      }
      const chaos = payload?.chaos;
      if (typeof chaos === "number" && Number.isInteger(chaos) && chaos >= 0 && chaos <= 2) this.state.chaos = chaos;
      const speed = payload?.speed;
      if (typeof speed === "number" && Number.isInteger(speed) && speed >= 0 && speed < SPEED_CLASSES.length) this.state.speed = speed;
    });

    // Rocket starts: the server times the press itself, so the client's clock is never trusted.
    this.on(MSG.REV, (client, _player, on) => {
      if (this.state.phase !== "countdown") return;
      const r = this.racers.get(client.sessionId);
      if (r) r.revAt = on === true ? Date.now() : 0;
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

  private startCountdown(host: Client | null): void {
    if (RaceRoom.shuttingDown) {
      if (host) this.notify(host, "error", "The server is about to restart, so new races are paused.");
      return;
    }
    clearTimeout(this.voteTimer);
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
      p.item = 0;
      p.charges = 0;
      p.vote = "";
      p.note = "";
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
        input: { throttle: 0, steer: 0, drift: false, reset: false, use: false },
        item: 0,
        charges: 0,
        useHeld: false,
        itemSpin: false,
        gridPlace: gridPos + 1,
        draft: 0,
        revAt: 0,
        stats: { peak: 0, driftBoosts: 0, airTicks: 0, hazardHits: 0, itemHits: 0, tricks: 0, drafts: 0 },
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
    this.items.reset(this.track);
    this.boxReady = this.track.boxes.map(() => 0);
    this.ctx.event = 0;
    this.ctx.from = 0;
    this.ctx.to = 0;
    this.ctx.hzOff = 0;
    this.ctx.speed = SPEED_CLASSES[st.speed]?.k ?? 1;
    st.eventId = 0;
    st.eventFrom = 0;
    st.eventTo = 0;
    st.hzOff = 0;
    st.voteEndsAt = 0;
    st.awards.clear();
    this.scheduleEvent(8);
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
    st.eventId = 0;
    this.giveAwards();

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
        // Rocket start for anyone who hit the accelerator just before the lights went green.
        for (const r of this.order) {
          const held = r.revAt > 0 ? st.raceStartAt - r.revAt : -1;
          const level = held >= ROCKET.late && held <= ROCKET.perfect ? 2 : held > ROCKET.perfect && held <= ROCKET.good ? 1 : 0;
          if (level > 0) {
            r.kart.boost = ROCKET.boost[level];
            this.broadcast(MSG.FX, { kind: "rocket", slot: r.slot, item: level, x: r.kart.x, y: r.kart.y, z: r.kart.z });
          }
        }
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

    // Kart-to-kart collisions (finished and phantom karts pass through).
    for (let i = 0; i < order.length; i++) {
      const a = order[i];
      if (a.finished || a.kart.phantom > 0) continue;
      for (let j = i + 1; j < order.length; j++) {
        const b = order[j];
        if (b.finished || b.kart.phantom > 0) continue;
        if (!collideKarts(a.kart, b.kart)) continue;
        // A giant kart flattens whatever it touches.
        const ga = a.kart.sizeT > 0 && a.kart.sizeK > 0;
        const gb = b.kart.sizeT > 0 && b.kart.sizeK > 0;
        if (ga && !gb) this.items.hit(b, a);
        else if (gb && !ga) this.items.hit(a, b);
      }
    }

    // Slipstream: sit in the air pocket behind another kart for a moment and get slung past it.
    const draftSpeed = KART.maxSpeed * this.ctx.speed * 0.55;
    for (const a of order) {
      const ka = a.kart;
      let tucked = false;
      if (!a.finished && !ka.air && !ka.water && ka.speed > draftSpeed && ka.spin <= 0) {
        const fx = Math.sin(ka.vAngle);
        const fz = Math.cos(ka.vAngle);
        for (const b of order) {
          if (b === a || b.finished) continue;
          const kb = b.kart;
          const dx = kb.x - ka.x;
          const dz = kb.z - ka.z;
          const along = dx * fx + dz * fz;
          if (along < DRAFT.minDist || along > DRAFT.maxDist || Math.abs(kb.y - ka.y) > 3 || kb.speed < draftSpeed * 0.6) continue;
          if (Math.abs(dx * fz - dz * fx) < DRAFT.halfWidth + along * 0.05) {
            tucked = true;
            break;
          }
        }
      }
      if (tucked) {
        if (++a.draft >= DRAFT.chargeTicks) {
          a.draft = 0;
          if (ka.emp <= 0) ka.boost = Math.max(ka.boost, DRAFT.boost);
          a.stats.drafts++;
          this.broadcast(MSG.FX, { kind: "draft", slot: a.slot, x: ka.x, y: ka.y, z: ka.z });
        }
      } else if (a.draft > 0) a.draft = Math.max(0, a.draft - 3);
    }

    // Power-ups: pick up from boxes, use on a fresh press of the item button.
    const live = order.filter((r) => !r.finished).length;
    for (const r of order) {
      if (r.finished) continue;
      const k = r.kart;
      if (r.item === 0) {
        for (let b = 0; b < this.track.boxes.length; b++) {
          if (this.boxReady[b] > this.raceTick) continue;
          const box = this.track.boxes[b];
          const dx = k.x - box.x;
          const dz = k.z - box.z;
          if (dx * dx + dz * dz < 6.8 && Math.abs(k.y - box.y) < 3.5) {
            const p = this.state.players.get(r.id);
            r.item = rollItem(p ? p.place : 1, live);
            r.charges = r.item === 7 ? 3 : 1;
            this.boxReady[b] = this.raceTick + (this.ctx.event === EVENT.DOUBLE && this.raceTick >= this.ctx.from ? 20 : 5 * TICK_RATE);
            this.broadcast(MSG.FX, { kind: "pickup", slot: r.slot, x: box.x, y: box.y, z: box.z });
            break;
          }
        }
      }
      if (r.input.use && !r.useHeld && r.item !== 0) this.items.use(r, order);
      r.useHeld = r.input.use;
      const p = this.state.players.get(r.id);
      if (p && (p.item !== r.item || p.charges !== r.charges)) {
        p.item = r.item;
        p.charges = r.charges;
      }
    }
    this.items.step(order);
    this.stepEvents();

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
    const k = r.kart;
    const before = k.pos;
    const wasSpin = k.spin > 0;
    const wasDrift = k.driftDir !== 0;
    const boostBefore = k.boost;
    const trickBefore = k.trick !== 0 && k.air;
    stepKart(k, r.input, track, this.ctx);
    r.input.reset = false;
    r.simTicks++;
    r.travel += wrapDelta(k.pos, before, track.n);
    if (r.finished) return;

    // Stats behind the end-of-race awards.
    if (k.speed > r.stats.peak) r.stats.peak = k.speed;
    if (k.air) r.stats.airTicks++;
    if (wasDrift && k.driftDir === 0 && k.boost > boostBefore) r.stats.driftBoosts++;
    if (trickBefore && !k.air && k.boost > boostBefore) r.stats.tricks++;
    if (!wasSpin && k.spin > 0) {
      if (r.itemSpin) r.itemSpin = false;
      else {
        r.stats.hazardHits++;
        this.broadcast(MSG.FX, { kind: "hit", slot: r.slot, x: k.x, y: k.y, z: k.z });
      }
    }

    // Checkpoints must be crossed in order. `travel` is continuous (a kart's
    // track position can only move to neighbouring samples), so the only way to
    // reach the next threshold is to drive there.
    const cps = track.checkpoints;
    const cpN = cps.length;
    for (;;) {
      const threshold = Math.floor(r.cpCount / cpN) * track.n + cps[r.cpCount % cpN];
      if (r.travel < threshold) break;
      r.cpCount++;
      const crossedLine = (r.cpCount - 1) % cpN === 0;
      if (!crossedLine || r.cpCount === 1) continue;

      const player = this.state.players.get(r.id);
      const lapMs = Math.round(raceMs - r.lapStartMs);
      r.lapStartMs = raceMs;
      const lapsDone = (r.cpCount - 1) / cpN;
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
      if (k.air) flags |= FLAG.AIRBORNE;
      let fx = 0;
      if (k.spin > 0) fx |= FX.SPIN;
      if (k.shield > 0) fx |= FX.SHIELD;
      if (k.phantom > 0) fx |= FX.PHANTOM;
      if (k.sizeT > 0) fx |= k.sizeK > 0 ? FX.GIANT : FX.MINI;
      if (k.slow > 0 || k.emp > 0) fx |= FX.SLOW;
      if (k.water) fx |= FX.WATER;
      if (k.reverse > 0) fx |= FX.REVERSED;
      if (r.draft > 6) fx |= FX.DRAFT;
      if (k.trick !== 0) fx |= FX.TRICK;
      flat.push(r.slot, k.x, k.z, k.heading, k.speed, flags, k.y, fx);
    }
    const taken: number[] = [];
    for (let b = 0; b < this.boxReady.length; b++) if (this.boxReady[b] > this.raceTick) taken.push(b);
    this.broadcast(MSG.SNAPSHOT, [Date.now(), this.raceTick, flat, this.items.pack(), taken]);
    for (const client of this.clients) {
      const r = this.racers.get(client.sessionId);
      if (r) client.send(MSG.SELF, [r.lastSeq, ...packKartState(r.kart)]);
    }
  }

  // ------------------------------------------------------------ chaos events

  private scheduleEvent(extraSeconds = 0): void {
    const pace = CHAOS_PACE[this.state.chaos] ?? CHAOS_PACE[0];
    this.nextEventTick = this.raceTick + Math.round((extraSeconds + pace.min + Math.random() * (pace.max - pace.min)) * TICK_RATE);
  }

  private stepEvents(): void {
    const st = this.state;
    const ctx = this.ctx;
    if (ctx.event !== 0) {
      const active = this.raceTick >= ctx.from && this.raceTick < ctx.to;
      if (active && ctx.event === EVENT.METEORS && this.raceTick % 11 === 0) this.items.strike(this.order);
      if (active && ctx.event === EVENT.STORM && this.raceTick % 34 === 0) this.items.strike(this.order);
      if (this.raceTick >= ctx.to) {
        // Hazards keep the time they gained, so nothing jumps when a frenzy ends.
        if (ctx.event === EVENT.FRENZY) ctx.hzOff += (ctx.to - ctx.from) * DT * 0.7;
        this.lastEvent = ctx.event;
        ctx.event = 0;
        st.eventId = 0;
        st.hzOff = ctx.hzOff;
        this.scheduleEvent();
      }
      return;
    }
    if (!CHAOS_ENABLED || this.raceTick < this.nextEventTick) return;
    const pace = CHAOS_PACE[st.chaos] ?? CHAOS_PACE[0];
    if (Math.random() > pace.chance) {
      this.scheduleEvent();
      return;
    }
    // Announced four seconds before it starts, so everyone has time to react.
    ctx.event = pickEvent(this.lastEvent);
    ctx.from = this.raceTick + 4 * TICK_RATE;
    ctx.to = ctx.from + pace.seconds * TICK_RATE;
    st.eventId = ctx.event;
    st.eventFrom = ctx.from;
    st.eventTo = ctx.to;
  }

  // ------------------------------------------------- awards, points, rematch

  private giveAwards(): void {
    const st = this.state;
    st.awards.clear();
    const rows = this.order
      .map((r) => ({ r, p: st.players.get(r.id) }))
      .filter((x): x is { r: Racer; p: PlayerState } => !!x.p)
      .sort((a, b) => a.p.place - b.p.place);
    if (rows.length === 0) return;
    const add = (title: string, name: string, detail: string) => {
      const a = new AwardState();
      a.title = title;
      a.name = name;
      a.detail = detail;
      st.awards.push(a);
    };
    const best = (score: (x: (typeof rows)[number]) => number, min: number) => {
      let top: (typeof rows)[number] | null = null;
      for (const x of rows) if (score(x) >= min && (!top || score(x) > score(top))) top = x;
      return top;
    };
    const speed = best((x) => x.r.stats.peak, 1);
    if (speed) add("Speed Demon", speed.p.name, `${Math.round(speed.r.stats.peak * 3.6)} km/h top speed`);
    const drift = best((x) => x.r.stats.driftBoosts, 1);
    if (drift) add("Drift King", drift.p.name, `${drift.r.stats.driftBoosts} drift boosts`);
    const comeback = best((x) => x.r.gridPlace - x.p.place, 1);
    if (comeback) add("Comeback Champion", comeback.p.name, `gained ${comeback.r.gridPlace - comeback.p.place} places`);
    const agent = best((x) => x.r.stats.itemHits, 1);
    if (agent) add("Chaos Agent", agent.p.name, `${agent.r.stats.itemHits} item hits`);
    const tricks = best((x) => x.r.stats.tricks, 2);
    if (tricks) add("Show-Off", tricks.p.name, `${tricks.r.stats.tricks} jump tricks landed`);
    const drafts = best((x) => x.r.stats.drafts, 1);
    if (drafts) add("Slipstreamer", drafts.p.name, `${drafts.r.stats.drafts} slipstream boosts`);
    const air = best((x) => x.r.stats.airTicks, 20);
    if (air) add("Air Time Legend", air.p.name, `${(air.r.stats.airTicks * DT).toFixed(1)} s in the air`);
    const unlucky = best((x) => x.r.stats.hazardHits, 1);
    if (unlucky) add("Unlucky Racer", unlucky.p.name, `hit ${unlucky.r.stats.hazardHits} obstacles`);
    const finished = rows.filter((x) => x.p.finished);
    if (finished.length >= 2 && finished[1].p.finishMs - finished[0].p.finishMs < 500) {
      add("Photo Finish", `${finished[0].p.name} & ${finished[1].p.name}`, `${((finished[1].p.finishMs - finished[0].p.finishMs) / 1000).toFixed(3)} s apart`);
    }
    const lap = rows.filter((x) => x.p.bestLapMs > 0).sort((a, b) => a.p.bestLapMs - b.p.bestLapMs)[0];

    // Session points, wins, and head-to-head streaks.
    for (let i = 0; i < rows.length; i++) {
      const p = rows[i].p;
      p.points += POINTS[p.place - 1] ?? 0;
      if (p.place === 1 && p.finished) p.wins++;
      for (let j = i + 1; j < rows.length; j++) {
        const loser = rows[j].p;
        this.streaks.set(`${p.name}>${loser.name}`, (this.streaks.get(`${p.name}>${loser.name}`) ?? 0) + 1);
        this.streaks.set(`${loser.name}>${p.name}`, 0);
      }
    }
    for (const { p } of rows) {
      let streak = 0;
      let rival = "";
      for (const o of rows) {
        const n = this.streaks.get(`${p.name}>${o.p.name}`) ?? 0;
        if (o.p !== p && n > streak) {
          streak = n;
          rival = o.p.name;
        }
      }
      if (streak >= 2) p.note = `You've beaten ${rival} ${streak} races in a row!`;
      else if (comeback && comeback.p === p) p.note = "Biggest comeback of the race!";
      else if (lap && lap.p === p) p.note = "Fastest lap!";
      else p.note = "";
    }
  }

  /** Once everyone connected has voted, the most popular choice starts the next race. */
  private checkVotes(): void {
    const st = this.state;
    const voters = [...st.players.values()].filter((p) => p.connected);
    if (voters.length === 0 || voters.some((p) => p.vote === "")) return;
    if (st.voteEndsAt > 0) return;
    st.voteEndsAt = Date.now() + 3000;
    clearTimeout(this.voteTimer);
    this.voteTimer = setTimeout(() => {
      if (this.state.phase !== "results") return;
      const tally: Record<string, number> = { same: 0, random: 0, harder: 0, mayhem: 0 };
      for (const p of this.state.players.values()) if (p.connected && p.vote in tally) tally[p.vote]++;
      const choice = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
      const ids = Object.keys(TRACK_DEFS);
      if (choice === "random") {
        const others = ids.filter((id) => id !== st.trackId);
        st.trackId = others[Math.floor(Math.random() * others.length)] ?? st.trackId;
      } else if (choice === "harder") {
        const rank = (id: string) => DIFFICULTY_RANK.indexOf(TRACK_DEFS[id].difficulty ?? "Medium");
        const harder = ids.filter((id) => rank(id) > rank(st.trackId)).sort((a, b) => rank(a) - rank(b));
        const same = ids.filter((id) => id !== st.trackId && rank(id) === rank(st.trackId));
        st.trackId = harder[0] ?? same[Math.floor(Math.random() * same.length)] ?? st.trackId;
      } else if (choice === "mayhem") {
        st.chaos = 2;
      }
      this.startCountdown(null);
    }, 3000);
  }
}
