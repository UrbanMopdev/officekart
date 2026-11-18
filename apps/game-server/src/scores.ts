/**
 * Time-trial leaderboards. One row per player per board, holding their best
 * race time, best lap and the ghost of the best race. A "board" is either
 * all-time ("all") or one week ("w<index>"), for one track and speed class.
 *
 * Uses PostgreSQL when DATABASE_URL is set. Without it (local runs, tests)
 * the same interface is served from memory and forgotten on restart.
 */
import type { BoardEntry, GhostData } from "@office-kart/shared";
import { log } from "./util/log";

export interface Run {
  trackId: string;
  speed: number;
  week: number;
  pid: string;
  name: string;
  color: number;
  vehicle: number;
  avatar: number;
  raceMs: number;
  lapMs: number;
  ghost: string;
}

export interface Standing {
  rank: number;
  weekRank: number;
  previousMs: number;
  recordMs: number;
  recordName: string;
  saved: boolean;
}

interface Row extends BoardEntry {
  ghost: string;
}

interface Store {
  readonly kind: string;
  upsert(board: string, run: Run): Promise<void>;
  top(board: string, trackId: string, speed: number, by: "race" | "lap", limit: number): Promise<BoardEntry[]>;
  mine(board: string, trackId: string, speed: number, pid: string): Promise<BoardEntry | null>;
  rank(board: string, trackId: string, speed: number, raceMs: number): Promise<number>;
  ghost(board: string, trackId: string, speed: number, pid?: string): Promise<GhostData | null>;
  count(): Promise<number>;
}

const key = (board: string, trackId: string, speed: number) => `${board}|${trackId}|${speed}`;

class MemoryStore implements Store {
  readonly kind = "memory";
  private boards = new Map<string, Map<string, Row>>();

  async upsert(board: string, run: Run): Promise<void> {
    const k = key(board, run.trackId, run.speed);
    const rows = this.boards.get(k) ?? new Map<string, Row>();
    this.boards.set(k, rows);
    const old = rows.get(run.pid);
    const better = !old || run.raceMs < old.raceMs;
    rows.set(run.pid, {
      pid: run.pid,
      name: run.name,
      color: run.color,
      avatar: run.avatar,
      vehicle: better ? run.vehicle : old.vehicle,
      raceMs: better ? run.raceMs : old.raceMs,
      lapMs: old ? Math.min(old.lapMs, run.lapMs) : run.lapMs,
      ghost: better ? run.ghost : old.ghost,
      at: Date.now(),
    });
  }
  private sorted(board: string, trackId: string, speed: number, by: "race" | "lap"): Row[] {
    const rows = [...(this.boards.get(key(board, trackId, speed))?.values() ?? [])];
    return rows.sort((a, b) => (by === "race" ? a.raceMs - b.raceMs : a.lapMs - b.lapMs));
  }
  async top(board: string, trackId: string, speed: number, by: "race" | "lap", limit: number): Promise<BoardEntry[]> {
    return this.sorted(board, trackId, speed, by).slice(0, limit).map(({ ghost: _ghost, ...entry }) => entry);
  }
  async mine(board: string, trackId: string, speed: number, pid: string): Promise<BoardEntry | null> {
    const row = this.boards.get(key(board, trackId, speed))?.get(pid);
    if (!row) return null;
    const { ghost: _ghost, ...entry } = row;
    return entry;
  }
  async rank(board: string, trackId: string, speed: number, raceMs: number): Promise<number> {
    return this.sorted(board, trackId, speed, "race").filter((r) => r.raceMs < raceMs).length + 1;
  }
  async ghost(board: string, trackId: string, speed: number, pid?: string): Promise<GhostData | null> {
    const rows = this.sorted(board, trackId, speed, "race");
    const r = pid ? rows.find((x) => x.pid === pid) : rows[0];
    return r && r.ghost ? { name: r.name, pid: r.pid, ms: r.raceMs, d: r.ghost, color: r.color, vehicle: r.vehicle, avatar: r.avatar } : null;
  }
  async count(): Promise<number> {
    let n = 0;
    for (const rows of this.boards.values()) n += rows.size;
    return n;
  }
}

