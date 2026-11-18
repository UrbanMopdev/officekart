export * from "./constants";
export * from "./track";
export * from "./physics";
export * from "./protocol";
export * from "./names";
export * from "./prediction";

import { buildTrack, type Track, type TrackDef } from "./track";
import { CIRCUITS } from "./tracks/circuits";
import { DEFAULT_SPEED_CLASS, weekBounds, weekIndex } from "./constants";
import type { Challenge } from "./protocol";
import { PROVING_GROUNDS } from "./tracks/provingGrounds";

/** Every selectable track, in lobby order. */
export const TRACK_DEFS: Record<string, TrackDef> = {};
for (const def of CIRCUITS) TRACK_DEFS[def.id] = def;

/** Tracks that exist for the automated tests only; they cannot be picked in a lobby. */
export const TEST_TRACK_DEFS: Record<string, TrackDef> = { [PROVING_GROUNDS.id]: PROVING_GROUNDS };

export const DEFAULT_TRACK_ID = CIRCUITS[0].id;

const built = new Map<string, Track>();

/** Build (once) and return the track with the given id. */
export function getTrack(id: string): Track {
  let t = built.get(id);
  if (!t) {
    const def = TRACK_DEFS[id] ?? TEST_TRACK_DEFS[id] ?? CIRCUITS[0];
    t = buildTrack(def);
    built.set(id, t);
  }
  return t;
}

/** This week's time-trial challenge: one track, at the standard speed class, the same for everyone. */
export function weeklyChallenge(now: number): Challenge {
  const week = weekIndex(now);
  const n = CIRCUITS.length;
  const trackId = CIRCUITS[((week % n) + n) % n].id;
  return { week, trackId, speed: DEFAULT_SPEED_CLASS, ...weekBounds(week) };
}
