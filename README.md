# Office Kart

Browser-based 3D kart racing for 2–12 coworkers. Open a link, type a nickname, race.

This repository currently contains **Phase 1** of the specification: a complete online
multiplayer race with a server-authoritative simulation, on two long circuits. Phases 2–4
(power-ups, more tracks and modes, persistent stats, polish) build on it.

## What works today

- Private lobbies with a six-character code and a shareable invite link (`/r/ABC123`)
- 2–12 human racers per lobby, guest nicknames, kart colour selection, ready-up, host settings (track, laps)
- Nine circuits (see Office Kart 2.0 below)
- Elevation and terrain physics: slopes that speed you up and slow you down, banked corners, jumps with
  limited air control, a ravine gap and an open cliff edge with automatic recovery, and six surface
  types (dirt, mud, ice, snow, sand, boost road) that each handle differently
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

Not built yet: Grand Prix / Team Battle / Time Trial modes, characters and kart classes, gamepad
support, PostgreSQL-backed profiles and leaderboards.

## Office Kart 2.0

All seven phases of the 2.0 specification have a working first version. Each was checked with automated
tests before the next was started; none of it has been tuned by people playing yet.

**Tracks.** Four circuits, each drawn corner by corner (`packages/shared/src/tracks/layout.ts`: a layout
is a polygon whose vertices are corners with a chosen radius), so there are real hairpins (about 17 m),
chicanes, esses and sweepers instead of smooth loops:
- *Office Grand Prix*: the home circuit, set in pine forest: bus-stop chicane, double hairpin, table-top jump, slalom on conveyor belts.
- *Volcano Pass*: three stacked hairpins up a 58 m climb, a lava jump on the open crater rim, esses down.
- *Midnight Circuit* (id `neon-circuit`): a floodlit night race with a ramp jump into a braking hairpin, flyovers, two chicanes, laser gates.
- *Frozen Lake*: an icy S, a snowed-in hairpin, and esses over ice that cracks.
The earlier eight looped tracks were removed. Proving Grounds remains as a test-only track.

Corners bank gently about their inside edge. Driving into a wall now costs speed in proportion to the
impact. Surface patches (ice, snow, mud, dirt, oil, belts, boost road) are textured and fade into the road.

**Terrain and physics.** Slopes, banking, jumps, gaps and open edges with recovery, and ten surfaces:
asphalt, dirt, mud, ice, snow, sand, boost road, oil, and conveyors in both directions.

**Moving hazards.** Rollers that sweep the road, runners that travel along it (boulders, a giant
snowball, cross traffic), spinning bars, gates, geysers that launch karts, sections that drop away on a
timer, bridges that slide sideways over a gap, and wind and current zones. Hazard motion is a fixed
function of each kart's own race clock, which travels with its state, so the browser predicts hits
exactly as the server decides them and no hazard positions are sent over the network. A hit spins the
kart out briefly and then protects it for a couple of seconds.

**Under water.** Below a track's water level karts are slower, steer more gently and fall at a third of
normal gravity; holding drift swims upward. Bubbles replace smoke, the view fogs blue and the music is
muffled.

**Power-ups.** 22 items from boxes on the track, weighted by race position, used with Shift. Everything
is resolved on the server.

**Chaos events.** Low Gravity, Slippery Road, Mega Windstorm, Obstacle Frenzy, Double Power-Ups, Meteor
Shower and Thunderstorm, announced four seconds ahead. The host picks Normal, Chaotic or Absolute Mayhem.

**Sound.** Music and effects are synthesised in the browser, so all of it is original. Each track has its
own style, and the music changes for the lobby, countdown, race, final lap and results. Volume sliders
for master, music and effects are in the lobby.

**After the race.** Awards from tracked stats, session points and wins, head-to-head streak messages,
personal bests (per browser), a vote for the next race, and a spectator camera with left/right to switch.

**Speed classes.** The host picks Cruise, Fast, Turbo or Ludicrous in the lobby (1x, 1.2x, 1.4x and
1.65x top speed, acceleration and boosts). Steering does not scale, so each step up makes corners
tighter. New lobbies start on Fast with chaos set to Chaotic. The class is part of the shared
simulation, so the server stays authoritative and prediction matches.

**Skill moves.** All three are decided by the server.
- *Rocket start*: press the accelerator in the last second before the lights go green (the last
  half second is a perfect start). Pressing earlier gives nothing. The server times the press itself.
