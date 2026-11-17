import type { TrackDef } from "../track";

/**
 * Track 1: Office Dash. A lap around an open-plan office floor between giant
 * desks, mugs and keyboards. Driving direction: along the bottom straight
 * toward +x, up the right side, back through the S-bend, down the left side.
 */
export const OFFICE_DASH: TrackDef = {
  id: "office-dash",
  name: "Office Dash",
  controlPoints: [
    [-10, -70],
    [40, -70],
    [85, -66],
    [112, -40],
    [116, 0],
    [102, 38],
    [70, 62],
    [32, 58],
    [10, 34],
    [-16, 24],
    [-40, 42],
    [-48, 68],
    [-74, 86],
    [-106, 72],
    [-120, 32],
    [-116, -18],
    [-100, -54],
    [-62, -70],
  ],
  roadHalfWidth: 7.5,
  wallHalfWidth: 10.5,
  checkpointCount: 8,
  defaultLaps: 3,
  boostPads: [
    { at: 0.085, lateral: 0, halfWidth: 2.6, length: 7 },
    { at: 0.33, lateral: -3.2, halfWidth: 2.6, length: 7 },
    { at: 0.76, lateral: 3.2, halfWidth: 2.6, length: 7 },
  ],
};
