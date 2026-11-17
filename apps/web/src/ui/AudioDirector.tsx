/**
 * Decides what should be playing: which music for the current screen and
 * track, countdown beeps, engine pitch, and effects for things that happen in
 * the race. Renders nothing.
 */
import { useEffect } from "react";
import { getTrack } from "@office-kart/shared";
import { audio, type MusicState } from "../audio";
import { net } from "../net/connection";
import { useStore } from "../store";

export function AudioDirector() {
  const settings = useStore((s) => s.settings);
  useEffect(() => audio.applySettings(settings), [settings]);

  useEffect(() => {
    const unlock = () => audio.unlock();
    // Phones only allow sound after a completed tap, so listen for the end of one too.
    for (const type of ["pointerdown", "keydown", "touchend", "click"]) window.addEventListener(type, unlock);

    // Keep the screen awake during a race (phones dim after a few seconds without a tap).
    let wake: { release(): Promise<void> } | null = null;
    const keepAwake = async (on: boolean) => {
      try {
        if (on && !wake) wake = await (navigator as unknown as { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock?.request("screen") ?? null;
        if (!on && wake) {
          await wake.release();
          wake = null;
        }
      } catch {
        wake = null;
      }
    };

    const onFx = (fx: { kind: string; slot?: number }) => {
      const st = useStore.getState();
      const mine = st.room?.players.find((p) => p.id === st.myId)?.slot === fx.slot;
      // Your own events at full volume; everyone else's quieter.
      audio.play(fx.kind, mine || fx.slot === undefined ? 1 : 0.35);
    };
    net.fxListeners.add(onFx);

    const last = { beep: 99, lap: 0, place: 0, finished: false, air: false, boost: false, event: 0, water: false, race: -1 };
    const id = setInterval(() => {
      const st = useStore.getState();
      const room = st.room;
      const me = room?.players.find((p) => p.id === st.myId);
      let music: MusicState = "lobby";
      if (!room) music = "lobby";
      else if (room.phase === "countdown") music = "countdown";
      else if (room.phase === "racing") music = me?.racing && !me.finished && me.lap >= room.laps && room.laps > 1 ? "final" : "race";
      else if (room.phase === "results") music = "results";
      audio.setMusic(music, room ? (getTrack(room.trackId).def.music ?? 0) : 8);
      audio.setUnderwater(st.underwater);
      void keepAwake(room?.phase === "countdown" || room?.phase === "racing");

      if (!room || !me) {
        audio.engine(0, false, false, false, false);
        return;
      }
      if (room.raceNumber !== last.race) {
        last.race = room.raceNumber;
        last.lap = 1;
        last.place = 0;
        last.finished = false;
        last.beep = 99;
        last.event = 0;
      }
      // Countdown: three beeps and a long one.
      if (room.phase === "countdown" || room.phase === "racing") {
        const left = room.raceStartAt - net.serverNow();
        const n = left > 0 ? Math.ceil(left / 1000) : 0;
        if (n !== last.beep && n <= 3) {
          last.beep = n;
          if (left > -1500) audio.play(n === 0 ? "go" : "beep");
        }
      }
      const k = net.predictor.state;
      const driving = net.isDriving();
      audio.engine(k.speed, driving, k.boost > 0, k.driftDir !== 0, k.water);
      if (driving) {
        if (k.air && !last.air && !k.water) audio.play("jump");
        if (!k.air && last.air) audio.play(k.water ? "bubbles" : "land");
        if (k.boost > 0 && !last.boost) audio.play("boost");
        if (k.water && !last.water) audio.play("bubbles");
        last.air = k.air;
        last.boost = k.boost > 0;
        last.water = k.water;
      }
      if (room.phase === "racing" && me.racing) {
        if (me.lap > last.lap) audio.play(me.lap >= room.laps ? "final" : "lap");
        last.lap = me.lap;
        if (last.place > 0 && me.place < last.place && !me.finished) audio.play("overtake");
        last.place = me.place;
        if (me.finished && !last.finished) audio.play(me.place === 1 ? "win" : "finish");
        last.finished = me.finished;
        if (room.eventId !== last.event) {
          if (room.eventId !== 0) audio.play("event");
          last.event = room.eventId;
        }
      }
    }, 50);

    return () => {
      clearInterval(id);
      net.fxListeners.delete(onFx);
      for (const type of ["pointerdown", "keydown", "touchend", "click"]) window.removeEventListener(type, unlock);
      void keepAwake(false);
    };
  }, []);

  return null;
}
