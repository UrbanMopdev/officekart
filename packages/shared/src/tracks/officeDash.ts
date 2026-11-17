import type { TrackDef } from "../track";

/**
 * Track 1: Office Dash. A long lap of an open-plan office floor: under desks,
 * round giant mugs and keyboards, through an S-bend past the windows.
 * Driving direction: along the bottom straight toward +x, then clockwise-ish
 * through the infield loops and back down the left side.
 */
export const OFFICE_DASH: TrackDef = {
  id: "office-dash",
  name: "Office Dash",
  difficulty: "Medium",
  theme: "office",
  blurb: "A sunlit lap of the office floor, under the desks and round the coffee mugs.",
  controlPoints: [
    [-40, -170],
    [60, -170],
    [160, -168],
    [230, -150],
    [262, -100],
    [262, -40],
    [240, 10],
    [190, 30],
    [140, 10],
    [120, -40],
    [90, -85],
    [40, -100],
    [-10, -80],
    [-30, -35],
    [-10, 10],
    [40, 35],
    [80, 70],
    [95, 125],
    [50, 168],
    [-30, 172],
    [-110, 160],
    [-150, 120],
    [-130, 70],
    [-150, 25],
    [-200, 5],
    [-262, -30],
    [-250, -100],
    [-215, -150],
    [-150, -170],
  ],
  roadHalfWidth: 7.5,
  wallHalfWidth: 10.5,
  checkpointCount: 16,
  defaultLaps: 3,
  boostPads: [
    { at: 0.045, lateral: 0, halfWidth: 2.6, length: 7 },
    { at: 0.2, lateral: -3.4, halfWidth: 2.6, length: 7 },
    { at: 0.37, lateral: 3.4, halfWidth: 2.6, length: 7 },
    { at: 0.55, lateral: 0, halfWidth: 2.6, length: 7 },
    { at: 0.7, lateral: -3.4, halfWidth: 2.6, length: 7 },
    { at: 0.88, lateral: 3.4, halfWidth: 2.6, length: 7 },
  ],
};
