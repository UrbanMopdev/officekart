import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { DEFAULT_TRACK_ID, FLAG, KART, angleDiff, driftLevel, getTrack } from "@office-kart/shared";
import { net, type KartSample } from "../net/connection";
import { useStore, type Quality } from "../store";
import { EXHAUST, KartVisual, REAR_LEFT, REAR_RIGHT } from "./kartVisual";
import { ParticleSystem } from "./particles";
import { kartActive, kartPos } from "./shared";
import { NeonTheme } from "./themes/NeonTheme";
import { OfficeTheme } from "./themes/OfficeTheme";
import { TrackSurface } from "./TrackSurface";

const sample: KartSample = { x: 0, z: 0, heading: 0, speed: 0, flags: 0 };
const focus: KartSample = { x: 0, z: 0, heading: 0, speed: 0, flags: 0 };
const v3 = new THREE.Vector3();

/** Spark colours per mini-turbo level (HDR so they bloom). */
const SPARK: [number, number, number][] = [
  [1.2, 1.2, 1.3],
  [0.5, 2.2, 6],
  [6, 2.4, 0.4],
  [6, 0.8, 5],
];

const LIGHTING = {
  office: { sun: "#ffedcc", sunIntensity: 4.4, dir: [0.48, 0.78, 0.4], env: 0.38 },
  neon: { sun: "#9fb6ff", sunIntensity: 0.9, dir: [-0.4, 0.8, 0.3], env: 0.3 },
} as const;

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
  const light = LIGHTING[theme];
  const shadows = quality !== "low";
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  const kartsRef = useRef<THREE.Group>(null);
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const fillA = useRef<THREE.PointLight>(null);
  const fillB = useRef<THREE.PointLight>(null);
  const visuals = useRef(new Map<number, KartVisual>());
  const cam = useRef({ heading: 0, race: -1, hudAt: 0, shake: 0 });
  // Smooths the hand-over when our kart stops being predicted locally (at the
  // finish line) and starts being drawn from server snapshots like everyone else's.
  const handoff = useRef({ wasDriving: false, lastX: 0, lastZ: 0, lastH: 0, dx: 0, dz: 0, dh: 0 });

  const particles = useMemo(() => ({ glow: new ParticleSystem(900, true), smoke: new ParticleSystem(500, false) }), []);
  useEffect(
    () => () => {
      particles.glow.dispose();
      particles.smoke.dispose();
    },
    [particles],
  );

  // Image-based lighting: gives paint, metal and glass something to reflect.
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envScene = new RoomEnvironment();
    const target = pmrem.fromScene(envScene, 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = light.env;
    return () => {
      scene.environment = null;
      target.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, light.env]);

  useEffect(() => {
    if (new URLSearchParams(location.search).has("preview")) (window as unknown as Record<string, unknown>).__ok = { gl, scene };
  }, [gl, scene]);

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
      if (me?.racing) focusSlot = me.slot;
      else {
        let best = 99;
        for (const p of room.players) {
          if (p.racing && p.place > 0 && p.place < best) {
            best = p.place;
            focusSlot = p.slot;
          }
        }
      }
    }

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
          (k.offroad ? FLAG.OFFROAD : 0);
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
        v.setLook({ shadows, underglow: theme === "neon" });
        map.set(p.slot, v);
        group.add(v.group);
      }
      // Name tags get in the way when a kart is right beside the camera.
      const cdx = sample.x - camera.position.x;
      const cdz = sample.z - camera.position.z;
      const camDist2 = cdx * cdx + cdz * cdz;
      v.setIdentity(p.name, p.color, !mine && camDist2 > 110);
      v.update(sample.x, sample.z, sample.heading, sample.speed, sample.flags, dt, time);
      kartPos[p.slot * 2] = sample.x;
      kartPos[p.slot * 2 + 1] = sample.z;
      kartActive[p.slot] = 1;

      // --- Particles (skipped for karts far from the camera)
      if (camDist2 < 220 * 220) {
        const speed = Math.abs(sample.speed);
        const fx = Math.sin(sample.heading);
        const fz = Math.cos(sample.heading);
        const drift = (sample.flags & (FLAG.DRIFT_LEFT | FLAG.DRIFT_RIGHT)) !== 0;
        const level = (sample.flags >> FLAG.LEVEL_SHIFT) & 3;
        if (drift && speed > 5) {
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
                r: c[0], g: c[1], b: c[2], alpha: 1, gravity: 16, drag: 0.6,
              });
            }
            for (let i = count(26, dt); i > 0; i--) {
              particles.smoke.emit({
                x: v3.x, y: v3.y + 0.1, z: v3.z,
                vx: (Math.random() - 0.5) * 1.6, vy: 0.8 + Math.random() * 1.2, vz: (Math.random() - 0.5) * 1.6,
                life: 0.5 + Math.random() * 0.4, size: 0.7, grow: 3.4,
                r: 0.86, g: 0.87, b: 0.9, alpha: 0.26, gravity: -0.6, drag: 1.8,
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
              r: 5, g: 1.7 + Math.random(), b: 0.3, alpha: 0.9, gravity: -1, drag: 1,
            });
          }
        }
        if (offroad && speed > 7 && theme === "office") {
          v.toWorld(Math.random() < 0.5 ? REAR_LEFT : REAR_RIGHT, v3);
          for (let i = count(30, dt); i > 0; i--) {
            particles.smoke.emit({
              x: v3.x, y: v3.y + 0.1, z: v3.z,
              vx: -fx * 2 + (Math.random() - 0.5) * 2, vy: 1.2 + Math.random() * 1.5, vz: -fz * 2 + (Math.random() - 0.5) * 2,
              life: 0.45 + Math.random() * 0.3, size: 0.6, grow: 2.6,
              r: 0.42, g: 0.62, b: 0.4, alpha: 0.3, gravity: 1.5, drag: 1.5,
            });
          }
        }
      }

      if (p.slot === focusSlot) {
        haveFocus = true;
        focus.x = sample.x;
        focus.z = sample.z;
        focus.heading = sample.heading;
        focus.speed = sample.speed;
        focus.flags = sample.flags;
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
      }
      c.heading += angleDiff(focus.heading, c.heading) * (1 - Math.exp(-dt * 5.5));
      const boost = (focus.flags & FLAG.BOOST) !== 0;
      c.shake += ((boost ? 1 : 0) - c.shake) * (1 - Math.exp(-dt * 6));
      const fx = Math.sin(c.heading);
      const fz = Math.cos(c.heading);
      const jx = Math.sin(time * 61) * 0.035 * c.shake;
      const jy = Math.sin(time * 47 + 1.3) * 0.03 * c.shake;
      camera.position.set(focus.x - fx * (8.8 - c.shake * 0.5) + fz * jx, 4.1 + jy, focus.z - fz * (8.8 - c.shake * 0.5) - fx * jx);
      camera.lookAt(focus.x + fx * 6, 1.6, focus.z + fz * 6);
      fov = 62 + Math.min(1, Math.abs(focus.speed) / KART.maxSpeed) * 9 + c.shake * 8;
      lookX = focus.x + fx * 20;
      lookZ = focus.z + fz * 20;
    } else {
      // Lobby / nothing to follow: slow fly-around of the circuit.
      c.race = -1;
      const a = time * 0.05;
      camera.position.set(centre.x + Math.sin(a) * 250, 96, centre.z + Math.cos(a) * 170);
      camera.lookAt(centre.x, 0, centre.z);
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
      sun.target.position.set(lookX, 0, lookZ);
      sun.position.set(lookX + light.dir[0] * 260, light.dir[1] * 260, lookZ + light.dir[2] * 260);
      sun.target.updateMatrixWorld();
    }
    if (fillA.current && fillB.current) {
      // Coloured fill lights ride just behind the camera, one each side, so the
      // karts ahead pick up neon rim light without a hot spot on the road in view.
      const fx = Math.sin(c.heading);
      const fz = Math.cos(c.heading);
      const cx = camera.position.x - fx * 4;
      const cz = camera.position.z - fz * 4;
      fillA.current.position.set(cx + fz * 10, 12, cz - fx * 10);
      fillB.current.position.set(cx - fz * 10, 12, cz + fx * 10);
    }

    const pixelsPerUnit = state.size.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
    particles.glow.update(dt, pixelsPerUnit);
    particles.smoke.update(dt, pixelsPerUnit);

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
      if (hud.speed !== speed || Math.abs(hud.driftCharge - charge) > 0.02 || hud.driftLevel !== level || hud.boosting !== boosting || hud.offroad !== offroad) {
        store.set({ hud: { speed, driftCharge: charge, driftLevel: level, boosting, offroad } });
      }
    }
  });

  return (
    <>
      {theme === "neon" ? <NeonTheme track={track} quality={quality} /> : <OfficeTheme track={track} quality={quality} />}
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
      {theme === "neon" && (
        <>
          <pointLight ref={fillA} color="#22d3ee" intensity={1100} distance={90} decay={2} />
          <pointLight ref={fillB} color="#e879f9" intensity={1100} distance={90} decay={2} />
        </>
      )}
      <TrackSurface track={track} theme={theme} />
      <group ref={kartsRef} />
      <primitive object={particles.smoke.points} />
      <primitive object={particles.glow.points} />
    </>
  );
}
