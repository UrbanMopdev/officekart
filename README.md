# Office Kart

Browser-based 3D kart racing for 2–12 coworkers. Open a link, type a nickname, race.

This repository currently contains **Phase 1** of the specification: a complete online
multiplayer race on the first track, Office Dash, with a server-authoritative simulation.
Phases 2–4 (power-ups, more tracks and modes, persistent stats, polish) build on it.

## What works today

- Private lobbies with a six-character code and a shareable invite link (`/r/ABC123`)
- 2–12 human racers per lobby, guest nicknames, kart colour selection, ready-up, host settings (laps)
- Server-authoritative racing at 30 Hz: the server simulates every kart from player inputs
- Client-side prediction with server reconciliation for your own kart; interpolation for everyone else's
- Arcade handling: speed-sensitive steering, drifting with three mini-turbo levels, boost pads,
  off-road slowdown, wall and kart-to-kart collisions, kart reset
- Synchronised countdown, ordered checkpoints, lap counting, live positions, finish order, results, rematch
- Disconnect handling: a dropped player's seat is held for 30 seconds and they rejoin the same race
  (including after a page refresh); the host role passes on if the host leaves
- HUD: position, lap, timer, speed, drift charge, mini-map, live standings, latency indicator
- Rate limiting, input validation, origin checks, `/health`, structured logs, graceful shutdown

Not built yet: power-ups, the other four tracks, Grand Prix / Team Battle / Time Trial, characters and
kart classes, audio, gamepad support, PostgreSQL-backed profiles and leaderboards.

## Repository layout

```text
apps/
  web/           React + TypeScript + Vite + Three.js (React Three Fiber) client
  game-server/   Node.js + Colyseus authoritative game server
packages/
  shared/        Code used by BOTH sides: kart physics, track geometry, prediction, protocol
database/
  migrations/    Empty until Phase 3
```

`packages/shared` is the important part of the design. The kart physics and the track are written once
and run on both the server (the authority) and the client (to predict your own kart), so the two cannot
drift apart.

## Run it locally

Requires Node.js 20 or newer.

```bash
npm install
npm run dev          # game server on :2567, web client on http://localhost:5173
```

Open http://localhost:5173 in two browser windows, create a lobby in one and join with the code in the other.

## Tests

```bash
npm run build        # the tests run against the built server
npm run test:track   # track geometry sanity checks
npm run test:race    # 29 end-to-end checks through real network clients
npm run test:load    # 12-client race with CPU, memory, tick and latency figures
```

`test:race` and `test:load` accept `SERVER_URL` to target a deployed server:

```bash
SERVER_URL=wss://<your-game-server-domain> npm run test:race -w @office-kart/game-server
SERVER_URL=wss://<your-game-server-domain> npm run test:load -w @office-kart/game-server
```

The scripted clients in `apps/game-server/scripts` exist only for these tests. The game itself never adds
computer-controlled racers.

## Deploy to Railway

Two services from this one repository. Both build from a Dockerfile with the **repository root** as the
build context, because each needs `packages/shared`.

### 1. Push the code to GitHub

Create an empty GitHub repository and push this project to its `main` branch.

### 2. Create the game server service

1. In Railway: **New Project → Deploy from GitHub repo** and pick the repository.
2. Rename the service to `game-server` (the variable references below use this name).
3. **Settings → Source**: leave *Root Directory* empty.
4. **Settings → Config-as-code**: set the file path to `/apps/game-server/railway.json`.
   This selects the Dockerfile, the `/health` check, one replica and the restart policy.
5. **Variables**:

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `PORT` | `2567` |
   | `ALLOWED_ORIGINS` | `https://${{web.RAILWAY_PUBLIC_DOMAIN}}` |

6. **Settings → Networking → Generate Domain**, target port `2567`.
7. Make sure **Serverless** (app sleeping) is **off** for this service. A sleeping server drops every race.
8. Pick a region close to your players.

### 3. Create the web service

1. In the same project: **New → GitHub Repo**, same repository. Rename the service to `web`.
2. **Settings → Source**: leave *Root Directory* empty.
3. **Settings → Config-as-code**: `/apps/web/railway.json`.
4. **Variables**:

   | Variable | Value |
   |---|---|
   | `PORT` | `8080` |
   | `VITE_GAME_SERVER_URL` | `wss://${{game-server.RAILWAY_PUBLIC_DOMAIN}}` |
   | `VITE_API_URL` | `https://${{game-server.RAILWAY_PUBLIC_DOMAIN}}` |

5. **Settings → Networking → Generate Domain**, target port `8080`.

