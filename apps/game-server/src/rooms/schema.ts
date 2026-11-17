import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";
import { DEFAULT_TRACK_ID } from "@office-kart/shared";

/**
 * Low-frequency room state, synchronised by Colyseus as binary deltas: lobby
 * membership, ready flags, settings, race phase, laps, places, items, chaos
 * events and results. High-frequency kart motion is NOT here; it travels in
 * compact snapshot messages so only what changes every tick is sent every tick.
 */
export class PlayerState extends Schema {
  @type("string") id = "";
  @type("string") name = "";
  @type("uint8") color = 0;
  @type("uint8") slot = 0;
  @type("boolean") ready = false;
  @type("boolean") connected = true;
  /** True while this player has a kart in the current race. */
  @type("boolean") racing = false;
  @type("uint8") lap = 0;
  @type("uint8") place = 0;
  @type("boolean") finished = false;
  @type("uint32") finishMs = 0;
  @type("uint32") bestLapMs = 0;
  /** Held power-up (0 = none) and how many uses it has left. */
  @type("uint8") item = 0;
  @type("uint8") charges = 0;
  /** Running totals for this lobby session. */
  @type("uint16") wins = 0;
  @type("uint16") points = 0;
  @type("string") vote = "";
  /** A line about this player's race shown on the results screen. */
  @type("string") note = "";
}

export class AwardState extends Schema {
  @type("string") title = "";
  @type("string") name = "";
  @type("string") detail = "";
}

export class RaceState extends Schema {
  @type("string") code = "";
  @type("string") phase = "lobby";
  @type("string") hostId = "";
  @type("string") trackId = DEFAULT_TRACK_ID;
  @type("uint8") laps = 3;
  /** Server epoch milliseconds at which the lights go green. */
  @type("float64") raceStartAt = 0;
  @type("uint16") raceNumber = 0;
  /** 0 Normal, 1 Chaotic, 2 Absolute Mayhem. */
  @type("uint8") chaos = 0;
  /** Current or announced chaos event and the race ticks it runs between. */
  @type("uint8") eventId = 0;
  @type("int32") eventFrom = 0;
  @type("int32") eventTo = 0;
  @type("float32") hzOff = 0;
  @type("float64") voteEndsAt = 0;
  @type([AwardState]) awards = new ArraySchema<AwardState>();
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}
