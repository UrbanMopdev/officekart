/**
 * Power-ups, things left on the track, and chaos events. All of it is decided
 * here on the server; clients only draw what they are told about.
 */
import { CLEAN_ITEMS, DT, ENTITY, EVENT, ITEMS, hitKart, kartRadius, respawnKart, wrapDelta, type KartState, type Track } from "@office-kart/shared";

export interface Entity {
  id: number;
  type: number;
  x: number;
  y: number;
  z: number;
  aux: number;
  /** Lap position in samples and sideways offset, for things that move along the road. */
  pos: number;
  lat: number;
  owner: string;
  target: string;
  /** Ticks left, and ticks until it can hit its owner. */
  ttl: number;
  arm: number;
}

export interface ItemRacer {
  id: string;
  slot: number;
  kart: KartState;
  travel: number;
  cpCount: number;
  finished: boolean;
  item: number;
  charges: number;
  /** Set when an item (not a track hazard) caused the current spin. */
  itemSpin: boolean;
  stats: { itemHits: number };
}

/** Power-ups that do something even with nobody else on the track. */
const SOLO_ITEMS = [1, 1, 7, 7, 10, 5, 8, 12, 12, 14, 15, 16, 19, 19];

export function rollItem(place: number, racers: number, chaos = 1): number {
  if (racers <= 1) return SOLO_ITEMS[Math.floor(Math.random() * SOLO_ITEMS.length)];
  const f = racers > 1 ? (place - 1) / (racers - 1) : 0.5;
  const col = f < 0.34 ? 0 : f < 0.67 ? 1 : 2;
  // A clean race keeps to the straightforward power-ups.
  const pool = chaos === 0 ? ITEMS.filter((it) => CLEAN_ITEMS.includes(it.id)) : ITEMS;
  let total = 0;
  for (const it of pool) total += it.w[col];
  let t = Math.random() * total;
  for (const it of pool) {
    t -= it.w[col];
    if (t < 0) return it.id;
  }
  return 1;
}

export class ItemWorld {
  entities: Entity[] = [];
  private nextId = 1;
  /** Called for one-off happenings the clients turn into sound and effects. */
  onFx: (fx: { kind: string; slot?: number; x?: number; y?: number; z?: number; item?: number }) => void = () => {};

  constructor(private track: Track) {}

  reset(track: Track): void {
    this.track = track;
    this.entities = [];
  }

  /** World position of a point `pos` samples round the lap, `lat` metres to the right. */
  private place(e: Entity): void {
    const t = this.track;
    const f = ((e.pos % t.n) + t.n) % t.n;
    const i = Math.floor(f);
    const j = (i + 1) % t.n;
    const k = f - i;
    e.x = t.px[i] + (t.px[j] - t.px[i]) * k + t.nx[i] * e.lat;
    e.z = t.pz[i] + (t.pz[j] - t.pz[i]) * k + t.nz[i] * e.lat;
    e.y = t.hy[i] + (t.hy[j] - t.hy[i]) * k + e.lat * t.bankT[i];
  }

  spawn(type: number, pos: number, lat: number, owner: string, ttlSeconds: number, extra: Partial<Entity> = {}): Entity {
    const e: Entity = { id: this.nextId++, type, x: 0, y: 0, z: 0, aux: 0, pos, lat, owner, target: "", ttl: Math.round(ttlSeconds / DT), arm: 30, ...extra };
    this.place(e);
    this.entities.push(e);
    return e;
  }

  private lateralOf(k: KartState): number {
    const t = this.track;
    return (k.x - t.px[k.idx]) * t.nx[k.idx] + (k.z - t.pz[k.idx]) * t.nz[k.idx];
  }

  /** An item or entity hits a racer. Returns true if it took effect. */
  hit(target: ItemRacer, by: ItemRacer | null): boolean {
    if (target.finished || !hitKart(target.kart)) return false;
    target.itemSpin = true;
    if (by && by !== target) by.stats.itemHits++;
    this.onFx({ kind: "hit", slot: target.slot, x: target.kart.x, y: target.kart.y, z: target.kart.z });
    return true;
  }

  private near(from: ItemRacer, racers: ItemRacer[], radius: number): ItemRacer[] {
    return racers.filter((r) => r !== from && !r.finished && Math.hypot(r.kart.x - from.kart.x, r.kart.z - from.kart.z) < radius && Math.abs(r.kart.y - from.kart.y) < 6);
  }

  /** The racer directly ahead of `r` on the road, if any. */
  private ahead(r: ItemRacer, racers: ItemRacer[]): ItemRacer | null {
    let best: ItemRacer | null = null;
    for (const o of racers) {
      if (o === r || o.finished || o.travel <= r.travel) continue;
      if (!best || o.travel < best.travel) best = o;
    }
    return best;
  }