- *Jump tricks*: tap drift in mid-air; the kart rolls and lands with a boost.
- *Slipstream*: sit 3 to 17 m behind another kart for about 1.3 s and get slung past it.

**Feel.** The view widens and the camera closes in with speed, speed lines streak in from the screen
edges, hard landings and hits thump the camera, and call-outs mark rocket starts, tricks, big drift
turbos, slipstreams, overtakes and the final lap.

**Ghost.** Racing alone, a see-through copy of your own best run on that track, lap count and speed
class drives with you. It is your own recorded driving, stored in the browser. It is not a
computer-controlled racer and nobody else sees it.

**Time trials and leaderboards.** From the front page: *Race the challenge* (this week's track, the same
for everyone, Monday to Sunday Eastern) or *Time trial* (any track and speed class). A trial is solo,
three laps, with no power-ups and no chaos events. The server times the run and records the kart's path;
when it ends the best race time and best lap go on the all-time and this-week boards for that track and
speed class, and the fastest run on the board is replayed as a ghost in the record holder's vehicle. Your
own best is kept as a second ghost. `T` restarts a run. Leaderboard entries belong to a random id kept in
the browser, so a player keeps their entry across sessions on the same device; there are no accounts.

**Vehicles and drivers.** Five vehicles with different top speed, acceleration, handling, drift and
weight (twelve vehicles: two concept cars, a drift car, a motorbike and eight real cars), and ten cosmetic driver looks. The vehicle is part
of the shared simulation; weight decides who gives way in a collision.

**Drifting.** A drift follows an arc of fixed radius at any speed (19 m steering into it, 44 m with the
stick centred, 120 m steering against it), so it corners the same in every speed class. The tail steps
out the moment the button goes down, braking in a drift trims speed without ending it, and on release
the slide snaps straight so the turbo fires where the nose points. Turbo levels charge after 0.55, 1.3
and 2.2 s.

**Vehicle and driver models.** The karts, vehicles and drivers on screen are artist-made models from
Kenney's Car Kit (3.1) and Racing Starter Kit, both Creative Commons Zero; their licence files sit beside
the models in `apps/web/public/models`. `apps/web/src/game/models.ts` loads them at start-up, separates
bodywork, wheels and driver, and repaints one colour swatch per model (bodywork and helmet) in the
player's colour. These kit models are now only the fallback: see "Realistic vehicles" below;
the five drivers are Kenney's kart racers. If the files cannot be fetched the game falls back to the
built-in generated karts. The Motorbike banks into corners; four-wheeled vehicles only roll slightly.

**Photographic landscapes (Frozen Lake, Volcano Pass).** These two tracks are lit by a photographed sky
(a small HDR panorama lights the scene, a sharper copy is drawn behind it) and surfaced with photo-scanned
materials from Poly Haven, all CC0: tarmac, snow, ash, cliff and basalt, plus scanned concrete barriers
and boulders. `apps/web/src/game/materials.ts` projects the ground textures in world space, so the road,
verges and hills share one grain and cliffs are textured from the side; it also holds the frozen-lake,
flowing-lava and settled-snow shaders. The landscape itself is smooth noise shaped around the circuit
(`themes/TerrainTheme.tsx`), and the forest is built from bark-textured trunks and needle-covered bough
cards (`themes/trees.ts`). Asset names and the licence are listed in `apps/web/public/world/CREDITS.txt`.
All four tracks use this pipeline: Office Grand Prix is a forest circuit, Midnight Circuit a moonlit one with
floodlight masts, Frozen Lake and Volcano Pass as named. The tarmac shader adds a rubbered racing line,
repairs, seams and dusty edges; kerbs are chipped, scuffed painted concrete. The earlier office-interior and
neon-city themes are still in `themes/` but no track uses them.

**Realistic vehicles.** The four cars are one model in four trims: Khronos's "Car Concept" sample
(© 2024 Darmstadt Graphics Group GmbH, CC BY 4.0), rebuilt offline into a 27,000-triangle game model with
the interior and Khronos logos removed (`apps/web/public/world/models/car.glb`). Paint is the player's
colour under a clear coat; GT, Hypercar (wing, lowered), Bruiser (matte, larger) and Drift Spec (two-tone,
wing) differ in finish. The Motorbike is built in code from smooth solids on the car's wheels, with a rider
in leathers. Cars are closed, so the driver choice is not visible in them.

