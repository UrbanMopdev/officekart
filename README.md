# Office Kart

Browser-based 3D kart racing for 2–12 coworkers. Open a link, type a nickname, race.

This repository currently contains **Phase 1** of the specification: a complete online
multiplayer race with a server-authoritative simulation, on two long circuits. Phases 2–4
(power-ups, more tracks and modes, persistent stats, polish) build on it.

## What works today

- Private lobbies with a six-character code and a shareable invite link (`/r/ABC123`)
- 2–12 human racers per lobby, guest nicknames, kart colour selection, ready-up, host settings (track, laps)
- Two circuits: **Office Dash** (1.9 km, about a minute a lap) and **Neon Nights** (2.5 km, about 80 seconds)
- Server-authoritative racing at 30 Hz: the server simulates every kart from player inputs
- Client-side prediction with server reconciliation for your own kart; interpolation for everyone else's
- Arcade handling: speed-sensitive steering, drifting with three mini-turbo levels, boost pads,
  off-road slowdown, wall and kart-to-kart collisions, kart reset
- Synchronised countdown with start lights, ordered checkpoints, lap counting, live positions, finish
  order, results, rematch
- Disconnect handling: a dropped player's seat is held for 30 seconds and they rejoin the same race
  (including after a page refresh); the host role passes on if the host leaves
- HUD: position, lap, timer, speed, drift charge, mini-map, live standings, latency indicator
- Rate limiting, input validation, origin checks, `/health`, structured logs, graceful shutdown

Not built yet: power-ups, the other three tracks, Grand Prix / Team Battle / Time Trial, characters and
kart classes, audio, gamepad support, PostgreSQL-backed profiles and leaderboards.

## Graphics

Everything on screen is generated in code; the game ships no model or image files.

- Physically based materials, a shadow-casting key light that follows the action, and image-based
  reflections on paint, metal and glass
- HDR rendering with bloom, ambient occlusion, vignette and filmic tone mapping
- A detailed kart: clear-coat paint, spinning and steering wheels, body roll and squat, a driver with
  helmet and visor, tail lights, exhaust flames
- Particles for drift sparks (coloured by charge level), tyre smoke, run-off dust and boost exhaust
- Track dressing: raised kerbs, swept barriers with light strips, start gantry with countdown lights,
  animated boost pads, chevron boards on the outside of tight corners
- **Office Dash**: a full room with windows, ceiling lights and a whiteboard, wooden floor and rugs,
  desks tall enough to race under, and several hundred props (mugs, books, laptops, plants, lamps,
  chairs, filing cabinets)
- **Neon Nights**: an elevated skyway over a city at night, with lit towers, light arches, glowing
  rails, stars and a moon

Static scenery is merged into a few dozen meshes per track, split by map cell so off-screen areas are
skipped. Three quality levels are selectable in the lobby:

| Level | Shadows | Ambient occlusion | Bloom and tone mapping | Resolution scale |
|---|---|---|---|---|
| High | 2048 px | yes | yes | up to 1.75x |
| Medium | 1024 px | no | yes | up to 1.25x |
| Low | blob shadows | no | no | 1x |

The game starts on High and steps down by itself if the frame rate cannot hold, unless the player has
picked a level by hand. To look at a track without a server, open `/?preview=office-dash` or
`/?preview=neon-nights` (add `&at=0.5` to move round the lap, `&q=low` to pick a quality level).

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
                     # (TRACK=neon-nights LAPS=2 to change circuit and distance)
```

`test:race` and `test:load` accept `SERVER_URL` to target a deployed server:

```bash
SERVER_URL=wss://<your-game-server-domain> npm run test:race -w @office-kart/game-server
SERVER_URL=wss://<your-game-server-domain> npm run test:load -w @office-kart/game-server
```

The scripted clients in `apps/game-server/scripts` exist only for these tests. The game itself never adds
computer-controlled racers.

## Deploy to Railway

**Live deployment** (Railway project `office-kart`, auto-deploys from `main`):

- Game: https://web-production-90b775f2.up.railway.app
- Game server health: https://game-server-production-bd421912.up.railway.app/health

Two services from this one repository. Both build from a Dockerfile with the **repository root** as the
build context, because each needs `packages/shared`.

### How the project is set up

Both services are connected to this GitHub repository on the `main` branch, with *Root Directory* left
empty. Their build and deploy settings are set directly on each service in Railway:

| Setting | `game-server` | `web` |
|---|---|---|
| Dockerfile path | `apps/game-server/Dockerfile` | `apps/web/Dockerfile` |
| Healthcheck path | `/health` | `/healthz` |
| Healthcheck timeout | 60 s | 60 s |
| Restart policy | On failure, 10 retries | On failure, 10 retries |
| Public domain target port | 2567 | 8080 |
| Serverless (app sleeping) | Off. A sleeping server drops every race. | default |
| Watch paths | `apps/game-server/**`, `packages/shared/**`, root `package*.json`, `tsconfig.base.json` | `apps/web/**`, `packages/shared/**`, root `package*.json`, `tsconfig.base.json` |

Variables:

| Service | Variable | Value |
|---|---|---|
| game-server | `NODE_ENV` | `production` |
| game-server | `PORT` | `2567` |
| game-server | `ALLOWED_ORIGINS` | `https://${{web.RAILWAY_PUBLIC_DOMAIN}}` |
| web | `PORT` | `8080` |
| web | `VITE_GAME_SERVER_URL` | `wss://${{game-server.RAILWAY_PUBLIC_DOMAIN}}` |
| web | `VITE_API_URL` | `https://${{game-server.RAILWAY_PUBLIC_DOMAIN}}` |

`VITE_*` values are baked into the browser bundle when the image is built, so they must only ever hold
public URLs. Never put a database URL or a secret in a `VITE_` variable. The web build fails on purpose
if `VITE_GAME_SERVER_URL` is empty.

The `railway.json` files under `apps/` record the same settings for reference. Railway only reads a
config file from a service's root directory, so with the root left at the repository root they are not
applied automatically.

### Recreating it from scratch

1. Create a Railway project and two empty services named `game-server` and `web`.
2. Apply the settings and variables from the tables above to each service.
3. Generate a public domain for each service with the target port shown.
4. Connect each service to the GitHub repository, branch `main`. The first build starts immediately.
5. Pick a region close to your players (service Settings, Regions).

### Check it

1. The health URL returns `{"status":"ok", ...}`.
2. Open the game, create a lobby, and open the invite link on a second computer on a different network.
3. Run the race test and the load test against the deployed server (commands above).

Every push to `main` redeploys automatically. Each service only rebuilds when files matching its watch
paths change. Deploying the game server ends any race in progress, so deploy between games.

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
  locally, so the suggested 1 vCPU / 1 GB allocation leaves a lot of headroom. Graphics cost nothing on
  the server: all rendering happens in each player's browser.

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
