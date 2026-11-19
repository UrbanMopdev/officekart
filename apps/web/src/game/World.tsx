import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { worldBackdrop, worldSky } from "./assets";
import { LapDelta } from "./delta";
import type { Cockpit } from "./cockpit";
import { cabinFrost, roadWet } from "./materials";
import { DEFAULT_TRACK_ID, FLAG, FX, KART, angleDiff, driftLevel, getTrack, locate, EVENT } from "@office-kart/shared";
import { net, type KartSample } from "../net/connection";
import { useStore, type Quality } from "../store";
import { EXHAUST, KartVisual, REAR_LEFT, REAR_RIGHT } from "./kartVisual";
import { ParticleSystem } from "./particles";
import { feel, kartActive, kartPos } from "./shared";
import { GhostRecorder, decodeGhost, loadGhost, sampleGhost, type Ghost } from "./ghost";
import { fetchGhost } from "../net/api";
import { SkidMarks } from "./skid";
import { Weather, weatherFor } from "./weather";
import { Hazards } from "./Hazards";
import { TerrainTheme } from "./themes/TerrainTheme";
import { NeonTheme } from "./themes/NeonTheme";
import { OfficeTheme } from "./themes/OfficeTheme";
import { TrackSurface } from "./TrackSurface";

const sample: KartSample = { x: 0, y: 0, z: 0, heading: 0, speed: 0, flags: 0, fx: 0 };
const probe: KartSample = { x: 0, y: 0, z: 0, heading: 0, speed: 0, flags: 0, fx: 0 };
const focus: KartSample = { x: 0, y: 0, z: 0, heading: 0, speed: 0, flags: 0, fx: 0 };
const loc = { idx: 0, along: 0, lateral: 0 };
const v3 = new THREE.Vector3();
const v4 = new THREE.Vector3();
const CONFETTI: [number, number, number][] = [[2.2, 0.5, 0.5], [0.5, 1.6, 2.2], [2.2, 1.8, 0.4], [0.6, 2.1, 0.8], [2, 0.6, 2], [2.2, 2.2, 2.2]];

/** Spark colours per mini-turbo level (HDR so they bloom). */
const SPARK: [number, number, number][] = [
  [1.2, 1.2, 1.3],
  [0.5, 2.2, 6],
  [6, 2.4, 0.4],
  [6, 0.8, 5],
];

const LIGHTING: Record<string, { sun: string; sunIntensity: number; dir: readonly [number, number, number]; env: number }> = {
  sky: { sun: "#fff6e0", sunIntensity: 3.6, dir: [0.5, 0.74, 0.3], env: 0.5 },
  volcano: { sun: "#ffc79c", sunIntensity: 4.2, dir: [0.72, 0.37, 0.58], env: 0.5 },
  frozen: { sun: "#ffe3c2", sunIntensity: 3.6, dir: [0.72, 0.37, 0.58], env: 0.55 },
  jungle: { sun: "#fff0c8", sunIntensity: 3.3, dir: [0.45, 0.78, 0.3], env: 0.4 },
  sea: { sun: "#fff6e0", sunIntensity: 3.6, dir: [0.4, 0.82, 0.3], env: 0.5 },
  chaos: { sun: "#d9b8ff", sunIntensity: 2.6, dir: [0.45, 0.7, 0.4], env: 0.4 },
  office: { sun: "#ffedcc", sunIntensity: 4.4, dir: [0.48, 0.78, 0.4], env: 0.38 },
  neon: { sun: "#9fb6ff", sunIntensity: 0.9, dir: [0.7, 0.5, 0.5], env: 0.3 },
  forest: { sun: "#ffe9cc", sunIntensity: 3.9, dir: [0.72, 0.4, 0.58], env: 0.5 },
  night: { sun: "#b9c9ff", sunIntensity: 1.5, dir: [0.74, 0.42, 0.53], env: 0.4 },
  alpine: { sun: "#fff3da", sunIntensity: 3.8, dir: [0.52, 0.72, 0.32], env: 0.45 },
};

/**
 * Photographed skies. Each lights the scene (so paint, ice and wet tarmac
 * reflect real clouds) and is drawn behind it. The sun in LIGHTING points the
 * same way as the sun or moon in the photograph.
 */
/** ?rain=1 turns the rain on in previews. */
const FORCE_RAIN = typeof location !== "undefined" && new URLSearchParams(location.search).get("rain") === "1";
const FP_POS = new THREE.Vector3();
const FP_QUAT = new THREE.Quaternion();
const FP_TURN = new THREE.Quaternion();
const FP_EULER = new THREE.Euler();
const FP_TURN_BACK = new THREE.Vector3();

const SKIES: Record<string, { name: string; env: number; backdrop: number }> = {
  frozen: { name: "day", env: 0.85, backdrop: 0.75 },
  volcano: { name: "ember", env: 1.5, backdrop: 0.6 },
  neon: { name: "night", env: 1.1, backdrop: 1.6 },
  forest: { name: "day", env: 0.8, backdrop: 0.75 },
  // Moonlight, lifted the way a film shoots night: dark, but you can read the road.
  night: { name: "night", env: 2.4, backdrop: 1.5 },
};

/** How many whole particles to emit this frame for a given rate. */
function count(rate: number, dt: number): number {
  const n = rate * dt;
  const whole = Math.floor(n);
  return whole + (Math.random() < n - whole ? 1 : 0);
}

