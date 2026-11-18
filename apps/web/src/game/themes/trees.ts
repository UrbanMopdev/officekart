/**
 * Trees. A conifer is a bark-textured trunk with whorls of drooping boughs;
 * each bough is a flat card carrying a painted spray of needles, the way
 * forests are built in most racing games. Burnt trees are bare trunks and limbs.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { worldTexture } from "../assets";
import { mulberry } from "./placement";

/** A bough seen from above: the stem runs left to right, side shoots fan forward, all covered in needles. */
export function boughTexture(snow: number): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const r = mulberry(91);
  const greens = ["#16301c", "#1d3d22", "#27502b", "#2f5f31", "#3b7038", "#1a3a26"];
  const needles = (x0: number, y0: number, x1: number, y1: number, len: number) => {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2.2);
    const ang = Math.atan2(y1 - y0, x1 - x0);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      for (const side of [-1, 1]) {
        const a = ang + side * (0.75 + r() * 0.5);
        const l = len * (0.6 + r() * 0.6) * (1 - t * 0.35);
        g.strokeStyle = greens[Math.floor(r() * greens.length)];
        g.lineWidth = 1.6 + r() * 1.2;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
        g.stroke();
      }
    }
  };
  // Side shoots first, then the stem over them.
  const mid = H / 2;
  for (let i = 0; i < 15; i++) {
    const t = 0.04 + (i / 15) * 0.9;
    const x = t * W;
    const side = i % 2 ? 1 : -1;
    const reach = (H * 0.46) * (1 - t * 0.55) * (0.8 + r() * 0.3);
    const fwd = reach * (0.75 + r() * 0.3);
    const y1 = mid + side * reach;
    g.strokeStyle = "#3a2a1c";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x, mid);
    g.lineTo(x + fwd, y1);
    g.stroke();
    needles(x, mid, x + fwd, y1, 15);
    // A twig off each shoot keeps the card full enough to survive distance.
    needles(x + fwd * 0.45, mid + side * reach * 0.45, x + fwd * 0.95, mid + side * reach * 0.2, 12);
  }
  g.strokeStyle = "#33241a";
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(0, mid);
  g.lineTo(W * 0.97, mid);
  g.stroke();
  needles(0, mid, W * 0.99, mid, 17);
  if (snow > 0) {
    // Snow lies along the stem and the shoots, heavier towards the trunk.
    for (let i = 0; i < 260 * snow; i++) {
      const t = r();
      const x = t * W;
      const spread = (H * 0.4) * (1 - t * 0.5);
      const y = mid + (r() - 0.5) * 2 * spread * (r() < 0.5 ? 0.35 : 1);
      const s = 5 + r() * 13;
      const grad = g.createRadialGradient(x, y, 0, x, y, s);
      grad.addColorStop(0, "rgba(244,248,252,0.95)");
      grad.addColorStop(0.6, "rgba(232,240,248,0.8)");
      grad.addColorStop(1, "rgba(232,240,248,0)");
      g.globalCompositeOperation = "source-atop";
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, s, 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = "source-over";
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function quadStrip(points: THREE.Vector3[], widths: number[], side: THREE.Vector3, normal: (p: THREE.Vector3) => THREE.Vector3, shade: [number, number]): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const t = i / (points.length - 1);
    for (const s of [-1, 1]) {
      const p = points[i].clone().addScaledVector(side, s * widths[i] * 0.5);
      pos.push(p.x, p.y, p.z);
      uv.push(t, s * 0.5 + 0.5);
      const n = normal(p);
      nor.push(n.x, n.y, n.z);
      const k = shade[0] + (shade[1] - shade[0]) * t;
      col.push(k, k, k);
    }
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}

function trunkGeometry(height: number, radius: number, sides: number, lean = 0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius * 0.12, radius, height, sides, 4, true).translate(0, height / 2, 0);
  const p = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) + lean * (y / height) * (y / height) * height);
    uv.setXY(i, uv.getX(i) * 2, (y / height) * (height / 3));
  }
  g.computeVertexNormals();
  return g;
}

export interface TreeKit {
  /** Needle cards; drawn double-sided with alpha test. */
  foliage: THREE.BufferGeometry | null;
  wood: THREE.BufferGeometry;
}

