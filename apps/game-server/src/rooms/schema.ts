import { MapSchema, Schema, type } from "@colyseus/schema";
import { DEFAULT_TRACK_ID } from "@office-kart/shared";

/**
 * Low-frequency room state, synchronised by Colyseus as binary deltas: lobby
 * membership, ready flags, settings, race phase, laps, places and results.
 * High-frequency kart motion is NOT here; it travels in compact snapshot
 * messages so only what changes every tick is sent every tick.
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
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}