**Views.** C (or the button under the ping badge) switches between the chase camera and the driver's
seat. In first person a car's outside is swapped for a built interior (`apps/web/src/game/cockpit.ts`):
dashboard, instrument screen with live speed and gear, a steering wheel that follows the steering, pillars,
mirrors and the bonnet in the car's paint, sized to each car. The camera is fixed to the car, so it pitches
on hills, leans on banking and slides with the tail, with a little head turn into corners and a surface
buzz that is rougher off the tarmac; spins and stunts are not passed on to the camera. The motorbike keeps
its own bodywork. The choice is saved with the other settings.

**Power-ups in reserve.** A racer holds one power-up and up to two more in reserve (`item2`, `item3` in
the room state); the next moves up when the hand is empty. The spinning-bar hazards and the Meteor Shower
event have been retired.

**Classics.** VW Golf II, DeLorean DMC-12 (brushed steel, tinted in the player's colour), Datsun 280Z and
Cadillac Coupe DeVille, all CC BY 4.0, bring the garage to twelve vehicles.

**Everyday cars.** Toyota Corolla, Honda e, Toyota Prius and Toyota Fortuner are community models from
Sketchfab under CC BY 4.0 (the Corolla CC BY-SA 4.0), each rebuilt into a ~25,000-triangle game model with
the game's own paint, glass and wheels; authors and links are in `apps/web/public/world/CREDITS.txt`. They
load in the background after the concept car, and a car is shown as the concept car until its own model
arrives. Only models whose embedded licence could be read were used: several others (a Camry, RAV4,
Vellfire, Supra, Tacoma, Accent) were rejected for a missing, non-commercial or doubtful licence. The eight
vehicles are stat lines in `packages/shared/src/constants.ts`; `VEHICLE_CAR` in `models.ts` maps each to a model.

### Not built, or simplified

- Split paths, alternate routes and hidden shortcuts. Every track has one racing line, so there is no
  Shortcut Master award.
- Elevators, portals and teleport gates, rotating road sections, and tracks that cross over themselves.
- Platforms do not carry karts; a platform is a bridge that slides sideways over a gap.
- Two of the nine chaos events (Lava Surge, Portal Madness), which need routes that open and close.
- Confetti, finish-line camera and celebration animations.
- Rivalries and standings last for a lobby session only. There is still no database.

### Checks

```bash
npm run test:track                                   # geometry of every track
npm run test:physics -w @office-kart/game-server      # a full lap of every track, jumps, falls, water
npm run test:race                                    # 29 network checks
npm run test:speed -w @office-kart/game-server        # every track lapped at every speed class
npm run test:fun -w @office-kart/game-server          # tricks, rocket starts, slipstream, speed classes
npm run test:trial -w @office-kart/game-server        # vehicles, drifting, time trials, leaderboard API
CHAOS_EVENTS=on CHAOS=2 TRACK=chaos-dimension LAPS=1 npm run test:load   # 12 clients, items, mayhem
```

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
- **Proving Grounds**: a mountain landscape generated from the circuit itself, with peaks, pines,
  boulders, a lake, a ravine under the jump and a cliff at the open edge

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
npm run test:physics -w @office-kart/game-server   # hills, jumps, surfaces, falls and recovery
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

Time-trial leaderboards are stored in PostgreSQL. **New → Database → PostgreSQL**, then on `game-server`
set `DATABASE_URL` to `${{Postgres.DATABASE_URL}}` (Railway's private network). The server creates its one
table (`trial_best`) on start. The database URL exists only on the server and is never sent to the browser.

Without `DATABASE_URL`, or if the database cannot be reached, the game still runs and leaderboards are
kept in memory until the next restart. `/health` reports which one is in use (`"scores": "postgres"`).

## Environment variables

| Service | Variable | Purpose |
|---|---|---|
| web | `VITE_GAME_SERVER_URL` | Public WebSocket URL of the game server (build time). A bare domain is accepted and treated as `wss://`. |
| web | `VITE_API_URL` | Reserved for the Phase 3 stats API. |
| web | `PORT` | Port Caddy listens on. |
| game-server | `PORT` | Port to listen on. Binds `0.0.0.0`. |
| game-server | `NODE_ENV` | `production` in Railway. |
| game-server | `ALLOWED_ORIGINS` | Comma-separated browser origins allowed to connect. Empty allows any origin (development only). |
| game-server | `DATABASE_URL` | PostgreSQL connection for time-trial leaderboards. Optional: without it scores are kept in memory only. |
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