  /** Use the racer's held item. */
  use(r: ItemRacer, racers: ItemRacer[]): void {
    const k = r.kart;
    const t = this.track;
    const item = r.item;
    if (!item || r.finished) return;
    const lat = this.lateralOf(k);
    const blast = (x: number, y: number, z: number, radius: number) => {
      const e = this.spawn(ENTITY.BLAST, k.pos, 0, r.id, 0.45, { aux: radius });
      e.x = x;
      e.y = y;
      e.z = z;
    };
    const ahead = this.ahead(r, racers);
    switch (item) {
      case 1:
        k.boost = Math.max(k.boost, 1.6);
        break;
      case 7:
        k.boost = Math.max(k.boost, 1.15);
        break;
      case 10:
        k.boost = Math.max(k.boost, 3.2);
        break;
      case 2:
        this.spawn(ENTITY.SLIME, k.pos - 2.5, lat, r.id, 45);
        break;
      case 17:
        for (let i = 0; i < 3; i++) this.spawn(ENTITY.BANANA, k.pos - 2.5 - i * 2.2, Math.max(-6.5, Math.min(6.5, lat + (i - 1) * 2.6)), r.id, 45);
        break;
      case 22:
        this.spawn(ENTITY.DECOY, k.pos - 2.5, lat, r.id, 60);
        break;
      case 3:
        this.spawn(ENTITY.ORB, k.pos + 2, lat, r.id, 9, { target: ahead ? ahead.id : "", arm: 9999 });
        break;
      case 12:
        for (const off of [-3, 0, 3]) this.spawn(ENTITY.ROCKET, k.pos + 2, Math.max(-7, Math.min(7, lat + off)), r.id, 2.4, { arm: 9999 });
        break;
      case 14:
        this.spawn(ENTITY.TORNADO, k.pos + 6, 0, r.id, 9, { arm: 9999 });
        break;
      case 4:
        for (const o of this.near(r, racers, 14)) this.hit(o, r);
        blast(k.x, k.y, k.z, 14);
        break;
      case 20: {
        const e = this.spawn(ENTITY.BLAST, k.pos + 11, lat * 0.5, r.id, 0.45, { aux: 11 });
        for (const o of racers) if (o !== r && Math.hypot(o.kart.x - e.x, o.kart.z - e.z) < 11 && Math.abs(o.kart.y - e.y) < 6) this.hit(o, r);
        break;
      }
      case 21:
        for (const o of this.near(r, racers, 16)) {
          if (o.kart.phantom > 0) continue;
          o.kart.air = true;
          o.kart.vy = 15;
          o.kart.y += 0.25;
        }
        blast(k.x, k.y, k.z, 16);
        break;
      case 18:
        for (const o of this.near(r, racers, 22)) o.kart.emp = 3.2;
        blast(k.x, k.y, k.z, 22);
        break;
      case 11:
        for (const o of this.near(r, racers, 30)) {
          if (o.kart.shield > 0 || o.kart.phantom > 0) continue;
          o.kart.slow = Math.max(o.kart.slow, 2.4);
          o.kart.speed *= 0.7;
        }
        break;
      case 6:
        for (const o of racers) {
          if (o === r || o.finished || o.travel <= r.travel || o.kart.phantom > 0) continue;
          if (o.kart.shield > 0) o.kart.shield = 0;
          else o.kart.slow = Math.max(o.kart.slow, 3);
        }
        break;
      case 13:
        if (ahead && ahead.kart.phantom <= 0) {
          if (ahead.kart.shield > 0) ahead.kart.shield = 0;
          else ahead.kart.reverse = 4;
        }
        break;
      case 5:
        k.shield = 10;
        break;
      case 8:
        k.phantom = 6;
        break;
      case 15:
        k.sizeK = 1;
        k.sizeT = 7;
        break;
      case 16:
        k.sizeK = -1;
        k.sizeT = 8;
        break;
      case 9:
        if (ahead) {
          // Trade places on the road, and trade race progress with it.
          const a = k;
          const b = ahead.kart;
          for (const key of ["x", "z", "y", "heading", "vAngle", "idx", "pos", "safe", "vy"] as const) {
            const tmp = a[key];
            a[key] = b[key];
            b[key] = tmp;
          }
          const air = a.air;
          a.air = b.air;
          b.air = air;
          [r.travel, ahead.travel] = [ahead.travel, r.travel];
          [r.cpCount, ahead.cpCount] = [ahead.cpCount, r.cpCount];
          a.immune = Math.max(a.immune, 1.2);
          b.immune = Math.max(b.immune, 1.2);
        } else {
          k.boost = Math.max(k.boost, 1.6);
        }
        break;
      case 19: {
        // Warp up the road to the first sample that is safe to land on.
        let dest = -1;
        for (let step = 14; step < 40; step++) {
          const i = (k.idx + step) % t.n;
          if (!t.gap[i] && !t.dyn[i] && !t.unsafe[i]) {
            dest = i;
            break;
          }
        }
        if (dest >= 0 && !k.air) {
          const keepSpeed = k.speed;
          const before = k.pos;
          respawnKart(k, t, dest);
          k.speed = keepSpeed;
          k.immune = 0.8;
          r.travel += wrapDelta(k.pos, before, t.n);
        } else {
          k.boost = Math.max(k.boost, 1.6);
        }
        break;
      }
    }
    this.onFx({ kind: "item", slot: r.slot, item, x: k.x, y: k.y, z: k.z });
    r.charges = Math.max(0, r.charges - 1);
    if (r.charges === 0) r.item = 0;
  }

