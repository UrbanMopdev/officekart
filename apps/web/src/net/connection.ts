/**
 * Everything that talks to the game server: joining rooms, clock sync,
 * sending inputs, prediction/reconciliation of the local kart and
 * interpolation of everyone else's.
 */
import { Client, type Room } from "colyseus.js";
import {
  DEFAULT_TRACK_ID,
  DT,
  SPEED_CLASSES,
  MSG,
  TICK_MS,
  hazardTime,
  type FxMessage,
  Predictor,
  ROOM_NAME,
  SNAPSHOT_STRIDE,
  angleDiff,
  getTrack,
  type Notice,
  type Phase,
  type CreateOptions,
  type JoinOptions,
  type PlayerView,
  type RoomView,
  type TrialResult,
  VEHICLES,
  FX,
  type CarBody,
  carryForward,
} from "@office-kart/shared";

/** ?veh=N starts the preview line-up at vehicle N. */
const PREVIEW_VEH = Number(new URLSearchParams(typeof location === "undefined" ? "" : location.search).get("veh")) || 0;
import { revHeld, sampleInput, setInputEnabled } from "../game/input";
import { useStore } from "../store";

/** Remote karts are drawn this far in the past so there are always two snapshots to blend. */
const INTERP_MS = 100;
/** The furthest another car is carried forward to meet our own car's clock. Beyond this a connection is too slow to hide. */
const MAX_LEAD_S = 0.3;
const MAX_EXTRAPOLATE_S = 0.15;
const SESSION_KEY = "office-kart:session";
const CLOSE_CONSENTED = 4000;
const CLOSE_KICKED = 4003;

