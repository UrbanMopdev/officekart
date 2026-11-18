import http from "node:http";
import express from "express";
import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME } from "@office-kart/shared";
import { RaceRoom } from "./rooms/RaceRoom";
import { activeRoomCount } from "./util/codes";
import { errorFields, log } from "./util/log";
import { tickStats } from "./util/metrics";
import { WindowLimiter } from "./util/rateLimit";
import { SPEED_CLASSES, TRACK_DEFS, weekIndex, weeklyChallenge } from "@office-kart/shared";
import { initScores, readBoard, readGhost, scoresKind, weekBoard } from "./scores";

const PORT = Number(process.env.PORT) || 2567;
const HOST = "0.0.0.0";
const IS_PROD = process.env.NODE_ENV === "production";

// ------------------------------------------------------------------- origins
// ALLOWED_ORIGINS is a comma-separated list of browser origins that may talk to
// this server, e.g. "https://office-kart.up.railway.app". Entries without a
// scheme are treated as https, so a bare Railway domain reference works.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter(Boolean)
  .map((o) => (/^https?:\/\//i.test(o) ? o : `https://${o}`).toLowerCase());

if (allowedOrigins.length === 0) {
  (IS_PROD ? log.warn : log.info)("ALLOWED_ORIGINS is not set: accepting connections from any origin");
}

/** Requests with no Origin header (health checks, CLI tools, tests) are not browsers and are allowed. */
function originAllowed(origin: string | undefined): boolean {
  if (allowedOrigins.length === 0 || !origin) return true;
  return allowedOrigins.includes(origin.toLowerCase());
}

function clientIp(req: http.IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
  return first || req.socket.remoteAddress || "unknown";
}

// ---------------------------------------------------------------------- http
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

const startedAt = Date.now();

app.get("/health", (_req, res) => {
  if (RaceRoom.shuttingDown) {
    res.status(503).json({ status: "shutting_down" });
    return;
  }
  res.json({
    status: "ok",
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    rooms: activeRoomCount(),
    memoryMb: Math.round(process.memoryUsage().rss / 1048576),
    tick: tickStats(),
    scores: scoresKind(),
  });
});

// -------------------------------------------------------- leaderboards (read-only)
// Scores are only ever written by the game room when a run finishes; these routes just read them.
const apiLimiter = new WindowLimiter(Number(process.env.API_PER_MINUTE) || 240, 60_000);
app.use("/api", (req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.length === 0) res.setHeader("Access-Control-Allow-Origin", origin || "*");
  else if (origin && originAllowed(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "Read-only" });
    return;
  }
  if (!apiLimiter.allow(clientIp(req))) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }
  next();
});

/** Reads and checks ?track=&speed=&board=&pid= */
function boardQuery(q: Record<string, unknown>): { board: string; trackId: string; speed: number; pid?: string } | null {
  const trackId = String(q.track ?? "");
  const speed = Number(q.speed);
  if (!TRACK_DEFS[trackId] || !Number.isInteger(speed) || speed < 0 || speed >= SPEED_CLASSES.length) return null;
  const pid = typeof q.pid === "string" && /^[a-z0-9-]{8,40}$/.test(q.pid) ? q.pid : undefined;
  return { board: q.board === "week" ? weekBoard(weekIndex(Date.now())) : "all", trackId, speed, pid };
}

app.get("/api/challenge", (req, res, next) => {
  const c = weeklyChallenge(Date.now());
  const pid = typeof req.query.pid === "string" && /^[a-z0-9-]{8,40}$/.test(req.query.pid) ? req.query.pid : undefined;
  readBoard(weekBoard(c.week), c.trackId, c.speed, pid)
    .then((b) => res.json({ challenge: c, ...b }))
    .catch(next);
});

app.get("/api/board", (req, res, next) => {
  const q = boardQuery(req.query);
  if (!q) {
    res.status(400).json({ error: "Unknown track or speed class" });
    return;
  }
  readBoard(q.board, q.trackId, q.speed, q.pid)
    .then((b) => res.json(b))
    .catch(next);
});

