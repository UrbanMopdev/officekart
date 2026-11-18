/**
 * Draws a circuit from its corners. A layout is a closed polygon; each vertex
 * is one corner with the radius it should be driven at. Straights are the
 * polygon's edges, so a hairpin is a sharp vertex with a small radius and a
 * chicane is a short zig-zag. The result is the list of centreline control
 * points the track builder takes.
 */
export type Corner = [x: number, z: number, radius: number];

export function rounded(corners: Corner[], opts: { scale?: number; startAt?: number } = {}): [number, number][] {
  const k = opts.scale ?? 1;
  const n = corners.length;
  const pts = corners.map(([x, z, r]) => ({ x: x * k, z: z * k, r }));
  const arcs: { a: [number, number]; b: [number, number]; mid: [number, number][]; t: number }[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n];
    const v = pts[i];
    const q = pts[(i + 1) % n];
    const l1 = Math.hypot(v.x - p.x, v.z - p.z);
    const l2 = Math.hypot(q.x - v.x, q.z - v.z);
    const d1 = [(v.x - p.x) / l1, (v.z - p.z) / l1];
    const d2 = [(q.x - v.x) / l2, (q.z - v.z) / l2];
    const cross = d1[0] * d2[1] - d1[1] * d2[0];
    const theta = Math.acos(Math.max(-1, Math.min(1, d1[0] * d2[0] + d1[1] * d2[1])));
    const t = v.r * Math.tan(theta / 2);
    const a: [number, number] = [v.x - d1[0] * t, v.z - d1[1] * t];
    const b: [number, number] = [v.x + d2[0] * t, v.z + d2[1] * t];
    const side = cross >= 0 ? 1 : -1;
    const cx = a[0] - d1[1] * v.r * side;
    const cz = a[1] + d1[0] * v.r * side;
    const a0 = Math.atan2(a[1] - cz, a[0] - cx);
    const steps = Math.max(2, Math.ceil(theta / 0.24));
    const mid: [number, number][] = [];
    for (let s = 1; s < steps; s++) {
      const ang = a0 + side * theta * (s / steps);
      mid.push([cx + Math.cos(ang) * v.r, cz + Math.sin(ang) * v.r]);
    }
    arcs.push({ a, b, mid, t });
  }
  const out: [number, number][] = [];
  const startAt = opts.startAt ?? 0.3;
  for (let i = 0; i < n; i++) {
    const cur = arcs[i];
    const next = arcs[(i + 1) % n];
    const len = Math.hypot(next.a[0] - cur.b[0], next.a[1] - cur.b[1]);
    const edge = Math.hypot(pts[(i + 1) % n].x - pts[i].x, pts[(i + 1) % n].z - pts[i].z);
    if (cur.t + next.t > edge + 0.01) throw new Error(`layout: corners ${i} and ${(i + 1) % n} do not fit on the ${edge.toFixed(0)} m between them (need ${(cur.t + next.t).toFixed(0)} m)`);
    if (i > 0) out.push(cur.a, ...cur.mid, cur.b);
    else out.push(cur.b);
    // Points along the straight keep the curve from bowing between corners.
    const fracs: number[] = [];
    if (len > 24) fracs.push(9 / len);
    for (let s = 1; s * 42 < len - 20; s++) fracs.push((s * 42) / len);
    if (len > 24) fracs.push(1 - 9 / len);
    if (i === 0) {
      // The lap starts part-way down the first straight.
      const all = fracs.filter((f) => f > startAt + 0.02);
      const at = (f: number): [number, number] => [cur.b[0] + (next.a[0] - cur.b[0]) * f, cur.b[1] + (next.a[1] - cur.b[1]) * f];
      out.length = 0;
      out.push(at(startAt), ...all.map(at));
      (out as unknown as { tail?: [number, number][] }).tail = [cur.a, ...cur.mid, cur.b, ...fracs.filter((f) => f < startAt - 0.02).map(at)];
    } else {
      for (const f of fracs.sort((x, y) => x - y)) out.push([cur.b[0] + (next.a[0] - cur.b[0]) * f, cur.b[1] + (next.a[1] - cur.b[1]) * f]);
    }
  }
  const tail = (out as unknown as { tail?: [number, number][] }).tail ?? [];
  delete (out as unknown as { tail?: [number, number][] }).tail;
  return [...out, ...tail].map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
}