`VITE_*` values are baked into the browser bundle when the image is built, so they must only ever hold
public URLs. Never put a database URL or a secret in a `VITE_` variable.

### 4. Redeploy once

The two services reference each other's public domain, and those domains only exist after step 2.6 and
3.5. Redeploy **both** services once so `ALLOWED_ORIGINS` and `VITE_GAME_SERVER_URL` pick up real values.
(The web build fails on purpose if `VITE_GAME_SERVER_URL` is empty.)

### 5. Check it

1. `https://<game-server-domain>/health` returns `{"status":"ok", ...}`.
2. Open `https://<web-domain>`, create a lobby, and open the invite link on a second computer on a
   different network.
3. Run the race test and the load test against the deployed server (commands above).

From here, every push to `main` redeploys automatically. Each service only rebuilds when its own files or
`packages/shared` change (`watchPatterns` in its `railway.json`).

### PostgreSQL

Phase 1 stores nothing, so no database is required yet. When Phase 3 lands: **New → Database →
PostgreSQL**, then on `game-server` set `DATABASE_URL` to `${{Postgres.DATABASE_URL}}` (Railway's private
network). Migrations will run as a pre-deploy command.

## Environment variables

| Service | Variable | Purpose |
|---|---|---|
| web | `VITE_GAME_SERVER_URL` | Public WebSocket URL of the game server (build time). A bare domain is accepted and treated as `wss://`. |
| web | `VITE_API_URL` | Reserved for the Phase 3 stats API. |
| web | `PORT` | Port Caddy listens on. |
| game-server | `PORT` | Port to listen on. Binds `0.0.0.0`. |
| game-server | `NODE_ENV` | `production` in Railway. |
| game-server | `ALLOWED_ORIGINS` | Comma-separated browser origins allowed to connect. Empty allows any origin (development only). |
| game-server | `DATABASE_URL` | Unused until Phase 3. |
| game-server | `MAX_ROOMS` | Optional. Concurrent lobby cap, default 100. |
| game-server | `MATCHMAKE_PER_MINUTE` | Optional. Create/join requests allowed per IP per minute, default 90. |
| game-server | `LOG_LEVEL` | Optional. `debug` for verbose logs. |

## Operating notes

- **One replica.** Rooms live in the memory of a single process. Do not scale the game server
  horizontally until Redis-backed presence is added (specification section 3, service D).
- **Restarts end races.** On `SIGTERM` the server stops creating lobbies and starting races, tells
  connected players, and exits. Race state is not persisted, so a race in progress during a deploy is lost;
  players create a new lobby afterwards. Deploy between games.
- **Monitoring.** `/health` reports uptime, lobby count, memory, and average and worst simulation tick time.
  Logs are JSON lines: filter on `msg` (`race_finished`, `room_error`, `client_kicked_rate_limit`, ...).
- **Capacity.** A full 12-kart race uses about 0.2 ms of each 33 ms tick and a few percent of one core
  locally, so the suggested 1 vCPU / 1 GB allocation leaves a lot of headroom.

## How the netcode works

- Clients send only inputs: `[sequence, buttons, steer]`, 30 per second. Positions are never accepted
  from a client, so teleporting and speed changes cannot be expressed in the protocol.
- The server advances each kart one tick per input. A kart may run at most three ticks ahead of the
  clock to absorb jitter, so withholding and then flooding inputs gains nothing. With no fresh input a kart
  repeats its last input briefly and then coasts.
- A kart's track position can only move to neighbouring centreline samples, and checkpoints must be
  crossed in order, so cutting the course or reversing over the line never counts as progress.
- Lobby and race metadata (roster, ready flags, laps, places, results) sync as Colyseus schema deltas.
  Kart motion goes out as compact snapshot messages at 15 Hz instead of full state every frame.
- The client predicts its own kart with the same physics code, replays unacknowledged inputs when the
  server's state arrives, and eases out any difference. Other karts are drawn about 110 ms in the past,
  interpolated between snapshots.

## Deliberate departures from the specification

- **Physics engine.** The spec lists "Rapier or an equivalent". This build uses a small purpose-written
  arcade simulation in `packages/shared` instead, because prediction needs the client and server to
  compute identical results from the same inputs, which is simple with shared deterministic code and
  awkward with a general rigid-body engine. Jump ramps and falling off the track are not in Phase 1.
- **Colyseus version.** Pinned to the 0.16 release line (the current major is newer). Upgrading is a
  separate, testable task.
- **Solo start.** The host can start alone for a practice lap; the spec's 2–12 range is otherwise enforced
  (a 13th player is turned away).
- **Joining mid-race.** A lobby is locked while a race runs; latecomers get a clear message and can join
  once results are showing.