  /** Advance everything on the track by one tick. */
  step(racers: ItemRacer[]): void {
    const t = this.track;
    const byId = new Map(racers.map((r) => [r.id, r]));
    for (let n = this.entities.length - 1; n >= 0; n--) {
      const e = this.entities[n];
      e.ttl--;
      if (e.arm > 0) e.arm--;
      let gone = e.ttl <= 0;
      const owner = byId.get(e.owner) ?? null;
      if (e.type === ENTITY.SLIME || e.type === ENTITY.BANANA || e.type === ENTITY.DECOY) {
        for (const r of racers) {
          if (r.finished || (r.id === e.owner && e.arm > 0) || r.kart.air) continue;
          const reach = 1.5 + kartRadius(r.kart);
          if (Math.hypot(r.kart.x - e.x, r.kart.z - e.z) < reach && Math.abs(r.kart.y - e.y) < 2.5) {
            this.hit(r, owner);
            gone = true;
            break;
          }
        }
      } else if (e.type === ENTITY.ORB || e.type === ENTITY.ROCKET) {
        e.pos += ((e.type === ENTITY.ORB ? 56 : 62) * DT) / t.spacing;
        const target = byId.get(e.target);
        if (e.type === ENTITY.ORB && target && !target.finished) {
          // Slide across the road toward the target as it closes in.
          const want = this.lateralOf(target.kart);
          e.lat += Math.max(-0.5, Math.min(0.5, want - e.lat));
        }
        this.place(e);
        e.y += 1;
        for (const r of racers) {
          if (r.id === e.owner || r.finished) continue;
          if (Math.hypot(r.kart.x - e.x, r.kart.z - e.z) < 2.6 + kartRadius(r.kart) && Math.abs(r.kart.y - e.y) < 4) {
            this.hit(r, owner);
            gone = true;
            break;
          }
        }
      } else if (e.type === ENTITY.TORNADO) {
        e.pos += (38 * DT) / t.spacing;
        e.lat = 5.5 * Math.sin(e.ttl * 0.09);
        this.place(e);
        for (const r of racers) {
          if (r.id === e.owner || r.finished) continue;
          if (Math.hypot(r.kart.x - e.x, r.kart.z - e.z) < 3.4 + kartRadius(r.kart) && Math.abs(r.kart.y - e.y) < 6 && this.hit(r, owner)) {
            r.kart.air = true;
            r.kart.vy = 13;
            r.kart.y += 0.25;
          }
        }
      } else if (e.type === ENTITY.METEOR) {
        e.aux = e.ttl;
        if (e.ttl <= 0) {
          for (const r of racers) if (!r.finished && Math.hypot(r.kart.x - e.x, r.kart.z - e.z) < 6 && Math.abs(r.kart.y - e.y) < 6) this.hit(r, null);
          const b = this.spawn(ENTITY.BLAST, e.pos, e.lat, "", 0.45, { aux: 7 });
          b.x = e.x;
          b.y = e.y;
          b.z = e.z;
          this.onFx({ kind: "impact", x: e.x, y: e.y, z: e.z });
        }
      }
      if (gone) this.entities.splice(this.entities.indexOf(e), 1);
    }
  }

  /** Meteor Shower and Thunderstorm: mark a spot a little way ahead of a random racer. */
  strike(racers: ItemRacer[]): void {
    const live = racers.filter((r) => !r.finished);
    if (live.length === 0) return;
    const r = live[Math.floor(Math.random() * live.length)];
    this.spawn(ENTITY.METEOR, r.kart.pos + 14 + Math.random() * 26, (Math.random() - 0.5) * 12, "", 1.6);
  }

  /** Flat list for snapshots: [id, type, x, y, z, aux] per entity. */
  pack(): number[] {
    const out: number[] = [];
    for (const e of this.entities) out.push(e.id, e.type, Math.round(e.x * 100) / 100, Math.round(e.y * 100) / 100, Math.round(e.z * 100) / 100, e.aux);
    return out;
  }
}

/** Seconds between chaos events for each intensity level, and the chance one actually fires. */
export const CHAOS_PACE = [
  // A clean race has no weather or other race-wide events.
  { min: 50, max: 80, chance: 0, seconds: 11 },
  { min: 26, max: 38, chance: 1, seconds: 12 },
  { min: 14, max: 21, chance: 1, seconds: 14 },
];

export function pickEvent(previous: number): number {
  // Meteor Shower is retired: it still exists, but is never drawn.
  const all = [EVENT.LOW_GRAVITY, EVENT.SLIPPERY, EVENT.WIND, EVENT.FRENZY, EVENT.DOUBLE, EVENT.STORM];
  const pool = all.filter((e) => e !== previous);
  return pool[Math.floor(Math.random() * pool.length)];
}