/** A spruce or fir about 15 units tall. `seed` gives each variant its own silhouette. */
export function coniferGeometry(seed: number, detail: number): TreeKit {
  const r = mulberry(seed);
  const H = 13 + r() * 5;
  const R = 3.1 + r() * 1.1;
  const up = new THREE.Vector3(0, 1, 0);
  const boughs: THREE.BufferGeometry[] = [];
  const levels = Math.round(9 * detail + 4);
  const start = 0.14 + r() * 0.08;
  for (let k = 0; k < levels; k++) {
    const t = k / (levels - 1);
    const y = H * (start + (0.97 - start) * t);
    const reach = R * Math.pow(1 - t, 0.75) * (0.85 + r() * 0.3) + 0.35;
    const count = Math.max(3, Math.round((detail > 0.7 ? 6 : 4) * (1 - t * 0.45)));
    const droop = 0.42 - t * 0.5;
    const twist = r() * Math.PI * 2;
    for (let b = 0; b < count; b++) {
      const a = twist + (b / count) * Math.PI * 2 + (r() - 0.5) * 0.5;
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const side = new THREE.Vector3(-out.z, 0, out.x);
      const len = reach * (0.8 + r() * 0.35);
      // Boughs leave the trunk level, sag under their own weight and lift slightly at the tip.
      const pts = [0, 0.45, 1].map((s) => new THREE.Vector3().copy(out).multiplyScalar(len * s).add(new THREE.Vector3(0, y - droop * len * (s * s * 1.25 - s * 0.25), 0)));
      const roll = (r() - 0.5) * 0.5;
      const tilted = side.clone().applyAxisAngle(out, roll);
      const width = len * 0.62 + 0.5;
      boughs.push(quadStrip(pts, [width * 0.55, width, width * 0.5], tilted, (p) => new THREE.Vector3(p.x, 0, p.z).normalize().multiplyScalar(0.55).addScaledVector(up, 0.85).normalize(), [0.5, 1.05]));
    }
  }
  // The leader at the very top: two crossed upright cards.
  for (const a of [0, Math.PI / 2]) {
    const side = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    boughs.push(quadStrip([new THREE.Vector3(0, H * 0.86, 0), new THREE.Vector3(0, H * 1.04, 0)], [1.5, 0.5], side, () => up, [0.85, 1.05]));
  }
  const foliage = mergeGeometries(boughs, false)!;
  for (const b of boughs) b.dispose();
  return { foliage, wood: trunkGeometry(H * 0.96, 0.34 + R * 0.05, 7, (r() - 0.5) * 0.03) };
}

/** What a fire leaves standing: a charred trunk and a few broken limbs. */
export function burntGeometry(seed: number): TreeKit {
  const r = mulberry(seed);
  const H = 7 + r() * 6;
  const parts: THREE.BufferGeometry[] = [trunkGeometry(H, 0.38 + r() * 0.15, 6, (r() - 0.5) * 0.12)];
  const limbs = 3 + Math.floor(r() * 4);
  for (let i = 0; i < limbs; i++) {
    const at = H * (0.35 + r() * 0.5);
    const len = 1.6 + r() * 2.8;
    const limb = trunkGeometry(len, 0.13 + r() * 0.06, 5, (r() - 0.5) * 0.3);
    limb.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(0, at, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r() * Math.PI * 2, 0.7 + r() * 0.7, "YXZ")), new THREE.Vector3(1, 1, 1)));
    parts.push(limb);
  }
  const wood = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return { foliage: null, wood };
}

export function barkMaterial(tint: THREE.ColorRepresentation): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ map: worldTexture("tex/bark_d.jpg", true, 4), normalMap: worldTexture("tex/bark_n.jpg", false, 4), color: tint, roughness: 0.95 });
}

/** Needle cards are lit as soft rounded masses: the same shading on both faces, never flipped. */
export function foliageMaterial(map: THREE.Texture, tint: THREE.ColorRepresentation): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ map, color: tint, vertexColors: true, alphaTest: 0.34, side: THREE.DoubleSide, roughness: 0.82 });
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\nnormal = normalize(vNormal);");
  };
  mat.customProgramCacheKey = () => "foliage";
  return mat;
}