function resolveServerUrl(): string {
  const raw = (import.meta.env.VITE_GAME_SERVER_URL as string | undefined)?.trim();
  if (raw) {
    let url = raw.replace(/\/+$/, "");
    if (/^https?:\/\//i.test(url)) url = url.replace(/^http/i, "ws");
    else if (!/^wss?:\/\//i.test(url)) url = `wss://${url}`;
    return url;
  }
  // Local development: game server on the same machine.
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:2567`;
}

export const SERVER_URL = resolveServerUrl();

interface Snap {
  t: number;
  flat: number[];
}

export interface KartSample {
  x: number;
  /** Height above the track's zero level. */
  y: number;
  z: number;
  heading: number;
  speed: number;
  flags: number;
  /** Status-effect bits (see FX). */
  fx: number;
}

function localNow(): number {
  return performance.timeOrigin + performance.now();
}

function friendlyError(err: unknown): string {
  const e = err as { code?: number; message?: string };
  const msg = e?.message ?? "";
  if (e?.code === 4212 || /not found/i.test(msg)) return "No lobby with that code. Check the code and try again.";
  if (/locked/i.test(msg)) return "That lobby is full or mid-race. Try again when the race finishes.";
  if (e?.code === 429) return "Too many attempts. Wait a minute and try again.";
  if (e?.code && e.code >= 400 && e.code < 600 && msg) return msg;
  if (typeof ProgressEvent !== "undefined" && err instanceof ProgressEvent) return "Can't reach the game server. Check your connection and try again.";
  if (/fetch|network|offline|ECONN|failed/i.test(msg) || !msg) return "Can't reach the game server. Check your connection and try again.";
  return msg;
}

function toView(state: any): RoomView {
  const players: PlayerView[] = [];
  state.players?.forEach((p: any) => {
    players.push({
      id: p.id,
      name: p.name,
      color: p.color,
      slot: p.slot,
      ready: p.ready,
      connected: p.connected,
      racing: p.racing,
      lap: p.lap,
      place: p.place,
      finished: p.finished,
      finishMs: p.finishMs,
      bestLapMs: p.bestLapMs,
      item: p.item ?? 0,
      item2: p.item2 ?? 0,
      item3: p.item3 ?? 0,
      cpu: p.cpu === true,
      vehicle: p.vehicle ?? 0,
      avatar: p.avatar ?? 0,
      charges: p.charges ?? 0,
      wins: p.wins ?? 0,
      points: p.points ?? 0,
      vote: p.vote ?? "",
      note: p.note ?? "",
    });
  });
  players.sort((a, b) => a.slot - b.slot);
  const awards: RoomView["awards"] = [];
  state.awards?.forEach((a: any) => awards.push({ title: a.title, name: a.name, detail: a.detail }));
  return {
    code: state.code,
    phase: state.phase as Phase,
    hostId: state.hostId,
    trackId: state.trackId,
    laps: state.laps,
    raceStartAt: state.raceStartAt,
    raceNumber: state.raceNumber,
    players,
    chaos: state.chaos ?? 0,
    cpus: state.cpus ?? 0,
    cpuLevel: state.cpuLevel ?? 1,
    speed: state.speed ?? 0,
    trial: state.trial === true,
    weekly: state.weekly === true,
    eventId: state.eventId ?? 0,
    eventFrom: state.eventFrom ?? 0,
    eventTo: state.eventTo ?? 0,
    hzOff: state.hzOff ?? 0,
    voteEndsAt: state.voteEndsAt ?? 0,
    awards: awards,
  };
}

class Net {
  private client = new Client(SERVER_URL);
  private room: Room | null = null;
  private snaps: Snap[] = [];
  private pingSamples: { rtt: number; offset: number }[] = [];
  private clockOffset = 0;
  private lastHeardAt = 0;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private raceNumber = -1;
  private acc = 0;
  private leaving = false;
  private reconnecting = false;
  private previewStart = 0;
  /** How far the current frame is between two simulation ticks, 0..1. */
  private alpha = 0;
  /** Things on the track from the latest snapshot: [id, type, x, y, z, aux] each. */
  entities: number[] = [];
  /** Item boxes that are currently empty. */
  taken = new Set<number>();
  /** Subscribers to one-off happenings (hits, pickups, item use) for sound and effects. */
  readonly fxListeners = new Set<(fx: FxMessage) => void>();
  private rev = false;

  readonly predictor = new Predictor(getTrack(DEFAULT_TRACK_ID));

  /** Offline track preview (?preview=track-id): supplies kart positions without a server. */
  private preview: ((slot: number, out: KartSample) => boolean) | null = null;

  startPreview(trackId: string, at: number): void {
    const track = getTrack(trackId);
    const players: PlayerView[] = ["You", "Priya", "Marcus", "Jo", "Sam", "Ines"].map((name, i) => ({
      id: `p${i}`, name, color: [0, 1, 3, 4, 6, 5][i], slot: i, ready: true, connected: true, racing: true, lap: 1, place: 6 - i, finished: false, finishMs: 0, bestLapMs: 0, item: i === 0 ? 3 : 0, item2: 0, item3: 0, charges: 1, vehicle: (PREVIEW_VEH + i) % VEHICLES.length, avatar: i, wins: 0, points: 0, vote: "", note: "", cpu: false,
    }));
    useStore.getState().set({
      status: "connected",
      myId: "p0",
      room: { code: "PREVIEW", phase: "racing", hostId: "p0", trackId: track.def.id, laps: 3, raceStartAt: Date.now() - 20_000, raceNumber: 1, players, chaos: 0, speed: 0, cpus: 0, cpuLevel: 1, trial: false, weekly: false, eventId: 0, eventFrom: 0, eventTo: 0, hzOff: 0, voteEndsAt: 0, awards: [] },
    });
    // ?results=trial shows the time-trial results screen with sample numbers, to check its layout.
    if (new URLSearchParams(location.search).get("results") === "trial") {
      const room = useStore.getState().room!;
      const me = { ...players[0], finished: true, finishMs: 98_833, bestLapMs: 32_000, place: 1 };
      useStore.getState().set({
        room: { ...room, phase: "results", trial: true, speed: 3, players: [me] },
        trialResult: { raceMs: 98_833, lapMs: 32_000, rank: 2, weekRank: 1, previousMs: 99_950, improved: true, recordMs: 97_410, recordName: "Priya", saved: true },
      });
    }
    const t0 = performance.now();
    this.previewStart = t0;
    const moving = new URLSearchParams(location.search).has("drive");
    const lineup = new URLSearchParams(location.search).has("lineup");
    const firstAvatar = Number(new URLSearchParams(location.search).get("avatars")) || 0;
    for (const p of players) p.avatar = (p.avatar + firstAvatar) % 5;
    this.preview = (slot, out) => {
      const travel = moving ? ((performance.now() - t0) / 1000) * 28 : 0;
      // ?lineup parks the karts in a row just ahead of the camera, to look at the models.
      const ahead = lineup ? [0, 2.4, 2.4, 2.4, 4.6, 4.6][slot] : ([0, 9, 15, 22, 31, 44][slot] ?? 0);
      const f = (((at * track.n + ahead + travel / track.spacing) % track.n) + track.n) % track.n;
      const i = Math.floor(f);
      const j = (i + 1) % track.n;
      const k = f - i;
      const lat = lineup ? [0, -4.2, 0, 4.2, -2.6, 2.6][slot] : ([0, 3.4, -3.2, 1.2, -4.2, 4.4][slot] ?? 0);
      out.x = track.px[i] + (track.px[j] - track.px[i]) * k + track.nx[i] * lat;
      out.z = track.pz[i] + (track.pz[j] - track.pz[i]) * k + track.nz[i] * lat;
      out.y = track.hy[i] + (track.hy[j] - track.hy[i]) * k + lat * track.bankT[i];
      out.heading = Math.atan2(track.tx[i], track.tz[i]) + (lineup ? (slot === 0 ? 0 : 2.5) : slot === 1 ? -0.1 : 0);
      out.speed = lineup ? 0 : 28;
      // A drifting kart with sparks, a boosting kart, and the rest cruising.
      out.flags = lineup ? 0 : slot === 1 ? 2 | (2 << 3) : slot === 2 ? 4 : slot === 4 ? 1 | (3 << 3) : 0;
      out.fx = lineup ? 0 : slot === 3 ? 2 : out.y < track.waterLevel - 0.8 ? 64 : 0;
      return true;
    };
  }

  // ------------------------------------------------------------- connecting

  /** Who we are, as sent when creating or joining a room. */
  private identity(name: string): JoinOptions {
    const { vehicle, avatar, pid } = useStore.getState();
    return { name, vehicle, avatar, pid };
  }

  async create(name: string, mode: Omit<CreateOptions, keyof JoinOptions> = {}): Promise<boolean> {
    return this.connect(() => this.client.create(ROOM_NAME, { ...this.identity(name), ...mode }));
  }

  async join(code: string, name: string): Promise<boolean> {
    return this.connect(() => this.client.joinById(code, this.identity(name)));
  }

  /** After a page refresh, try to slip back into the seat we were holding. */
  async resume(): Promise<boolean> {
    const saved = this.loadSession();
    if (!saved) return false;
    useStore.getState().set({ status: "connecting", error: null });
    try {
      this.bind(await this.client.reconnect(saved.token));
      return true;
    } catch {
      this.clearSession();
      useStore.getState().set({ status: "idle" });
      return false;
    }
  }

  leave(): void {
    this.leaving = true;
    this.clearSession();
    const room = this.room;
    this.teardown();
    void room?.leave(true);
    useStore.getState().set({ status: "idle", room: null, myId: "" });
  }

  send(type: string, payload?: unknown): void {
    this.room?.send(type, payload);
  }

  private async connect(open: () => Promise<Room>): Promise<boolean> {
    const store = useStore.getState();
    store.set({ status: "connecting", error: null });
    try {
      this.bind(await open());
      return true;
    } catch (err) {
      useStore.getState().set({ status: "idle", error: friendlyError(err) });
      return false;
    }
  }

  private bind(room: Room): void {
    this.room = room;
    this.leaving = false;
    this.raceNumber = -1;
    this.snaps = [];
    this.pingSamples = [];
    this.predictor.reset();
    this.lastHeardAt = performance.now();
    this.saveSession(room);
    useStore.getState().set({ status: "connected", myId: room.sessionId, error: null });

    room.onStateChange((state) => this.onState(state));
    if (room.state?.players) this.onState(room.state);

    room.onMessage(MSG.FX, (fx: FxMessage) => {
      for (const fn of this.fxListeners) fn(fx);
    });
    room.onMessage(MSG.SNAPSHOT, (msg: [number, number, number[], number[]?, number[]?]) => {
      this.lastHeardAt = performance.now();
      this.entities = msg[3] ?? [];
      this.taken = new Set(msg[4] ?? []);
      this.snaps.push({ t: msg[0], flat: msg[2] });
      if (this.snaps.length > 40) this.snaps.shift();
    });
    room.onMessage(MSG.SELF, (msg: number[]) => {
      this.predictor.reconcile(msg);
    });
    room.onMessage(MSG.TRIAL, (result: TrialResult) => useStore.getState().set({ trialResult: result }));
    room.onMessage(MSG.PONG, (msg: [number, number]) => this.onPong(msg));
    room.onMessage(MSG.NOTICE, (notice: Notice) => useStore.getState().showToast(notice));
    room.onMessage("*", () => {});

    room.onError((code, message) => {
      useStore.getState().showToast({ level: "error", text: message || `Connection error (${code})` });
    });
    room.onLeave((code) => {
      if (this.room !== room) return;
      this.teardown();
      if (this.leaving || code === CLOSE_CONSENTED) return;
      if (code === CLOSE_KICKED) {
        this.clearSession();
        useStore.getState().set({ status: "idle", room: null, error: "You were disconnected for sending too many messages." });
        return;
      }
      void this.reconnectLoop(room.reconnectionToken);
    });

    clearInterval(this.pingTimer);
    let pings = 0;
    const ping = () => {
      // A silent socket means the connection is dead even if the browser has not noticed.
      if (performance.now() - this.lastHeardAt > 15000) {
        room.connection.close();
        return;
      }
      if (pings++ < 6 || pings % 2 === 0) room.send(MSG.PING, localNow());
    };
    this.pingTimer = setInterval(ping, 1000);
    ping();
  }

  private teardown(): void {
    clearInterval(this.pingTimer);
    this.room = null;
    setInputEnabled(false);
  }

  private async reconnectLoop(token: string): Promise<void> {
    if (this.reconnecting) return;
    this.reconnecting = true;
    useStore.getState().set({ status: "reconnecting" });
    const deadline = Date.now() + 28_000;
    while (Date.now() < deadline && !this.leaving) {
      try {
        const room = await this.client.reconnect(token);
        this.reconnecting = false;
        this.bind(room);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    this.reconnecting = false;
    if (this.leaving) return;
    this.clearSession();
    useStore.getState().set({ status: "idle", room: null, myId: "", error: "Connection lost. The lobby may have closed; create or join one to keep racing." });
  }

  private saveSession(room: Room): void {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: room.reconnectionToken, code: room.roomId }));
    } catch {
      /* ignore */
    }
  }

  private loadSession(): { token: string; code: string } | null {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private clearSession(): void {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }

  // -------------------------------------------------------------- room state

  private onState(state: any): void {
    this.lastHeardAt = performance.now();
    const view = toView(state);
    if (view.raceNumber !== this.raceNumber) {
      // A new race (or our first look at this room): start from a clean slate.
      this.raceNumber = view.raceNumber;
      this.predictor.reset(getTrack(view.trackId));
      // Our vehicle is part of the simulation, so prediction has to know it from the first tick.
      this.predictor.state.veh = view.players.find((p) => p.id === this.room?.sessionId)?.vehicle ?? 0;
      this.snaps = [];
      this.acc = 0;
      this.entities = [];
      this.taken = new Set();
      useStore.getState().set({ spectate: 0, trialResult: null });
    }
    // Chaos events and hazard timing are part of the simulation, so prediction needs them too.
    const ctx = this.predictor.ctx;
    ctx.event = view.eventId;
    ctx.from = view.eventFrom;
    ctx.to = view.eventTo;
    ctx.hzOff = view.hzOff;
    ctx.speed = SPEED_CLASSES[view.speed]?.k ?? 1;
    useStore.getState().set({ room: view });
  }

  // ------------------------------------------------------------------- clock

  private onPong([sentAt, serverNow]: [number, number]): void {
    this.lastHeardAt = performance.now();
    const now = localNow();
    const rtt = Math.max(0, now - sentAt);
    this.pingSamples.push({ rtt, offset: serverNow - (sentAt + rtt / 2) });
    if (this.pingSamples.length > 10) this.pingSamples.shift();
    // The lowest-latency sample has the least asymmetric delay: trust its offset.
    let best = this.pingSamples[0];
    for (const s of this.pingSamples) if (s.rtt < best.rtt) best = s;
    this.clockOffset = best.offset;
    const sorted = this.pingSamples.map((s) => s.rtt).sort((a, b) => a - b);
    useStore.getState().set({ pingMs: Math.round(sorted[Math.floor(sorted.length / 2)]) });
  }

  /** Our best estimate of the server's clock, in epoch milliseconds. */
  serverNow(): number {
    return localNow() + this.clockOffset;
  }

  // ------------------------------------------------------------- simulation

  /** True while the local player is in control of a kart. */
  isDriving(): boolean {
    const { room, myId } = useStore.getState();
    if (!this.room || !room || !this.predictor.ready) return false;
    if (room.phase !== "countdown" && room.phase !== "racing") return false;
    const me = room.players.find((p) => p.id === myId);
    if (!me || !me.racing || me.finished) return false;
    return room.phase === "racing" || this.serverNow() >= room.raceStartAt + 30;
  }

  /** Call once per rendered frame. Runs fixed simulation ticks and sends inputs. */
  update(frameSeconds: number): number {
    const dt = Math.min(frameSeconds, 0.1);
    const driving = this.isDriving();
    setInputEnabled(driving);
    this.seeOthers(driving);
    if (driving && this.room) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= DT && steps < 4) {
        const [bits, steer] = sampleInput();
        this.room.send(MSG.INPUT, this.predictor.tick(bits, steer));
        this.acc -= DT;
        steps++;
      }
      if (this.acc >= DT) this.acc = 0; // fell too far behind (tab was hidden): drop the backlog
    } else {
      this.acc = 0;
    }
    // On the grid: tell the server when the accelerator goes down or up, so it can time a rocket start.
    const rev = this.room !== null && useStore.getState().room?.phase === "countdown" && revHeld();
    if (rev !== this.rev) {
      this.rev = rev;
      if (this.room && useStore.getState().room?.phase === "countdown") this.room.send(MSG.REV, rev);
    }
    this.predictor.decay(dt);
    this.alpha = this.acc / DT;
    return this.alpha;
  }

  private readonly turns = new Map<number, { rate: number; at: number }>();
  private bodies: CarBody[] = [];
  private readonly seen: KartSample = { x: 0, y: 0, z: 0, heading: 0, speed: 0, flags: 0, fx: 0 };
  /** Tell the prediction where the other cars are right now, so our car can touch them at once. */
  private seeOthers(driving: boolean): void {
    const out = this.predictor.others;
    out.length = 0;
    const { room, myId } = useStore.getState();
    if (!driving || !room || this.preview) return;
    let n = 0;
    for (const p of room.players) {
      if (p.id === myId || !p.racing || p.finished || !this.sampleKart(p.slot, this.seen)) continue;
      const k = this.seen;
      if (k.fx & FX.PHANTOM) continue;
      const b = (this.bodies[n++] ??= { x: 0, z: 0, y: 0, heading: 0, vAngle: 0, speed: 0, veh: 0, sizeT: 0, sizeK: 0 });
      b.x = k.x;
      b.z = k.z;
      b.y = k.y;
      b.heading = b.vAngle = k.heading;
      b.speed = k.speed;
      b.veh = p.vehicle;
      b.sizeT = k.fx & (FX.GIANT | FX.MINI) ? 1 : 0;
      b.sizeK = k.fx & FX.GIANT ? 1 : -1;
      out.push(b);
    }
  }

  /** Race tick as the server counts it, estimated from the clock. */
  raceTick(): number {
    const room = useStore.getState().room;
    if (this.preview) return (performance.now() - this.previewStart) / TICK_MS;
    return room ? Math.max(0, (this.serverNow() - room.raceStartAt) / TICK_MS) : 0;
  }

  /** The time hazards are drawn at. While driving it is our own kart's clock, so what you see is what can hit you. */
  hazardClock(): number {
    // The kart on screen sits between its previous and current tick, so hazards do too.
    const tick = this.isDriving() ? this.predictor.state.tick - 1 + this.alpha : this.raceTick();
    return hazardTime(tick, this.predictor.ctx);
  }

  /** Predicted, smoothed state of the local kart. `alpha` is the fraction of a tick elapsed. */
  sampleOwn(alpha: number, out: KartSample): void {
    const p = this.predictor;
    const a = p.prev;
    const b = p.state;
    out.x = a.x + (b.x - a.x) * alpha + p.errX;
    out.z = a.z + (b.z - a.z) * alpha + p.errZ;
    out.y = a.y + (b.y - a.y) * alpha + p.errY;
    out.heading = a.heading + angleDiff(b.heading, a.heading) * alpha + p.errH;
    out.speed = b.speed;
    out.flags = 0;
    out.fx = 0;
  }

  /** Interpolated state of any kart from the snapshot buffer. Returns false if unknown. */
  sampleKart(slot: number, out: KartSample): boolean {
    if (this.preview) return this.preview(slot, out);
    const snaps = this.snaps;
    if (snaps.length === 0) return false;
    const rt = this.serverNow() - INTERP_MS;
    let i = snaps.length - 1;
    while (i > 0 && snaps[i].t > rt) i--;
    const a = snaps[i];
    const ia = findSlot(a.flat, slot);
    if (ia < 0) return false;
    const b = snaps[i + 1];
    const ib = b ? findSlot(b.flat, slot) : -1;
    const ax = a.flat[ia + 1];
    const az = a.flat[ia + 2];
    const ah = a.flat[ia + 3];
    const as = a.flat[ia + 4];
    if (!b || ib < 0) {
      const ahead = Math.max(0, Math.min(MAX_EXTRAPOLATE_S, (rt - a.t) / 1000));
      out.x = ax + Math.sin(ah) * as * ahead;
      out.z = az + Math.cos(ah) * as * ahead;
      out.heading = ah;
      out.speed = as;
      out.flags = a.flat[ia + 5];
      out.y = a.flat[ia + 6] ?? 0;
      out.fx = a.flat[ia + 7] ?? 0;
      return true;
    }
    const span = b.t - a.t;
    const t = span > 0 ? Math.max(0, Math.min(1, (rt - a.t) / span)) : 1;
    const dx = b.flat[ib + 1] - ax;
    const dz = b.flat[ib + 2] - az;
    const dh = angleDiff(b.flat[ib + 3], ah);
    out.x = ax + dx * t;
    out.z = az + dz * t;
    out.heading = ah + dh * t;
    out.speed = as + (b.flat[ib + 4] - as) * t;
    out.flags = b.flat[ib + 5];
    out.fx = b.flat[ib + 7] ?? 0;
    const ay = a.flat[ia + 6] ?? 0;
    const dy = (b.flat[ib + 6] ?? 0) - ay;
    out.y = ay + dy * t;
    // Our own car is drawn ahead of the server's clock and the others behind it. At racing speed that gap is
    // several metres, enough to show a car we are touching as a car we are inside. So carry the others forward
    // along their path to the moment our own car is drawn at: what is next to you on screen is next to you.
    // The turn rate between two snapshots is jumpy; ease it so a carried-forward car does not wobble.
    let turn = this.turns.get(slot);
    if (!turn) this.turns.set(slot, (turn = { rate: dh / span, at: b.t }));
    else if (turn.at !== b.t) {
      turn.rate += (dh / span - turn.rate) * (b.t - turn.at > 400 ? 1 : 0.5);
      turn.at = b.t;
    }
    carryForward(out, dx, dy, dz, turn.rate * span, span, this.lead(rt));
    return true;
  }

  /** Seconds between the moment the other cars' snapshots describe and the moment our own car is drawn at. */
  private lead(rt: number): number {
    const room = useStore.getState().room;
    if (!room || !this.isDriving()) return 0;
    const own = room.raceStartAt + (this.predictor.state.tick - 1 + this.alpha) * TICK_MS;
    return Math.max(0, Math.min(MAX_LEAD_S, (own - rt) / 1000));
  }
}

function findSlot(flat: number[], slot: number): number {
  for (let i = 0; i < flat.length; i += SNAPSHOT_STRIDE) if (flat[i] === slot) return i;
  return -1;
}

export const net = new Net();

// ?debug exposes the connection to the browser console and to the automated contact check.
if (typeof location !== "undefined" && new URLSearchParams(location.search).has("debug")) Object.assign(window, { __net: net, __store: useStore });
