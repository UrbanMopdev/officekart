export * from "./constants";
export * from "./track";
export * from "./physics";
export * from "./protocol";
export * from "./names";
export * from "./prediction";
export { OFFICE_DASH } from "./tracks/officeDash";
export { NEON_NIGHTS } from "./tracks/neonNights";
export { PROVING_GROUNDS } from "./tracks/provingGrounds";

import { buildTrack, type Track, type TrackDef } from "./track";
import { NEON_NIGHTS } from "./tracks/neonNights";
import { OFFICE_DASH } from "./tracks/officeDash";
import { PROVING_GROUNDS } from "./tracks/provingGrounds";

export const TRACK_DEFS: Record<string, TrackDef> = {
  [OFFICE_DASH.id]: OFFICE_DASH,
  [NEON_NIGHTS.id]: NEON_NIGHTS,
  [PROVING_GROUNDS.id]: PROVING_GROUNDS,
};

export const DEFAULT_TRACK_ID = OFFICE_DASH.id;

const built = new Map<string, Track>();

/** Build (once) and return the track with the given id. */
export function getTrack(id: string): Track {
  let t = built.get(id);
  if (!t) {
    const def = TRACK_DEFS[id] ?? OFFICE_DASH;
    t = buildTrack(def);
    built.set(id, t);
  }
  return t;
}
