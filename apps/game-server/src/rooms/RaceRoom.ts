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
  MAX_CPUS,
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
  INPUT_MASK,
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
  AVATARS,
  TRIAL_LAPS,
  VEHICLES,
  weekIndex,
  weeklyChallenge,
  type CreateOptions,
  type TrialResult,
} from "@office-kart/shared";
import { CHAOS_PACE, ItemWorld, pickEvent, rollItem } from "./items";
import { CPU_NAMES, cpuDrive, newMind, type CpuMind } from "./cpu";
import { activeRoomCount, releaseCode, reserveCode } from "../util/codes";
import { errorFields, log } from "../util/log";
import { recordTick } from "../util/metrics";
import { TokenBucket } from "../util/rateLimit";
import { submitRun } from "../scores";
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
  /** Power-ups held in reserve, used in the order they were collected. */
  bag: number[];
  useHeld: boolean;
  itemSpin: boolean;
  gridPlace: number;
  /** Ticks spent tucked in behind another kart; pays out as a slipstream boost. */
  draft: number;
  /** Server time the accelerator went down during the countdown (0 = not held). */
  revAt: number;
  /** Time trials: the run, sampled every three ticks, for the leaderboard ghost. */
  ghost: number[];
  stats: { peak: number; driftBoosts: number; airTicks: number; hazardHits: number; itemHits: number; tricks: number; drafts: number };
  /** Set for a computer-controlled car: what decides its inputs. */
  cpu: CpuMind | null;
}

interface ClientMeta {
  inputBucket: TokenBucket;
  msgBucket: TokenBucket;
  strikes: number;
  kicked: boolean;
  /** Browser-kept player id, used for leaderboard entries. */
  pid: string;
}

/** A whole number in [0, count), or the fallback. */
function pickIndex(value: unknown, count: number, fallback = 0): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < count ? value : fallback;
}

const q16 = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v)));

function newMeta(): ClientMeta {
  return { inputBucket: new TokenBucket(90, 60), msgBucket: new TokenBucket(30, 10), strikes: 0, kicked: false, pid: "" };
}