// The ghost of the fastest run on a board (or of one player's best with &of=<pid>).
app.get("/api/ghost", (req, res, next) => {
  const q = boardQuery(req.query);
  if (!q) {
    res.status(400).json({ error: "Unknown track or speed class" });
    return;
  }
  const of = typeof req.query.of === "string" && /^[a-z0-9-]{8,40}$/.test(req.query.of) ? req.query.of : undefined;
  readGhost(q.board, q.trackId, q.speed, of)
    .then((g) => (g ? res.json(g) : res.status(404).json({ error: "No run on this board yet" })))
    .catch(next);
});

app.use("/api", (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log.warn("api_error", errorFields(err));
  res.status(500).json({ error: "Leaderboards are unavailable right now" });
});

app.get("/", (_req, res) => {
  res.type("text/plain").send("Office Kart game server. Connect with the web client.");
});

const server = http.createServer(app);

const gameServer = new Server({
  greet: false,
  transport: new WebSocketTransport({
    server,
    pingInterval: 4000,
    pingMaxRetries: 3,
    maxPayload: 2048,
    verifyClient: (info: { origin: string; req: http.IncomingMessage }, next: (ok: boolean, code?: number, message?: string) => void) => {
      if (originAllowed(info.origin)) return next(true);
      log.warn("ws_origin_rejected", { origin: info.origin, ip: clientIp(info.req) });
      next(false, 403, "Origin not allowed");
    },
  }),
});

gameServer.define(ROOM_NAME, RaceRoom);

// CORS for the matchmaking endpoints: only echo back origins we trust.
matchMaker.controller.getCorsHeaders = (req: http.IncomingMessage) => {
  const origin = req.headers.origin;
  if (allowedOrigins.length === 0) return { "Access-Control-Allow-Origin": origin || "*", Vary: "Origin" };
  return { "Access-Control-Allow-Origin": origin && originAllowed(origin) ? origin : allowedOrigins[0], Vary: "Origin" };
};

// Colyseus answers /matchmake/* itself, ahead of Express. Put an origin check
// and a per-IP rate limit in front of it (this is what stops lobby-code guessing).
const matchmakeLimiter = new WindowLimiter(Number(process.env.MATCHMAKE_PER_MINUTE) || 90, 60_000);
const listeners = server.listeners("request").slice() as http.RequestListener[];
server.removeAllListeners("request");
server.on("request", (req, res) => {
  if (req.url && req.url.startsWith("/matchmake") && req.method !== "OPTIONS") {
    if (!originAllowed(req.headers.origin)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ code: 403, error: "Origin not allowed" }));
      return;
    }
    if (!matchmakeLimiter.allow(clientIp(req))) {
      const origin = req.headers.origin;
      res.writeHead(429, { "Content-Type": "application/json", ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}) });
      res.end(JSON.stringify({ code: 429, error: "Too many requests. Wait a minute and try again." }));
      return;
    }
  }
  for (const listener of listeners) listener.call(server, req, res);
});

// ------------------------------------------------------------------ shutdown
// Colyseus traps SIGTERM/SIGINT and runs a graceful shutdown: rooms get
// onBeforeShutdown (players are told and disconnected), then the process exits.
// Race state lives in memory only, so a race in progress does not survive a
// restart; players create a new lobby afterwards.
gameServer.onBeforeShutdown(() => {
  RaceRoom.shuttingDown = true;
  log.info("shutdown_started", { rooms: activeRoomCount() });
});
gameServer.onShutdown(() => {
  log.info("shutdown_complete");
});

process.on("uncaughtException", (err) => {
  log.error("uncaught_exception", errorFields(err));
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  log.error("unhandled_rejection", errorFields(reason));
});

void initScores();

gameServer
  .listen(PORT, HOST)
  .then(() => log.info("server_listening", { host: HOST, port: PORT, env: process.env.NODE_ENV ?? "development", allowedOrigins }))
  .catch((err) => {
    log.error("server_failed_to_start", errorFields(err));
    process.exit(1);
  });
