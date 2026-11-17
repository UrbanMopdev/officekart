import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { DEFAULT_TRACK_ID, FLAG, KART, angleDiff, driftLevel, getTrack } from "@office-kart/shared";
import { net, type KartSample } from "../net/connection";
import { useStore } from "../store";
import { KartVisual } from "./kartVisual";
import { OfficeProps } from "./OfficeProps";
import { TrackMeshes } from "./TrackMeshes";
import { kartActive, kartPos } from "./shared";

const sample: KartSample = { x: 0, z: 0, heading: 0, speed: 0, flags: 0 };
const focus: KartSample = { x: 0, z: 0, heading: 0, speed: 0, flags: 0 };

export function World() {
  const trackId = useStore((s) => s.room?.trackId ?? DEFAULT_TRACK_ID);
  const track = useMemo(() => getTrack(trackId), [trackId]);
  const kartsRef = useRef<THREE.Group>(null);
  const visuals = useRef(new Map<number, KartVisual>());
  const cam = useRef({ heading: 0, race: -1, hudAt: 0 });
  // Smooths the hand-over when our kart stops being predicted locally (at the
  // finish line) and starts being drawn from server snapshots like everyone else's.
  const handoff = useRef({ wasDriving: false, lastX: 0, lastZ: 0, lastH: 0, dx: 0, dz: 0, dh: 0 });

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
      if (mine && driving) {
        net.sampleOwn(alpha, sample);
        const k = net.predictor.state;
        sample.flags =
          (k.driftDir < 0 ? FLAG.DRIFT_LEFT : k.driftDir > 0 ? FLAG.DRIFT_RIGHT : 0) |
          (k.boost > 0 ? FLAG.BOOST : 0) |
          (driftLevel(k.driftCharge) << FLAG.LEVEL_SHIFT);
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

      let v = map.get(p.slot);
      if (!v) {
        v = new KartVisual();
        map.set(p.slot, v);
        group.add(v.group);
      }
      // Name tags get in the way when a kart is right beside the camera.
      const cdx = sample.x - camera.position.x;
      const cdz = sample.z - camera.position.z;
      v.setIdentity(p.name, p.color, !mine && cdx * cdx + cdz * cdz > 110);
      v.update(sample.x, sample.z, sample.heading, sample.speed, sample.flags, dt, time);
      kartPos[p.slot * 2] = sample.x;
      kartPos[p.slot * 2 + 1] = sample.z;
      kartActive[p.slot] = 1;
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

    // Chase camera.
    const c = cam.current;
    let fov = 62;
    if (haveFocus) {
      if (c.race !== room.raceNumber) {
        c.race = room.raceNumber;
        c.heading = focus.heading;
      }
      c.heading += angleDiff(focus.heading, c.heading) * (1 - Math.exp(-dt * 5.5));
      const fx = Math.sin(c.heading);
      const fz = Math.cos(c.heading);
      camera.position.set(focus.x - fx * 8.6, 4.3, focus.z - fz * 8.6);
      camera.lookAt(focus.x + fx * 5, 1.5, focus.z + fz * 5);
      const boost = (focus.flags & FLAG.BOOST) !== 0;
      fov = 64 + Math.min(1, Math.abs(focus.speed) / KART.maxSpeed) * 9 + (boost ? 7 : 0);
    } else {
      // Lobby / nothing to follow: slow fly-around of the circuit.
      c.race = -1;
      const a = time * 0.07;
      camera.position.set(centre.x + Math.sin(a) * 175, 95, centre.z + Math.cos(a) * 175);
      camera.lookAt(centre.x, 0, centre.z);
    }
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov += (fov - camera.fov) * (1 - Math.exp(-dt * 6));
      camera.updateProjectionMatrix();
    }

    // HUD numbers, ten times a second.
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
      <color attach="background" args={["#cfe6ff"]} />
      <fog attach="fog" args={["#cfe6ff", 160, 520]} />
      <hemisphereLight args={["#ffffff", "#94a3b8", 1.5]} />
      <directionalLight position={[80, 140, 50]} intensity={1.7} />
      <TrackMeshes track={track} />
      <OfficeProps track={track} />
      <group ref={kartsRef} />
    </>
  );
}
