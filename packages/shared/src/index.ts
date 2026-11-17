export * from "./constants";
export * from "./track";
export * from "./physics";
export * from "./protocol";
export * from "./names";
export * from "./prediction";

import { buildTrack, type Track, type TrackDef } from "./track";
import { CHAOS_TRACKS } from "./tracks/chaosTracks";
import { PROVING_GROUNDS } from "./tracks/provingGrounds";

/** Every selectable track, in lobby order: the eight circuits, then the test track. */
export const TRACK_DEFS: Record<string, TrackDef> = {};
for (const def of [...CHAOS_TRACKS, PROVING_GROUNDS]) TRACK_DEFS[def.id] = def;

export const DEFAULT_TRACK_ID = CHAOS_TRACKS[0].id;

const built = new Map<string, Track>();

/** Build (once) and return the track with the given id. */
export function getTrack(id: string): Track {
  let t = built.get(id);
  if (!t) {
    const def = TRACK_DEFS[id] ?? CHAOS_TRACKS[0];
    t = buildTrack(def);
    built.set(id, t);
  }
  return t;
}
