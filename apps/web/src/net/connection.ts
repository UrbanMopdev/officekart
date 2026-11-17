/**
 * Everything that talks to the game server: joining rooms, clock sync,
 * sending inputs, prediction/reconciliation of the local kart and
 * interpolation of everyone else's.
 */
import { Client, type Room } from "colyseus.js";
import {
  DEFAULT_TRACK_ID,
  DT,
  MSG,
  Predictor,
  ROOM_NAME,
  SNAPSHOT_STRIDE,
  angleDiff,
  getTrack,
  type Notice,
  type Phase,
  type PlayerView,
  type RoomView,
} from "@office-kart/shared";
import { sampleInput, setInputEnabled } from "../game/input";
import { useStore } from "../store";

/** Remote karts are drawn this far in the past so there are always two snapshots to blend. */
const INTERP_MS = 110;
const MAX_EXTRAPOLATE_S = 0.2;
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
  z: number;
  heading: number;
  speed: number;
  flags: number;
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
    });
  });
  players.sort((a, b) => a.slot - b.slot);
  return {
    code: state.code,
    phase: state.phase as Phase,
    hostId: state.hostId,
    trackId: state.trackId,
    laps: state.laps,
    raceStartAt: state.raceStartAt,
    raceNumber: state.raceNumber,
    players,
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

  readonly predictor = new Predictor(getTrack(DEFAULT_TRACK_ID));

  /** Offline track preview (?preview=track-id): supplies kart positions without a server. */
  private preview: ((slot: number, out: KartSample) => boolean) | null = null;

  startPreview(trackId: string, at: number): void {
    const track = getTrack(trackId);
    const players: PlayerView[] = ["You", "Priya", "Marcus", "Jo", "Sam", "Ines"].map((name, i) => ({
      id: `p${i}`, name, color: [0, 1, 3, 4, 6, 5][i], slot: i, ready: true, connected: true, racing: true, lap: 1, place: 6 - i, finished: false, finishMs: 0, bestLapMs: 0,
    }));
    useStore.getState().set({
      status: "connected",
      myId: "p0",
      room: { code: "PREVIEW", phase: "racing", hostId: "p0", trackId: track.def.id, laps: 3, raceStartAt: Date.now() - 20_000, raceNumber: 1, players },
    });
    const t0 = performance.now();
    const moving = new URLSearchParams(location.search).has("drive");
    this.preview = (slot, out) => {
      const travel = moving ? ((performance.now() - t0) / 1000) * 28 : 0;
      const ahead = [0, 9, 15, 22, 31, 44][slot] ?? 0;
      const f = (((at * track.n + ahead + travel / track.spacing) % track.n) + track.n) % track.n;
      const i = Math.floor(f);
      const j = (i + 1) % track.n;
      const k = f - i;
      const lat = [0, 3.4, -3.2, 1.2, -4.2, 4.4][slot] ?? 0;
      out.x = track.px[i] + (track.px[j] - track.px[i]) * k + track.nx[i] * lat;
      out.z = track.pz[i] + (track.pz[j] - track.pz[i]) * k + track.nz[i] * lat;
      out.heading = Math.atan2(track.tx[i], track.tz[i]) + (slot === 1 ? -0.1 : 0);
      out.speed = 28;
      // A drifting kart with sparks, a boosting kart, and the rest cruising.
      out.flags = slot === 1 ? 2 | (2 << 3) : slot === 2 ? 4 : slot === 4 ? 1 | (3 << 3) : 0;
      return true;
    };
  }

  // ------------------------------------------------------------- connecting

  async create(name: string): Promise<boolean> {
    return this.connect(() => this.client.create(ROOM_NAME, { name }));
  }

  async join(code: string, name: string): Promise<boolean> {
    return this.connect(() => this.client.joinById(code, { name }));
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

    room.onMessage(MSG.SNAPSHOT, (msg: [number, number, number[]]) => {
      this.lastHeardAt = performance.now();
      this.snaps.push({ t: msg[0], flat: msg[2] });
      if (this.snaps.length > 40) this.snaps.shift();
    });
    room.onMessage(MSG.SELF, (msg: number[]) => {
      this.predictor.reconcile(msg);
    });
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
      this.snaps = [];
      this.acc = 0;
    }
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
    this.predictor.decay(dt);
    return this.acc / DT;
  }

  /** Predicted, smoothed state of the local kart. `alpha` is the fraction of a tick elapsed. */
  sampleOwn(alpha: number, out: KartSample): void {
    const p = this.predictor;
    const a = p.prev;
    const b = p.state;
    out.x = a.x + (b.x - a.x) * alpha + p.errX;
    out.z = a.z + (b.z - a.z) * alpha + p.errZ;
    out.heading = a.heading + angleDiff(b.heading, a.heading) * alpha + p.errH;
    out.speed = b.speed;
    out.flags = 0;
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
      return true;
    }
    const span = b.t - a.t;
    const t = span > 0 ? Math.max(0, Math.min(1, (rt - a.t) / span)) : 1;
    out.x = ax + (b.flat[ib + 1] - ax) * t;
    out.z = az + (b.flat[ib + 2] - az) * t;
    out.heading = ah + angleDiff(b.flat[ib + 3], ah) * t;
    out.speed = as + (b.flat[ib + 4] - as) * t;
    out.flags = b.flat[ib + 5];
    return true;
  }
}

function findSlot(flat: number[], slot: number): number {
  for (let i = 0; i < flat.length; i += SNAPSHOT_STRIDE) if (flat[i] === slot) return i;
  return -1;
}

export const net = new Net();
