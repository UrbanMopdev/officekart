/** Sanity-check track geometry: curvature, self-clearance, grid and pads. */
import { TRACK_DEFS, getTrack, locate } from "@office-kart/shared";

let failed = false;
for (const id of Object.keys(TRACK_DEFS)) {
  const t = getTrack(id);
  const wall = t.def.wallHalfWidth;

  // Tightest corner: radius = spacing / change in tangent angle per sample.
  let minRadius = Infinity;
  for (let i = 0; i < t.n; i++) {
    const j = (i + 1) % t.n;
    const cross = t.tx[i] * t.tz[j] - t.tz[i] * t.tx[j];
    const dAngle = Math.abs(Math.asin(Math.max(-1, Math.min(1, cross))));
    if (dAngle > 1e-9) minRadius = Math.min(minRadius, t.spacing / dAngle);
  }

  // Closest approach between two different parts of the circuit.
  let minGap = Infinity;
  const skip = Math.ceil((wall * 4) / t.spacing);
  for (let i = 0; i < t.n; i++) {
    for (let j = i + skip; j < t.n; j++) {
      if (t.n - j + i < skip) continue;
      minGap = Math.min(minGap, Math.hypot(t.px[i] - t.px[j], t.pz[i] - t.pz[j]));
    }
  }

  const out = { idx: 0, along: 0, lateral: 0 };
  const gridOk = t.grid.every((g) => Math.abs(locate(t, g.x, g.z, -1, out).lateral) < t.def.roadHalfWidth - 1);
  const padsOk = t.pads.every((p) => p.i1 < t.n && Math.abs(p.lateral) + p.halfWidth <= t.def.roadHalfWidth);

  let maxSlope = 0;
  for (let i = 0; i < t.n; i++) if (!t.gap[i]) maxSlope = Math.max(maxSlope, t.slope[i]); // climbs only: drop-offs after a jump are meant to be steep
  const gridFlat = t.grid.every((g) => Math.abs(t.slope[g.idx]) < 0.02);
  const checks = {
    "no climb steeper than 45%": maxSlope < 0.45,
    "starting grid is level": gridFlat,
    "corner radius > wall half-width": minRadius > wall + 1,
    "no overlap between track sections": minGap > wall * 2 + 2,
    "12 grid slots on the road": t.grid.length === 12 && gridOk,
    "boost pads on the road": padsOk,
    "checkpoints in increasing order": t.checkpoints.every((c, i) => i === 0 || c > t.checkpoints[i - 1]),
  };
  console.log(`${t.def.name}: length ${t.length.toFixed(0)} m, min radius ${minRadius.toFixed(1)}, min gap ${minGap.toFixed(1)}, height ${t.minY.toFixed(0)}..${t.maxY.toFixed(0)}, max slope ${(maxSlope * 100).toFixed(0)}%`);
  for (const [name, ok] of Object.entries(checks)) {
    if (!ok) {
      console.log(`  FAIL  ${name}`);
      failed = true;
    }
  }
}
process.exit(failed ? 1 : 0);