interface PgPool {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

const COLUMNS = "player_id, name, color, vehicle, avatar, race_ms, lap_ms, extract(epoch from updated_at) * 1000 AS at";
const entry = (r: Record<string, unknown>): BoardEntry => ({
  pid: String(r.player_id),
  name: String(r.name),
  color: Number(r.color),
  vehicle: Number(r.vehicle),
  avatar: Number(r.avatar),
  raceMs: Number(r.race_ms),
  lapMs: Number(r.lap_ms),
  at: Math.round(Number(r.at)),
});

class PgStore implements Store {
  readonly kind = "postgres";
  constructor(private pool: PgPool) {}

  async migrate(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS trial_best (
      board text NOT NULL,
      track text NOT NULL,
      speed smallint NOT NULL,
      player_id text NOT NULL,
      name text NOT NULL,
      color smallint NOT NULL DEFAULT 0,
      vehicle smallint NOT NULL DEFAULT 0,
      avatar smallint NOT NULL DEFAULT 0,
      race_ms integer NOT NULL,
      lap_ms integer NOT NULL,
      ghost text NOT NULL DEFAULT '',
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (board, track, speed, player_id)
    )`);
    await this.pool.query("CREATE INDEX IF NOT EXISTS trial_best_race ON trial_best (board, track, speed, race_ms)");
    await this.pool.query("CREATE INDEX IF NOT EXISTS trial_best_lap ON trial_best (board, track, speed, lap_ms)");
  }

  async upsert(board: string, run: Run): Promise<void> {
    // Every right-hand side reads the row as it was, so "is this run faster" is asked of the old time throughout.
    await this.pool.query(
      `INSERT INTO trial_best (board, track, speed, player_id, name, color, vehicle, avatar, race_ms, lap_ms, ghost)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (board, track, speed, player_id) DO UPDATE SET
         name = EXCLUDED.name,
         color = EXCLUDED.color,
         avatar = EXCLUDED.avatar,
         vehicle = CASE WHEN EXCLUDED.race_ms < trial_best.race_ms THEN EXCLUDED.vehicle ELSE trial_best.vehicle END,
         ghost = CASE WHEN EXCLUDED.race_ms < trial_best.race_ms THEN EXCLUDED.ghost ELSE trial_best.ghost END,
         race_ms = LEAST(trial_best.race_ms, EXCLUDED.race_ms),
         lap_ms = LEAST(trial_best.lap_ms, EXCLUDED.lap_ms),
         updated_at = now()`,
      [board, run.trackId, run.speed, run.pid, run.name, run.color, run.vehicle, run.avatar, run.raceMs, run.lapMs, run.ghost],
    );
  }
  async top(board: string, trackId: string, speed: number, by: "race" | "lap", limit: number): Promise<BoardEntry[]> {
    const order = by === "race" ? "race_ms" : "lap_ms";
    const res = await this.pool.query(`SELECT ${COLUMNS} FROM trial_best WHERE board = $1 AND track = $2 AND speed = $3 ORDER BY ${order}, updated_at LIMIT $4`, [board, trackId, speed, limit]);
    return res.rows.map(entry);
  }
  async mine(board: string, trackId: string, speed: number, pid: string): Promise<BoardEntry | null> {
    const res = await this.pool.query(`SELECT ${COLUMNS} FROM trial_best WHERE board = $1 AND track = $2 AND speed = $3 AND player_id = $4`, [board, trackId, speed, pid]);
    return res.rows[0] ? entry(res.rows[0]) : null;
  }
  async rank(board: string, trackId: string, speed: number, raceMs: number): Promise<number> {
    const res = await this.pool.query("SELECT count(*) AS n FROM trial_best WHERE board = $1 AND track = $2 AND speed = $3 AND race_ms < $4", [board, trackId, speed, raceMs]);
    return Number(res.rows[0].n) + 1;
  }
  async ghost(board: string, trackId: string, speed: number, pid?: string): Promise<GhostData | null> {
    const res = pid
      ? await this.pool.query("SELECT player_id, name, color, vehicle, avatar, race_ms, ghost FROM trial_best WHERE board = $1 AND track = $2 AND speed = $3 AND player_id = $4", [board, trackId, speed, pid])
      : await this.pool.query("SELECT player_id, name, color, vehicle, avatar, race_ms, ghost FROM trial_best WHERE board = $1 AND track = $2 AND speed = $3 AND ghost <> '' ORDER BY race_ms, updated_at LIMIT 1", [board, trackId, speed]);
    const r = res.rows[0];
    return r && r.ghost ? { name: String(r.name), pid: String(r.player_id), ms: Number(r.race_ms), d: String(r.ghost), color: Number(r.color), vehicle: Number(r.vehicle), avatar: Number(r.avatar) } : null;
  }
  async count(): Promise<number> {
    return Number((await this.pool.query("SELECT count(*) AS n FROM trial_best")).rows[0].n);
  }
}

let store: Store = new MemoryStore();

/** Connect to PostgreSQL if it is configured. The game runs without it; scores then last until the next restart. */
export async function initScores(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    log.info("scores_store", { kind: "memory", note: "DATABASE_URL is not set: leaderboards are kept in memory only" });
    return;
  }
  try {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url, max: 4, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 8_000 });
    pool.on("error", (err: Error) => log.warn("scores_pool_error", { error: err.message }));
    const pg = new PgStore(pool as unknown as PgPool);
    await pg.migrate();
    store = pg;
    log.info("scores_store", { kind: "postgres", rows: await pg.count() });
  } catch (err) {
    log.warn("scores_store", { kind: "memory", error: (err as Error).message, note: "could not reach PostgreSQL: leaderboards are kept in memory only" });
  }
}

export const scoresKind = (): string => store.kind;
export const weekBoard = (week: number): string => `w${week}`;

/** Record a finished run on the all-time and weekly boards and say where it stands. */
export async function submitRun(run: Run): Promise<Standing> {
  const none: Standing = { rank: 0, weekRank: 0, previousMs: 0, recordMs: 0, recordName: "", saved: false };
  try {
    const [before, record] = await Promise.all([store.mine("all", run.trackId, run.speed, run.pid), store.top("all", run.trackId, run.speed, "race", 1)]);
    await store.upsert("all", run);
    await store.upsert(weekBoard(run.week), run);
    const best = Math.min(run.raceMs, before?.raceMs ?? Infinity);
    const myWeek = await store.mine(weekBoard(run.week), run.trackId, run.speed, run.pid);
    return {
      rank: await store.rank("all", run.trackId, run.speed, best),
      weekRank: await store.rank(weekBoard(run.week), run.trackId, run.speed, myWeek?.raceMs ?? run.raceMs),
      previousMs: before?.raceMs ?? 0,
      recordMs: record[0]?.raceMs ?? 0,
      recordName: record[0]?.name ?? "",
      saved: true,
    };
  } catch (err) {
    log.warn("scores_submit_failed", { error: (err as Error).message });
    return none;
  }
}

export async function readBoard(board: string, trackId: string, speed: number, pid?: string): Promise<{ race: BoardEntry[]; lap: BoardEntry[]; me: BoardEntry | null; myRank: number }> {
  const [race, lap, me] = await Promise.all([store.top(board, trackId, speed, "race", 25), store.top(board, trackId, speed, "lap", 10), pid ? store.mine(board, trackId, speed, pid) : Promise.resolve(null)]);
  return { race, lap, me, myRank: me ? await store.rank(board, trackId, speed, me.raceMs) : 0 };
}

export function readGhost(board: string, trackId: string, speed: number, pid?: string): Promise<GhostData | null> {
  return store.ghost(board, trackId, speed, pid);
}