/** How many power-ups a racer can carry in reserve behind the one in hand. */
const BAG_SIZE = 2;
/** Vehicles a computer-controlled car may be given: all the cars, not the motorbike. */
const CPU_VEHICLES = VEHICLES.map((_, i) => i).filter((i) => i !== 1);

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

  onCreate(options?: CreateOptions): void {
    if (RaceRoom.shuttingDown) throw new ServerError(503, "The server is restarting. Try again in a moment.");
    if (activeRoomCount() >= MAX_ROOMS) throw new ServerError(503, "The server is full. Try again later.");

    const code = reserveCode();
    this.roomId = code;
    this.state.code = code;
    void this.setPrivate(true);
    if (options?.trial === true || options?.weekly === true) {
      // A time trial is one driver against the clock.
      const st = this.state;
      st.trial = true;
      st.laps = TRIAL_LAPS;
      st.chaos = 0;
      this.maxClients = 1;
      if (options.weekly === true) {
        const c = weeklyChallenge(Date.now());
        st.weekly = true;
        st.trackId = c.trackId;
        st.speed = c.speed;
      } else {
        if (typeof options.trackId === "string" && TRACK_DEFS[options.trackId]) st.trackId = options.trackId;
        if (typeof options.speed === "number" && Number.isInteger(options.speed) && options.speed >= 0 && options.speed < SPEED_CLASSES.length) st.speed = options.speed;
      }
    }

    // "Race the computer" from the front page: the lobby opens with CPU cars already asked for.
    if (!this.state.trial && typeof options?.cpus === "number" && Number.isInteger(options.cpus) && options.cpus >= 0 && options.cpus <= MAX_CPUS) this.state.cpus = options.cpus;

    this.onMessage(MSG.INPUT, (client, payload) => this.onInput(client, payload));

    this.onMessage(MSG.PING, (client, t) => {
      if (!this.allow(client)) return;
      if (typeof t === "number" && Number.isFinite(t)) client.send(MSG.PONG, [t, Date.now()]);
    });

    this.on(MSG.READY, (_client, player, ready) => {
      if (this.state.phase !== "lobby") return;
      player.ready = ready === true;
    });

    this.on(MSG.KART, (client, player, payload: { color?: unknown; vehicle?: unknown; avatar?: unknown }) => {
      if (this.state.phase !== "lobby" && this.state.phase !== "results") return;
      if (payload?.vehicle !== undefined) player.vehicle = pickIndex(payload.vehicle, VEHICLES.length, player.vehicle);
      if (payload?.avatar !== undefined) player.avatar = pickIndex(payload.avatar, AVATARS.length, player.avatar);
      const color = payload?.color;
      if (color === undefined) return;
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

    this.on(MSG.SETTINGS, (client, _player, payload: { laps?: unknown; trackId?: unknown; chaos?: unknown; speed?: unknown; cpus?: unknown; cpuLevel?: unknown }) => {
      if (!this.isHost(client) || this.state.phase !== "lobby") return;
      // The weekly challenge is the same for everyone; a time trial always runs its own laps with no chaos.
      if (this.state.weekly) return;
      const trial = this.state.trial;
      const laps = payload?.laps;
      if (!trial && typeof laps === "number" && Number.isInteger(laps) && laps >= MIN_LAPS && laps <= MAX_LAPS) {
        this.state.laps = laps;
      }
      const trackId = payload?.trackId;
      if (typeof trackId === "string" && Object.prototype.hasOwnProperty.call(TRACK_DEFS, trackId)) {
        this.state.trackId = trackId;
      }
      const chaos = payload?.chaos;
      if (!trial && typeof chaos === "number" && Number.isInteger(chaos) && chaos >= 0 && chaos <= 2) this.state.chaos = chaos;
      const speed = payload?.speed;
      if (typeof speed === "number" && Number.isInteger(speed) && speed >= 0 && speed < SPEED_CLASSES.length) this.state.speed = speed;
      // Computer-controlled cars: only ever added because the host asked for them, never in a time trial.
      const cpus = payload?.cpus;
      if (!trial && typeof cpus === "number" && Number.isInteger(cpus) && cpus >= 0 && cpus <= MAX_CPUS) {
        this.state.cpus = cpus;
        this.syncCpus(0);
      }
      const cpuLevel = payload?.cpuLevel;
      if (!trial && typeof cpuLevel === "number" && Number.isInteger(cpuLevel) && cpuLevel >= 0 && cpuLevel <= 2) this.state.cpuLevel = cpuLevel;
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

    // Time trial: throw the run away and line up on the grid again.
    this.on(MSG.RESTART, (client) => {
      if (!this.state.trial || !this.isHost(client) || this.state.phase === "lobby") return;
      if (this.state.phase === "countdown" && Date.now() < this.state.raceStartAt - 1500) return;
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

    // A person always gets a seat ahead of a computer-controlled car.
    this.syncCpus(1, false);
    const meta = newMeta();
    if (typeof options?.pid === "string" && /^[a-z0-9-]{8,40}$/.test(options.pid)) meta.pid = options.pid;
    client.userData = meta;
    const player = new PlayerState();
    player.id = client.sessionId;
    player.name = this.uniqueName(name);
    player.slot = this.freeSlot();
    player.color = this.pickColor(options?.color);
    player.vehicle = pickIndex(options?.vehicle, VEHICLES.length);
    player.avatar = pickIndex(options?.avatar, AVATARS.length);
    this.state.players.set(client.sessionId, player);
    if (!this.state.players.has(this.state.hostId)) this.state.hostId = client.sessionId;
    // Any CPU cars asked for take the seats, slots and colours that are left once the person is in.
    this.syncCpus(0);
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

  /**
   * Bring the number of computer-controlled cars in line with the host's setting, leaving `spare`
   * seats free for people. They are added and removed only between races.
   */
  private syncCpus(spare: number, grow = true): void {
    const st = this.state;
    if (st.phase === "countdown" || st.phase === "racing") return;
    const cpus = [...st.players.values()].filter((p) => p.cpu);
    const people = st.players.size - cpus.length;
    const want = st.trial ? 0 : Math.max(0, Math.min(st.cpus, MAX_PLAYERS - people - spare));
    for (let i = cpus.length - 1; i >= want; i--) {
      st.players.delete(cpus[i].id);
      this.racers.delete(cpus[i].id);
    }
    for (let i = cpus.length; grow && i < want; i++) {
      const p = new PlayerState();
      let n = 1;
      while (st.players.has(`cpu-${n}`)) n++;
      p.id = `cpu-${n}`;
      p.cpu = true;
      p.name = this.uniqueName(CPU_NAMES[(n - 1) % CPU_NAMES.length]);
      p.slot = this.freeSlot();
      p.color = this.pickColor(undefined);
      // Cars only: every one of them has a cabin and four wheels.
      p.vehicle = CPU_VEHICLES[Math.floor(Math.random() * CPU_VEHICLES.length)];
      p.avatar = Math.floor(Math.random() * AVATARS.length);
      p.ready = true;
      st.players.set(p.id, p);
    }
    if (want !== cpus.length) this.order = [...this.racers.values()];
  }

  private removePlayer(id: string): void {
    this.state.players.delete(id);
    if (this.racers.delete(id)) this.order = [...this.racers.values()];
    if (this.state.hostId === id) {
      let next: PlayerState | undefined;
      for (const p of this.state.players.values()) {
        if (p.cpu) continue;
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
      p.item2 = 0;
      p.item3 = 0;
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
      kart.veh = p.vehicle;
      this.racers.set(p.id, {
        id: p.id,
        slot: p.slot,
        kart,
        input: { throttle: 0, steer: 0, drift: false, reset: false, use: false },
        item: 0,
        charges: 0,
        bag: [],
        useHeld: false,
        itemSpin: false,
        gridPlace: gridPos + 1,
        draft: 0,
        revAt: 0,
        ghost: [],
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
        cpu: p.cpu ? newMind(st.cpuLevel, p.slot) : null,
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
    // No power-ups in a time trial: every box counts as already taken, for the whole run.
    this.boxReady = this.track.boxes.map(() => (st.trial ? Number.MAX_SAFE_INTEGER : 0));
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
    // Computer-controlled cars time their launch like anyone else: the better ones more often get it right.
    for (const r of this.order) {
      if (!r.cpu) continue;
      const roll = Math.random() + (st.cpuLevel - 1) * 0.2;
      const held = roll > 0.85 ? (ROCKET.late + ROCKET.perfect) / 2 : roll > 0.45 ? (ROCKET.perfect + ROCKET.good) / 2 : -1;
      r.revAt = held > 0 ? st.raceStartAt - held : 0;
    }
    st.phase = "countdown";
    void this.lock();
    this.nextCountdownSnapshot = Date.now() + 250;
    this.sendSnapshot();
    log.info("race_countdown", { room: this.roomId, race: st.raceNumber, racers: this.racers.size, laps: st.laps, track: st.trackId });
  }

  private toLobby(): void {
    for (const p of this.state.players.values()) {
      p.racing = false;
      p.ready = p.cpu;
    }
    this.racers.clear();
    this.order = [];
    this.state.phase = "lobby";
    this.syncCpus(0);
  }

  private endRace(): void {
    const st = this.state;
    this.updatePlaces();
    st.phase = "results";
    for (const p of st.players.values()) p.ready = p.cpu;
    void this.unlock();
    st.eventId = 0;
    if (st.trial) this.scoreTrial();
    else this.giveAwards();

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
    if (typeof bits !== "number" || !Number.isInteger(bits) || bits < 0 || (bits & ~INPUT_MASK) !== 0) return;
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
      if (r.cpu) {
        // A computer-controlled car: its inputs are decided here, then it runs through the same physics.
        cpuDrive(r.cpu, r.kart, this.track, this.ctx.speed, r.input, this.raceTick, r.item, this.cpuBias(r), this.cpuDodge(r));
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
      if (r.item === 0 || r.bag.length < BAG_SIZE) {
        for (let b = 0; b < this.track.boxes.length; b++) {
          if (this.boxReady[b] > this.raceTick) continue;
          const box = this.track.boxes[b];
          const dx = k.x - box.x;
          const dz = k.z - box.z;
          if (dx * dx + dz * dz < 6.8 && Math.abs(k.y - box.y) < 3.5) {
            const p = this.state.players.get(r.id);
            const rolled = rollItem(p ? p.place : 1, live);
            if (r.item === 0) {
              r.item = rolled;
              r.charges = rolled === 7 ? 3 : 1;
            } else r.bag.push(rolled);
            this.boxReady[b] = this.raceTick + (this.ctx.event === EVENT.DOUBLE && this.raceTick >= this.ctx.from ? 20 : 5 * TICK_RATE);
            this.broadcast(MSG.FX, { kind: "pickup", slot: r.slot, x: box.x, y: box.y, z: box.z });
            break;
          }
        }
      }
      if (r.input.use && !r.useHeld && r.item !== 0) this.items.use(r, order);
      r.useHeld = r.input.use;
      // The next power-up in reserve moves up as soon as the hand is empty.
      if (r.item === 0 && r.bag.length > 0) {
        r.item = r.bag.shift()!;
        r.charges = r.item === 7 ? 3 : 1;
      }
      const p = this.state.players.get(r.id);
      if (p && (p.item !== r.item || p.charges !== r.charges || p.item2 !== (r.bag[0] ?? 0) || p.item3 !== (r.bag[1] ?? 0))) {
        p.item = r.item;
        p.charges = r.charges;
        p.item2 = r.bag[0] ?? 0;
        p.item3 = r.bag[1] ?? 0;
      }
    }
    this.items.step(order);
    this.stepEvents();

    if (this.raceTick % 3 === 0) this.updatePlaces();
    if (this.raceTick % SNAPSHOT_EVERY === 0) this.sendSnapshot();

    // End conditions.
    let racing = 0;
    let people = 0;
    for (const r of order) {
      if (r.finished) continue;
      racing++;
      if (!r.cpu) people++;
    }
    // Once every person is home there is no need to wait long for the computer-controlled cars.
    if (people === 0 && racing > 0 && order.some((r) => !r.cpu) && (this.finishDeadlineMs === 0 || this.finishDeadlineMs > raceMs + 4000)) this.finishDeadlineMs = raceMs + 4000;
    if (racing === 0 || (this.finishDeadlineMs > 0 && raceMs >= this.finishDeadlineMs) || raceMs >= MAX_RACE_MS) {
      this.sendSnapshot();
      this.endRace();
    }
  }

  /**
   * Keeps computer-controlled cars in the race with the people: one that has dropped well behind
   * every person pushes a little harder, one that is clear of them all eases off a little.
   */
  private cpuBias(r: Racer): number {
    let first = -Infinity;
    let last = Infinity;
    for (const o of this.order) {
      if (o.cpu || o.finished) continue;
      first = Math.max(first, o.travel);
      last = Math.min(last, o.travel);
    }
    if (first === -Infinity) return 0;
    const ahead = (r.travel - first) * this.track.spacing;
    const behind = (last - r.travel) * this.track.spacing;
    if (ahead > 30) return -Math.min(0.09, (ahead - 30) * 0.002);
    if (behind > 40) return Math.min(0.05, (behind - 40) * 0.001);
    return 0;
  }

  /**
   * A slower car close ahead on the same line: which way a computer-controlled car should pull out
   * to go round it rather than push it along. Metres to the right; 0 when the road ahead is clear.
   */
  private cpuDodge(r: Racer): number {
    const k = r.kart;
    const fx = Math.sin(k.heading);
    const fz = Math.cos(k.heading);
    let nearest = 12;
    let dodge = 0;
    for (const o of this.order) {
      if (o === r || o.finished || o.kart.phantom > 0) continue;
      const dx = o.kart.x - k.x;
      const dz = o.kart.z - k.z;
      const along = dx * fx + dz * fz;
      if (along <= 0.5 || along >= nearest || Math.abs(o.kart.y - k.y) > 3) continue;
      // Which side of this car it is on, measured along the road's own "right" direction.
      const side = dx * this.track.nx[k.idx] + dz * this.track.nz[k.idx];
      if (Math.abs(side) > 2.1 || o.kart.speed > k.speed + 1.5) continue;
      nearest = along;
      dodge = side > 0 ? -2.6 : 2.6;
    }
    return dodge;
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
    if (this.state.trial && k.tick % 3 === 0 && r.ghost.length < 80_000) {
      r.ghost.push(q16(k.x * 20), q16(k.y * 20), q16(k.z * 20), q16(Math.atan2(Math.sin(k.heading), Math.cos(k.heading)) * 10000));
    }
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

  /** Put a finished time-trial run on the leaderboards and tell the driver where it stands. */
  private scoreTrial(): void {
    const st = this.state;
    for (const r of this.order) {
      const p = st.players.get(r.id);
      const client = this.clients.find((c) => c.sessionId === r.id);
      if (!p || !client || !p.finished || p.finishMs <= 0) continue;
      const pid = (client.userData as ClientMeta | undefined)?.pid ?? "";
      const result: TrialResult = { raceMs: p.finishMs, lapMs: p.bestLapMs, rank: 0, weekRank: 0, previousMs: 0, improved: false, recordMs: 0, recordName: "", saved: false };
      if (!pid) {
        client.send(MSG.TRIAL, result);
        continue;
      }
      const ghost = Buffer.from(Int16Array.from(r.ghost).buffer).toString("base64");
      void submitRun({ trackId: st.trackId, speed: st.speed, week: weekIndex(Date.now()), pid, name: p.name, color: p.color, vehicle: p.vehicle, avatar: p.avatar, raceMs: p.finishMs, lapMs: p.bestLapMs, ghost }).then((standing) => {
        client.send(MSG.TRIAL, { ...result, ...standing, improved: standing.saved && (standing.previousMs === 0 || p.finishMs < standing.previousMs) });
        log.info("trial_scored", { room: this.roomId, track: st.trackId, speed: st.speed, raceMs: p.finishMs, lapMs: p.bestLapMs, rank: standing.rank, saved: standing.saved });
      });
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
    if (!CHAOS_ENABLED || st.trial || this.raceTick < this.nextEventTick) return;
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
    const voters = [...st.players.values()].filter((p) => p.connected && !p.cpu);
    if (voters.length === 0 || voters.some((p) => p.vote === "")) return;
    if (st.voteEndsAt > 0) return;
    st.voteEndsAt = Date.now() + 3000;
    clearTimeout(this.voteTimer);
    this.voteTimer = setTimeout(() => {
      if (this.state.phase !== "results") return;
      const tally: Record<string, number> = { same: 0, random: 0, harder: 0, mayhem: 0 };
      for (const p of this.state.players.values()) if (p.connected && !p.cpu && p.vote in tally) tally[p.vote]++;
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