export function World({ quality }: { quality: Quality }) {
  const trackId = useStore((s) => s.room?.trackId ?? DEFAULT_TRACK_ID);
  const track = useMemo(() => getTrack(trackId), [trackId]);
  const theme = track.def.theme;
  const light = LIGHTING[theme] ?? LIGHTING.alpine;
  const family = theme === "office" ? "office" : theme === "neon" || theme === "sky" ? "neon" : "terrain";
  const shadows = quality !== "low";
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  // A small off-screen picture for the cockpit's rear-view mirror. The image is flipped, as a mirror's is.
  const mirror = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(448, 124, { type: THREE.HalfFloatType });
    target.texture.wrapS = THREE.RepeatWrapping;
    target.texture.repeat.x = -1;
    target.texture.offset.x = 1;
    const camera = new THREE.PerspectiveCamera(26, 448 / 124, 0.5, 900);
    return { target, camera };
  }, []);
  useEffect(() => () => mirror.target.dispose(), [mirror]);

  const kartsRef = useRef<THREE.Group>(null);
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const fillA = useRef<THREE.PointLight>(null);
  const fillB = useRef<THREE.PointLight>(null);
  const cabinGlow = useRef<THREE.PointLight>(null);
  const beam = useRef<THREE.SpotLight>(null);
  const visuals = useRef(new Map<number, KartVisual>());
  const ghost = useRef<{ race: number; best: Ghost | null; rec: GhostRecorder; visual: KartVisual | null; saved: boolean ; champ: Ghost | null; champVisual: KartVisual | null; champLook: { name: string; color: number; vehicle: number; avatar: number } | null }>({ race: -1, best: null, rec: new GhostRecorder(), visual: null, saved: false, champ: null, champVisual: null, champLook: null });
  const cam = useRef({ heading: 0, race: -1, hudAt: 0, shake: 0, y: 0, air: 0, jolt: 0, wasAir: false, wasSpin: false, airFor: 0, eyeNode: null as THREE.Object3D | null, look: 0, steer: 0, fpFresh: true, interior: null as Cockpit | null, mirrorTick: 0, delta: null as LapDelta | null, deltaFor: null as unknown, gLong: 0, gLat: 0, lastSpeed: 0, lastHeading: 0 });
  // Smooths the hand-over when our kart stops being predicted locally (at the
  // finish line) and starts being drawn from server snapshots like everyone else's.
  const fogHome = useRef<{ color: THREE.Color; near: number; far: number } | null>(null);
  useEffect(() => {
    fogHome.current = null;
  }, [theme]);
  const handoff = useRef({ wasDriving: false, lastX: 0, lastZ: 0, lastH: 0, dx: 0, dz: 0, dh: 0 });

  const particles = useMemo(() => ({ glow: new ParticleSystem(900, true), smoke: new ParticleSystem(500, false) }), []);
  useEffect(
    () => () => {
      particles.glow.dispose();
      particles.smoke.dispose();
    },
    [particles],
  );
  // Tyre marks stay on the road for the race; the air carries snow, embers, dust or neon motes.
  const skids = useMemo(() => new SkidMarks(quality === "low" ? 700 : 1600), [quality]);
  useEffect(() => () => skids.dispose(), [skids]);
  const weatherKind = weatherFor(track.def.theme);
  const calm = useStore((s) => s.settings.reducedFx);
  const weather = useMemo(() => (weatherKind && !calm ? new Weather(weatherKind, quality === "low" ? 0.4 : quality === "medium" ? 0.7 : 1) : null), [weatherKind, quality, calm]);
  useEffect(() => () => weather?.dispose(), [weather]);
  // Rain belongs to the weather events, not to a track, so it is kept ready and shown when one is on.
  const rain = useMemo(() => new Weather("rain", quality === "low" ? 0.4 : quality === "medium" ? 0.7 : 1), [quality]);
  useEffect(() => {
    rain.points.visible = false;
    return () => {
      rain.dispose();
      roadWet.value = 0;
    };
  }, [rain]);
  const party = useRef({ race: -1, done: false });

  // Image-based lighting: gives paint, metal and glass something to reflect.
  // Tracks with a photographed sky are lit by it; the rest by a neutral studio.
  useEffect(() => {
    let alive = true;
    const pmrem = new THREE.PMREMGenerator(gl);
    const envScene = new RoomEnvironment();
    const target = pmrem.fromScene(envScene, 0.04);
    const previous = { background: scene.background, intensity: scene.backgroundIntensity };
    scene.environment = target.texture;
    scene.environmentIntensity = light.env;
    const sky = SKIES[theme];
    if (sky) {
      scene.background = worldBackdrop(sky.name);
      // The picture is stored at a quarter brightness to keep its highlights.
      scene.backgroundIntensity = 4 * sky.backdrop;
      void worldSky(sky.name)
        .then((lit) => {
          if (!alive) return;
          scene.environment = lit;
          scene.environmentIntensity = sky.env;
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
      scene.environment = null;
      scene.background = previous.background;
      scene.backgroundIntensity = previous.intensity;
      target.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, light.env, theme]);

  useEffect(() => {
    if (new URLSearchParams(location.search).has("preview")) (window as unknown as Record<string, unknown>).__ok = { gl, scene };
  }, [gl, scene]);

  // While watching (finished, or waiting for the next race) the arrow keys switch racer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "ArrowLeft" && e.code !== "ArrowRight") return;
      const st = useStore.getState();
      const me = st.room?.players.find((p) => p.id === st.myId);
      if (st.room?.phase === "racing" && (!me?.racing || me.finished)) st.set({ spectate: st.spectate + (e.code === "ArrowRight" ? 1 : -1) });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Two directions at right angles to the sunlight, for snapping the shadow map.
  const basis = useMemo(() => {
    const d = new THREE.Vector3(light.dir[0], light.dir[1], light.dir[2]).normalize();
    const r = new THREE.Vector3(0, 1, 0).cross(d).normalize();
    const u = d.clone().cross(r).normalize();
    return { rx: r.x, rz: r.z, ux: u.x, uy: u.y, uz: u.z };
  }, [light]);

  const centre = useMemo(() => {
    let x = 0;
    let z = 0;
    for (let i = 0; i < track.n; i++) {
      x += track.px[i];
      z += track.pz[i];
    }
    return new THREE.Vector3(x / track.n, 0, z / track.n);
  }, [track]);

  useEffect(() => {
    const map = visuals.current;
    return () => {
      for (const v of map.values()) v.dispose();
      map.clear();
      ghost.current.visual?.dispose();
      ghost.current.visual = null;
      ghost.current.champVisual?.dispose();
      ghost.current.champVisual = null;
    };
  }, []);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const time = state.clock.elapsedTime;
    const alpha = net.update(dt);
    const store = useStore.getState();
    const room = store.room;
    const camera = state.camera as THREE.PerspectiveCamera;
    const group = kartsRef.current;
    if (!room || !group) return;

    const driving = net.isDriving();
    const inRace = room.phase !== "lobby";
    const me = room.players.find((p) => p.id === store.myId);

    // Whose kart the camera follows: ours, or the leader's if we are watching.
    let focusSlot = -1;
    if (inRace) {
      if (me?.racing && !(me.finished && room.phase === "racing")) focusSlot = me.slot;
      else {
        // Spectating: cycle through the racers still out there, leader first.
        const others = room.players.filter((p) => p.racing && (!p.finished || room.phase !== "racing")).sort((a, b) => a.place - b.place);
        const list = others.length ? others : room.players.filter((p) => p.racing);
        if (list.length) focusSlot = list[((store.spectate % list.length) + list.length) % list.length].slot;
      }
    }
    const settings = store.settings;

    kartActive.fill(0);
    let haveFocus = false;
    const map = visuals.current;
    for (const p of room.players) {
      if (!inRace || !p.racing) continue;
      const mine = p.id === store.myId;
      let ok = true;
      let offroad = false;
      if (mine && driving) {
        net.sampleOwn(alpha, sample);
        const k = net.predictor.state;
        sample.flags =
          (k.driftDir < 0 ? FLAG.DRIFT_LEFT : k.driftDir > 0 ? FLAG.DRIFT_RIGHT : 0) |
          (k.boost > 0 ? FLAG.BOOST : 0) |
          (driftLevel(k.driftCharge) << FLAG.LEVEL_SHIFT) |
          (k.offroad ? FLAG.OFFROAD : 0) |
          (k.air ? FLAG.AIRBORNE : 0);
        sample.fx =
          (k.spin > 0 ? FX.SPIN : 0) |
          (k.shield > 0 ? FX.SHIELD : 0) |
          (k.phantom > 0 ? FX.PHANTOM : 0) |
          (k.sizeT > 0 ? (k.sizeK > 0 ? FX.GIANT : FX.MINI) : 0) |
          (k.slow > 0 || k.emp > 0 ? FX.SLOW : 0) |
          (k.water ? FX.WATER : 0) |
          (k.trick !== 0 ? FX.TRICK : 0);
        // Slipstreaming is decided by the server, so that one flag comes from its snapshot.
        if (net.sampleKart(p.slot, probe) && (probe.fx & FX.DRAFT) !== 0) sample.fx |= FX.DRAFT;
      } else {
        ok = net.sampleKart(p.slot, sample);
      }
      if (!ok) continue;
      if (mine) {
        const h = handoff.current;
        if (driving) {
          h.dx = h.dz = h.dh = 0;
        } else {
          if (h.wasDriving) {
            h.dx = h.lastX - sample.x;
            h.dz = h.lastZ - sample.z;
            h.dh = angleDiff(h.lastH, sample.heading);
            if (Math.hypot(h.dx, h.dz) > 15) h.dx = h.dz = h.dh = 0;
          }
          const keep = Math.exp(-dt * 3.5);
          h.dx *= keep;
          h.dz *= keep;
          h.dh *= keep;
          sample.x += h.dx;
          sample.z += h.dz;
          sample.heading += h.dh;
        }
        h.wasDriving = driving;
        h.lastX = sample.x;
        h.lastZ = sample.z;
        h.lastH = sample.heading;
      }
      offroad = (sample.flags & FLAG.OFFROAD) !== 0;

      let v = map.get(p.slot);
      if (!v) {
        v = new KartVisual();
        v.setLook({ shadows, underglow: theme === "neon" || theme === "chaos" });
        map.set(p.slot, v);
        group.add(v.group);
      }
      // Name tags get in the way when a kart is right beside the camera.
      const cdx = sample.x - camera.position.x;
      const cdz = sample.z - camera.position.z;
      const camDist2 = cdx * cdx + cdz * cdz;
      v.setIdentity(p.name, p.color, !mine && camDist2 > 110);
      v.setStyle(p.vehicle, p.avatar);
      v.setFirstPerson(mine && store.settings.view === "bonnet");
      // Have the cabin ready before it is asked for, except where every megabyte counts.
      if (mine && quality !== "low") v.preloadView();
      if (mine) {
        cam.current.eyeNode = v.eyeNode;
        cam.current.steer = v.steering;
        cam.current.interior = v.interior;
      }
      // Tilt the kart to the road under it: slope ahead gives pitch, banking gives roll.
      locate(track, sample.x, sample.z, v.hint, loc);
      v.hint = loc.idx;
      const hx = Math.sin(sample.heading);
      const hz = Math.cos(sample.heading);
      const along = hx * track.tx[loc.idx] + hz * track.tz[loc.idx];
      const across = -hz * track.nx[loc.idx] + hx * track.nz[loc.idx];
      const pitch = Math.atan(track.slope[loc.idx] * along + track.bankT[loc.idx] * (hx * track.nx[loc.idx] + hz * track.nz[loc.idx]));
      const roll = Math.atan(track.bankT[loc.idx] * across - track.slope[loc.idx] * (hz * track.tx[loc.idx] - hx * track.tz[loc.idx]));
      v.update(sample.x, sample.y, sample.z, sample.heading, sample.speed, sample.flags, pitch, roll, dt, time, sample.fx);
      const airborne = (sample.flags & FLAG.AIRBORNE) !== 0;
      if (v.wasAir && !airborne && camDist2 < 220 * 220) {
        // Landing: a ring of dust kicked out from under the kart.
        for (let i = 0; i < 26; i++) {
          const a = Math.random() * Math.PI * 2;
          particles.smoke.emit({
            x: sample.x + Math.cos(a) * 0.8, y: sample.y + 0.25, z: sample.z + Math.sin(a) * 0.8,
            vx: Math.cos(a) * (3 + Math.random() * 4), vy: 0.6 + Math.random() * 1.6, vz: Math.sin(a) * (3 + Math.random() * 4),
            life: 0.5 + Math.random() * 0.35, size: 0.8, grow: 3.2,
            r: 0.8, g: 0.76, b: 0.68, alpha: 0.34, gravity: 0.5, drag: 2.4, floor: sample.y,
          });
        }
      }
      v.wasAir = airborne;
      kartPos[p.slot * 2] = sample.x;
      kartPos[p.slot * 2 + 1] = sample.z;
      kartActive[p.slot] = 1;

      // --- Particles (skipped for karts far from the camera)
      if (camDist2 < 220 * 220) {
        const speed = Math.abs(sample.speed);
        const wet = (sample.fx & FX.WATER) !== 0;
        if (wet && speed > 3) {
          // Under water the kart trails bubbles instead of smoke.
          v.toWorld(Math.random() < 0.5 ? REAR_LEFT : REAR_RIGHT, v3);
          for (let i = count(settings.reducedFx ? 10 : 34, dt); i > 0; i--) {
            particles.glow.emit({
              x: v3.x + (Math.random() - 0.5), y: v3.y + 0.3, z: v3.z + (Math.random() - 0.5),
              vx: (Math.random() - 0.5) * 1.5, vy: 2.5 + Math.random() * 3, vz: (Math.random() - 0.5) * 1.5,
              life: 0.8 + Math.random() * 0.6, size: 0.22 + Math.random() * 0.25, grow: 1.5,
              r: 0.7, g: 0.95, b: 1.2, alpha: 0.6, gravity: -3, drag: 0.6, floor: sample.y - 3,
            });
          }
        }
        const fx = Math.sin(sample.heading);
        const fz = Math.cos(sample.heading);
        const drift = !airborne && (sample.flags & (FLAG.DRIFT_LEFT | FLAG.DRIFT_RIGHT)) !== 0;
        skids.track(p.slot, drift && speed > 6 && !wet, v.toWorld(REAR_LEFT, v3), v.toWorld(REAR_RIGHT, v4));
        const level = (sample.flags >> FLAG.LEVEL_SHIFT) & 3;
        if (drift && speed > 5 && !wet) {
          const c = SPARK[level];
          for (const wheel of [REAR_LEFT, REAR_RIGHT]) {
            v.toWorld(wheel, v3);
            for (let i = count(level > 0 ? 55 + level * 25 : 0, dt); i > 0; i--) {
              particles.glow.emit({
                x: v3.x, y: v3.y, z: v3.z,
                vx: -fx * speed * 0.25 + (Math.random() - 0.5) * 6,
                vy: 2 + Math.random() * 5,
                vz: -fz * speed * 0.25 + (Math.random() - 0.5) * 6,
                life: 0.22 + Math.random() * 0.3, size: 0.2 + Math.random() * 0.16, grow: 0.4,
                r: c[0], g: c[1], b: c[2], alpha: 1, gravity: 16, drag: 0.6, floor: sample.y,
              });
            }
            for (let i = count(settings.reducedFx ? 0 : 26, dt); i > 0; i--) {
              particles.smoke.emit({
                x: v3.x, y: v3.y + 0.1, z: v3.z,
                vx: (Math.random() - 0.5) * 1.6, vy: 0.8 + Math.random() * 1.2, vz: (Math.random() - 0.5) * 1.6,
                life: 0.5 + Math.random() * 0.4, size: 0.7, grow: 3.4,
                r: 0.86, g: 0.87, b: 0.9, alpha: 0.26, gravity: -0.6, drag: 1.8, floor: sample.y,
              });
            }
          }
        }
        if ((sample.flags & FLAG.BOOST) !== 0) {
          v.toWorld(EXHAUST, v3);
          for (let i = count(90, dt); i > 0; i--) {
            const side = Math.random() < 0.5 ? -0.3 : 0.3;
            particles.glow.emit({
              x: v3.x + fz * side, y: v3.y, z: v3.z - fx * side,
              vx: -fx * (7 + Math.random() * 5) + (Math.random() - 0.5) * 1.5,
              vy: (Math.random() - 0.3) * 1.5,
              vz: -fz * (7 + Math.random() * 5) + (Math.random() - 0.5) * 1.5,
              life: 0.18 + Math.random() * 0.2, size: 0.55, grow: 0.25,
              r: 5, g: 1.7 + Math.random(), b: 0.3, alpha: 0.9, gravity: -1, drag: 1, floor: sample.y - 5,
            });
          }
        }
        if (offroad && !airborne && !wet && speed > 7 && family !== "neon") {
          v.toWorld(Math.random() < 0.5 ? REAR_LEFT : REAR_RIGHT, v3);
          for (let i = count(30, dt); i > 0; i--) {
            particles.smoke.emit({
              x: v3.x, y: v3.y + 0.1, z: v3.z,
              vx: -fx * 2 + (Math.random() - 0.5) * 2, vy: 1.2 + Math.random() * 1.5, vz: -fz * 2 + (Math.random() - 0.5) * 2,
              life: 0.45 + Math.random() * 0.3, size: 0.6, grow: 2.6,
              r: family === "terrain" ? 0.62 : 0.42, g: family === "terrain" ? 0.55 : 0.62, b: 0.4, alpha: 0.3, gravity: 1.5, drag: 1.5, floor: sample.y,
            });
          }
        }
      }

      if (p.slot === focusSlot) {
        haveFocus = true;
        focus.x = sample.x;
        focus.y = sample.y;
        focus.z = sample.z;
        focus.heading = sample.heading;
        focus.speed = sample.speed;
        focus.flags = sample.flags;
        focus.fx = sample.fx;
      }
    }
    // --- Ghost of your own best run, when racing alone.
    {
      const g = ghost.current;
      if (inRace && g.race !== room.raceNumber) {
        g.race = room.raceNumber;
        g.rec.reset();
        g.saved = false;
        g.best = me?.racing && room.players.filter((p) => p.racing).length === 1 ? loadGhost(room.trackId, room.laps, room.speed) : null;
        if (store.ghostMs !== (g.best?.ms ?? 0)) store.set({ ghostMs: g.best?.ms ?? 0 });
        // Time trial: fetch the record holder's run to race against (this week's leader in the weekly challenge).
        g.champ = null;
        g.champLook = null;
        if (store.champion) store.set({ champion: null });
        if (room.trial) {
          const race = room.raceNumber;
          const { trackId, speed, weekly } = room;
          void (async () => {
            const data = (weekly ? await fetchGhost(trackId, speed, "week") : null) ?? (await fetchGhost(trackId, speed, "all"));
            const run = data ? decodeGhost(data.ms, data.d) : null;
            if (!data || !run || ghost.current.race !== race) return;
            const mine = data.pid === useStore.getState().pid;
            ghost.current.champ = run;
            ghost.current.champLook = { name: mine ? "Your record" : `👑 ${data.name}`, color: data.color, vehicle: data.vehicle, avatar: data.avatar };
            // When the record is yours, one ghost is enough.
            if (mine) ghost.current.best = null;
            useStore.getState().set({ champion: { name: data.name, ms: data.ms, mine }, ...(mine ? { ghostMs: 0 } : {}) });
          })();
        }
      }
      if (driving) {
        const k = net.predictor.state;
        g.rec.record(k.tick, k.x, k.y, k.z, k.heading);
      }
      if (me?.racing && me.finished && me.finishMs > 0 && !g.saved && g.race === room.raceNumber) {
        g.saved = true;
        g.rec.save(room.trackId, room.laps, room.speed, me.finishMs);
      }
      let show = false;
      if (inRace && g.best && room.phase === "racing" && sampleGhost(g.best, net.serverNow() - room.raceStartAt, probe)) {
        const gdx = probe.x - camera.position.x;
        const gdz = probe.z - camera.position.z;
        // Hidden when it would sit right on top of the camera.
        show = gdx * gdx + gdz * gdz > 9;
        if (show) {
          if (!g.visual) {
            g.visual = new KartVisual();
            g.visual.setLook({ shadows: false, underglow: false });
            group.add(g.visual.group);
          }
          // Its name tag would fill the screen when it is right beside the camera.
          g.visual.setIdentity("Your best", me?.color ?? 0, gdx * gdx + gdz * gdz > 110);
          g.visual.setStyle(me?.vehicle ?? 0, me?.avatar ?? 0);
          g.visual.update(probe.x, probe.y, probe.z, probe.heading, probe.speed, 0, 0, 0, dt, time, FX.PHANTOM);
        }
      }
      if (g.visual) g.visual.group.visible = show;
      if (!inRace && g.visual) {
        group.remove(g.visual.group);
        g.visual.dispose();
        g.visual = null;
      }
      // The record holder's ghost, in their own vehicle and colours.
      let showChamp = false;
      if (inRace && g.champ && g.champLook && room.phase === "racing" && sampleGhost(g.champ, net.serverNow() - room.raceStartAt, probe)) {
        const cdx = probe.x - camera.position.x;
        const cdz = probe.z - camera.position.z;
        showChamp = cdx * cdx + cdz * cdz > 9;
        if (showChamp) {
          if (!g.champVisual) {
            g.champVisual = new KartVisual();
            g.champVisual.setLook({ shadows: false, underglow: false });
            group.add(g.champVisual.group);
          }
          g.champVisual.setIdentity(g.champLook.name, g.champLook.color, cdx * cdx + cdz * cdz > 110);
          g.champVisual.setStyle(g.champLook.vehicle, g.champLook.avatar);
          g.champVisual.update(probe.x, probe.y, probe.z, probe.heading, probe.speed, 0, 0, 0, dt, time, FX.PHANTOM);
        }
      }
      if (g.champVisual) g.champVisual.group.visible = showChamp;
      if (!inRace && g.champVisual) {
        group.remove(g.champVisual.group);
        g.champVisual.dispose();
        g.champVisual = null;
      }
    }

    for (const [slot, v] of map) {
      if (!kartActive[slot]) {
        group.remove(v.group);
        v.dispose();
        map.delete(slot);
      }
    }

    // --- Chase camera
    const c = cam.current;
    let fov = 60;
    let lookX = centre.x;
    let lookZ = centre.z;
    if (haveFocus) {
      if (c.race !== room.raceNumber) {
        c.race = room.raceNumber;
        c.heading = focus.heading;
        c.y = focus.y;
      }
      // The camera's height trails the kart's a little, so jumps and drops read as big.
      c.y += (focus.y - c.y) * (1 - Math.exp(-dt * 7));
      c.heading += angleDiff(focus.heading, c.heading) * (1 - Math.exp(-dt * 5.5));
      const boost = (focus.flags & FLAG.BOOST) !== 0;
      c.shake += ((boost && settings.shake ? 1 : 0) - c.shake) * (1 - Math.exp(-dt * 6));
      // Pull back and up a little in the air so jumps read as big.
      const inAir = (focus.flags & FLAG.AIRBORNE) !== 0;
      c.air += ((inAir ? 1 : 0) - c.air) * (1 - Math.exp(-dt * 4));
      // A thump through the camera on hard landings and on getting hit.
      const spun = (focus.fx & FX.SPIN) !== 0;
      if (settings.shake) {
        if (c.wasAir && !inAir && c.airFor > 0.35) c.jolt = Math.min(1, 0.35 + c.airFor * 0.5);
        if (spun && !c.wasSpin) c.jolt = 1;
      }
      c.airFor = inAir ? c.airFor + dt : 0;
      c.wasAir = inAir;
      c.wasSpin = spun;
      c.jolt *= Math.exp(-dt * 7);
      // How fast it should feel: share of this speed class's top speed, and more again while boosting.
      const top = KART.maxSpeed * net.predictor.ctx.speed;
      const pace = Math.min(1.45, Math.abs(focus.speed) / top);
      const rush = Math.max(0, Math.min(1, (pace - 0.82) * 2.2 + c.shake * 0.55));
      feel.rush += (rush - feel.rush) * (1 - Math.exp(-dt * 6));
      feel.draft = (focus.fx & FX.DRAFT) !== 0;
      const fx = Math.sin(c.heading);
      const fz = Math.cos(c.heading);
      const jx = Math.sin(time * 61) * 0.035 * c.shake;
      const jy = Math.sin(time * 47 + 1.3) * 0.03 * c.shake + Math.sin(time * 38) * 0.45 * c.jolt;
      // The camera sits closer and lower the faster the kart goes, and the view widens: both read as speed.
      const back = 8.8 - c.shake * 1.1 - Math.max(0, pace - 0.5) * 1.4 + c.air * 2.6;
      if (settings.view === "bonnet" && c.eyeNode) {
        // First person: the camera is the driver's head, fixed to the car. It pitches on hills,
        // leans on banking and shakes with the surface; the head turns a little into each corner.
        c.eyeNode.updateWorldMatrix(true, false);
        c.eyeNode.getWorldPosition(FP_POS);
        c.eyeNode.getWorldQuaternion(FP_QUAT);
        const steerNow = Math.max(-1, Math.min(1, c.steer));
        c.look += (steerNow * 0.2 - c.look) * (1 - Math.exp(-dt * 4));
        // The driver's head is not bolted to the car: it is thrown forward under braking, pressed back
        // under power and pulled to the outside of a corner, a few centimetres each way.
        if (c.fpFresh) c.gLong = c.gLat = 0;
        else if (dt > 0) {
          const along = Math.max(-28, Math.min(28, (focus.speed - c.lastSpeed) / dt));
          const across = Math.max(-28, Math.min(28, (angleDiff(focus.heading, c.lastHeading) / dt) * focus.speed));
          const ease = 1 - Math.exp(-dt * 5);
          c.gLong += (along - c.gLong) * ease;
          c.gLat += (across - c.gLat) * ease;
        }
        c.lastSpeed = focus.speed;
        c.lastHeading = focus.heading;
        if (cabinGlow.current) {
          // A soft glow over the dashboard and wheel: barely there by day, what you see the cabin by at night.
          cabinGlow.current.position.copy(FP_POS).add(FP_TURN_BACK.set(0, -0.2, 0.32).applyQuaternion(FP_QUAT));
          cabinGlow.current.intensity = theme === "night" || theme === "neon" ? 0.55 : 0.1;
        }
        // In the car's frame +x is its left; turning left (heading rising) throws the head right.
        FP_POS.add(FP_TURN_BACK.set(-c.gLat * 0.0011, -Math.abs(c.gLong) * 0.0003, -c.gLong * 0.0016).applyQuaternion(FP_QUAT));
        FP_EULER.set(-0.03 + c.gLong * 0.0012, Math.PI - c.look, 0, "YXZ");
        FP_QUAT.multiply(FP_TURN.setFromEuler(FP_EULER));
        // A fast, slightly lazy follow: the head lags the car by a few frames, which reads as weight.
        if (c.fpFresh) camera.quaternion.copy(FP_QUAT);
        else camera.quaternion.slerp(FP_QUAT, 1 - Math.exp(-dt * 22));
        c.fpFresh = false;
        // Road feel: a fine buzz that grows with speed, rougher off the tarmac, plus the jolts.
        const buzz = (0.0035 + ((focus.flags & FLAG.OFFROAD) !== 0 ? 0.016 : 0)) * Math.min(1, Math.abs(focus.speed) / 30) + c.shake * 0.02;
        camera.position.set(FP_POS.x + Math.sin(time * 61) * buzz * 0.6, FP_POS.y + Math.sin(time * 47 + 1.3) * buzz + jy * 0.25, FP_POS.z + Math.cos(time * 53) * buzz * 0.6);
        fov = Math.min(98, 74 + pace * 11 + c.shake * 6);
        // Rear-view mirror: a second, small picture of the road behind, redrawn every other frame.
        if (c.interior && quality !== "low") {
          c.interior.setRearView(mirror.target.texture);
          if (c.mirrorTick++ % 2 === 0) {
            c.eyeNode.getWorldQuaternion(mirror.camera.quaternion);
            mirror.camera.position.copy(FP_POS).addScaledVector(FP_TURN_BACK.set(0, 0.15, -2.9).applyQuaternion(mirror.camera.quaternion), 1);
            mirror.camera.updateMatrixWorld();
            const before = gl.getRenderTarget();
            const shadows = gl.shadowMap.autoUpdate;
            gl.shadowMap.autoUpdate = false;
            gl.setRenderTarget(mirror.target);
            gl.render(scene, mirror.camera);
            gl.setRenderTarget(before);
            gl.shadowMap.autoUpdate = shadows;
          }
        } else c.interior?.setRearView(null);
        if (camera.near !== 0.1) {
          camera.near = 0.1;
          camera.updateProjectionMatrix();
        }
      } else {
        if (cabinGlow.current) cabinGlow.current.intensity = 0;
        camera.position.set(focus.x - fx * back + fz * jx, c.y + 4.1 + jy + c.air * 1.4, focus.z - fz * back - fx * jx);
        camera.lookAt(focus.x + fx * 6, focus.y + 1.6, focus.z + fz * 6);
        fov = Math.min(94, 58 + pace * 15 + c.shake * 9 + (net.predictor.ctx.speed - 1) * 9);
        c.fpFresh = true;
        if (camera.near !== 0.4) {
          camera.near = 0.4;
          camera.updateProjectionMatrix();
        }
      }
      lookX = focus.x + fx * 20;
      lookZ = focus.z + fz * 20;
    } else {
      // Lobby / nothing to follow: slow fly-around of the circuit.
      c.race = -1;
      feel.rush = 0;
      feel.draft = false;
      const a = time * 0.05;
      camera.position.set(centre.x + Math.sin(a) * 250, track.maxY + 96, centre.z + Math.cos(a) * 170);
      camera.lookAt(centre.x, track.maxY * 0.4, centre.z);
    }
    if (beam.current) {
      const lamp = beam.current;
      if (haveFocus) {
        const hx = Math.sin(focus.heading);
        const hz = Math.cos(focus.heading);
        // Set higher than a real lamp so the light meets the road at a useful angle and carries down it.
        lamp.position.set(focus.x + hx * 1.7, focus.y + 2.2, focus.z + hz * 1.7);
        lamp.target.position.set(focus.x + hx * 25, focus.y - 0.2, focus.z + hz * 25);
        lamp.target.updateMatrixWorld();
        lamp.intensity = 1400;
      } else lamp.intensity = 0;
    }
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov += (fov - camera.fov) * (1 - Math.exp(-dt * 6));
      camera.updateProjectionMatrix();
    }

    // --- The shadow-casting light follows the action so its map stays sharp.
    const sun = sunRef.current;
    if (sun) {
      const range = haveFocus ? 1 : 3.2;
      const sc = sun.shadow.camera;
      if (sc.right !== 80 * range) {
        sc.left = -80 * range;
        sc.right = 80 * range;
        sc.top = 80 * range;
        sc.bottom = -80 * range;
        sc.updateProjectionMatrix();
      }
      const lookY = haveFocus ? focus.y : track.maxY * 0.4;
      // Move the light in whole shadow-map texels, so shadow edges do not shimmer as it follows the kart.
      const texel = (160 * range) / (quality === "high" ? 2048 : 1024);
      const along = lookX * basis.rx + lookZ * basis.rz;
      const up = lookX * basis.ux + lookY * basis.uy + lookZ * basis.uz;
      const sa = Math.round(along / texel) * texel - along;
      const su = Math.round(up / texel) * texel - up;
      const tx = lookX + basis.rx * sa + basis.ux * su;
      const ty = lookY + basis.uy * su;
      const tz = lookZ + basis.rz * sa + basis.uz * su;
      sun.target.position.set(tx, ty, tz);
      sun.position.set(tx + light.dir[0] * 260, ty + light.dir[1] * 260, tz + light.dir[2] * 260);
      sun.target.updateMatrixWorld();
    }
    if (fillA.current && fillB.current) {
      // Coloured fill lights ride just behind the camera, one each side, so the
      // karts ahead pick up neon rim light without a hot spot on the road in view.
      const fx = Math.sin(c.heading);
      const fz = Math.cos(c.heading);
      const cx = camera.position.x - fx * 4;
      const cz = camera.position.z - fz * 4;
      fillA.current.position.set(cx + fz * 10, camera.position.y + 8, cz - fx * 10);
      fillB.current.position.set(cx - fz * 10, camera.position.y + 8, cz + fx * 10);
    }

    // Below the water line: thick blue fog and a tint on the HUD.
    const under = camera.position.y < track.waterLevel - 0.3;
    if (under !== store.underwater) store.set({ underwater: under });
    const fog = state.scene.fog as THREE.Fog | null;
    if (fog) {
      if (!fogHome.current) fogHome.current = { color: fog.color.clone(), near: fog.near, far: fog.far };
      const home = fogHome.current;
      if (under) {
        fog.color.set("#0b5a8a");
        fog.near = 4;
        fog.far = 150;
      } else {
        fog.color.copy(home.color);
        fog.near = home.near;
        fog.far = home.far;
      }
    }

    const pixelsPerUnit = state.size.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
    // Confetti when you cross the line.
    if (party.current.race !== room.raceNumber) {
      party.current = { race: room.raceNumber, done: false };
      skids.clear();
    }
    if (me?.finished && !party.current.done && inRace) {
      party.current.done = true;
      const px = kartPos[me.slot * 2];
      const pz = kartPos[me.slot * 2 + 1];
      for (let i = 0; i < (settings.reducedFx ? 60 : 220); i++) {
        const a = Math.random() * Math.PI * 2;
        const c = CONFETTI[i % CONFETTI.length];
        particles.glow.emit({
          x: px + Math.cos(a) * 2, y: camera.position.y + 1 + Math.random() * 3, z: pz + Math.sin(a) * 2,
          vx: Math.cos(a) * (2 + Math.random() * 7), vy: 3 + Math.random() * 7, vz: Math.sin(a) * (2 + Math.random() * 7),
          life: 1.6 + Math.random() * 1.4, size: 0.2 + Math.random() * 0.22, grow: 1,
          r: c[0], g: c[1], b: c[2], alpha: 1, gravity: 7, drag: 1.1, floor: -1e3,
        });
      }
    }
    weather?.update(dt, time, camera.position);
    {
      const ev = net.predictor.ctx;
      const tickNow = net.raceTick();
      const raining = FORCE_RAIN || ((ev.event === EVENT.SLIPPERY || ev.event === EVENT.STORM) && tickNow >= ev.from && tickNow < ev.to);
      roadWet.value += ((raining ? 1 : 0) - roadWet.value) * Math.min(1, dt * (raining ? 0.6 : 0.12));
      cabinFrost.value = theme === "frozen" ? 1 : 0;
      rain.points.visible = raining;
      if (raining) rain.update(dt, time, camera.position);
    }
    particles.glow.update(dt, pixelsPerUnit);
    particles.smoke.update(dt, pixelsPerUnit);

    // --- Lap delta against your own best, measured every frame
    if (driving) {
      const state = net.predictor.state;
      if (!c.delta || c.deltaFor !== track) {
        c.delta = new LapDelta(track.def.id, net.predictor.ctx.speed);
        c.deltaFor = track;
      }
      c.delta.update((((state.pos % track.length) + track.length) % track.length) / track.length, performance.now());
    } else if (!net.predictor.state.speed && c.delta && store.room?.phase !== "racing") c.delta = null;

    // --- HUD numbers, ten times a second
    if (time - c.hudAt > 0.1) {
      c.hudAt = time;
      const k = net.predictor.state;
      const hud = store.hud;
      const speed = driving ? Math.round(Math.abs(k.speed) * 3.6) : 0;
      const charge = driving && k.driftDir !== 0 ? Math.min(1, k.driftCharge / KART.driftLevels[2]) : 0;
      const level = driving && k.driftDir !== 0 ? driftLevel(k.driftCharge) : 0;
      const boosting = driving && k.boost > 0;
      const offroad = driving && k.offroad;
      const delta = driving && c.delta && c.delta.value !== null ? Math.round(c.delta.value * 100) / 100 : null;
      if (hud.speed !== speed || Math.abs(hud.driftCharge - charge) > 0.02 || hud.driftLevel !== level || hud.boosting !== boosting || hud.offroad !== offroad || hud.delta !== delta) {
        store.set({ hud: { speed, driftCharge: charge, driftLevel: level, boosting, offroad, delta } });
      }
    }
  });

  return (
    <>
      {family === "neon" ? <NeonTheme track={track} quality={quality} /> : family === "terrain" ? <TerrainTheme track={track} quality={quality} /> : <OfficeTheme track={track} quality={quality} />}
      <Hazards track={track} />
      <directionalLight
        ref={sunRef}
        color={light.sun}
        intensity={light.sunIntensity}
        castShadow={shadows}
        shadow-mapSize={quality === "high" ? [2048, 2048] : [1024, 1024]}
        shadow-bias={-0.0006}
        shadow-normalBias={0.06}
      >
        <orthographicCamera attach="shadow-camera" args={[-80, 80, 80, -80, 20, 700]} />
      </directionalLight>
      {/* Instrument lighting for the driver's view: always in the scene (so switching views never
          changes the number of lights), but dark unless you are in the seat. */}
      <pointLight ref={cabinGlow} color="#c9dcff" intensity={0} distance={2.6} decay={2} />
      {/* Your own headlights on the night circuits: a wide beam thrown down the road ahead. */}
      {(theme === "night" || theme === "neon") && <spotLight ref={beam} color="#fff1d0" intensity={0} distance={110} angle={0.5} penumbra={0.75} decay={1.3} />}
      {theme === "neon" && (
        <>
          <pointLight ref={fillA} color="#22d3ee" intensity={1100} distance={90} decay={2} />
          <pointLight ref={fillB} color="#e879f9" intensity={1100} distance={90} decay={2} />
        </>
      )}
      <TrackSurface track={track} theme={theme} />
      <group ref={kartsRef} />
      <primitive object={skids.mesh} />
      {weather && <primitive object={weather.points} />}
      <primitive object={rain.points} />
      <primitive object={particles.smoke.points} />
      <primitive object={particles.glow.points} />
    </>
  );
}
