/** Procedural canvas textures, so the game ships no image assets. */
import * as THREE from "three";

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function finish(c: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 16;
  return tex;
}

/** Deterministic random numbers so textures look the same on every machine. */
function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RoadStyle {
  base: string;
  edge: string;
  centre: string;
  speckle: number;
}

/** Road surface: u runs across the road, v along it. */
export function roadTexture(style: RoadStyle): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S, S);
  const r = rng(7);
  g.fillStyle = style.base;
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000 * style.speckle; i++) {
    const v = r();
    g.fillStyle = v > 0.5 ? `rgba(255,255,255,${0.03 + r() * 0.05})` : `rgba(0,0,0,${0.05 + r() * 0.1})`;
    const s = 1 + r() * 2;
    g.fillRect(r() * S, r() * S, s, s);
  }
  // Slightly darker racing line worn into both lanes.
  const worn = g.createLinearGradient(0, 0, S, 0);
  worn.addColorStop(0, "rgba(0,0,0,0)");
  worn.addColorStop(0.28, "rgba(0,0,0,0.14)");
  worn.addColorStop(0.5, "rgba(0,0,0,0.02)");
  worn.addColorStop(0.72, "rgba(0,0,0,0.14)");
  worn.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = worn;
  g.fillRect(0, 0, S, S);
  g.fillStyle = style.edge;
  g.fillRect(14, 0, 9, S);
  g.fillRect(S - 23, 0, 9, S);
  g.fillStyle = style.centre;
  g.fillRect(S / 2 - 5, 0, 10, S * 0.5);
  return finish(c);
}

export function woodTexture(): THREE.CanvasTexture {
  const S = 1024;
  const [c, g] = canvas(S, S);
  const r = rng(11);
  const rows = 8;
  const h = S / rows;
  for (let row = 0; row < rows; row++) {
    let x = -r() * 300;
    while (x < S) {
      const len = 260 + r() * 340;
      const light = 44 + r() * 12;
      g.fillStyle = `hsl(${27 + r() * 7}, ${42 + r() * 10}%, ${light}%)`;
      g.fillRect(x, row * h, len, h);
      for (let k = 0; k < 26; k++) {
        g.strokeStyle = `rgba(${r() > 0.5 ? "60,30,10" : "255,225,180"},${0.03 + r() * 0.07})`;
        g.lineWidth = 1 + r() * 2;
        const y = row * h + r() * h;
        g.beginPath();
        g.moveTo(x, y);
        g.bezierCurveTo(x + len * 0.3, y + (r() - 0.5) * 10, x + len * 0.7, y + (r() - 0.5) * 10, x + len, y + (r() - 0.5) * 6);
        g.stroke();
      }
      g.fillStyle = "rgba(40,20,8,0.55)";
      g.fillRect(x + len - 2, row * h, 3, h);
      x += len;
    }
    g.fillStyle = "rgba(40,20,8,0.6)";
    g.fillRect(0, row * h, S, 3);
  }
  return finish(c);
}

/** Short-pile artificial turf for the run-off strips. */
export function turfTexture(a: string, b: string): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S, S);
  const r = rng(23);
  g.fillStyle = a;
  g.fillRect(0, 0, S, S);
  g.fillStyle = b;
  g.fillRect(0, 0, S, S / 2);
  for (let i = 0; i < 5000; i++) {
    g.fillStyle = r() > 0.5 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.1)";
    g.fillRect(r() * S, r() * S, 1.5, 3);
  }
  return finish(c);
}

export function rugTexture(hue: number): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S, S);
  const r = rng(hue);
  g.fillStyle = `hsl(${hue}, 38%, 34%)`;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = `hsl(${hue + 20}, 45%, 62%)`;
  g.lineWidth = 10;
  g.strokeRect(26, 26, S - 52, S - 52);
  g.lineWidth = 3;
  g.strokeRect(48, 48, S - 96, S - 96);
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 6; x++) {
      const cx = 96 + x * 64;
      const cy = 96 + y * 64;
      g.fillStyle = `hsl(${hue + ((x + y) % 2 ? 25 : -15)}, 42%, ${46 + ((x * y) % 3) * 5}%)`;
      g.beginPath();
      g.moveTo(cx, cy - 22);
      g.lineTo(cx + 22, cy);
      g.lineTo(cx, cy + 22);
      g.lineTo(cx - 22, cy);
      g.closePath();
      g.fill();
    }
  }
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = r() > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.08)";
    g.fillRect(r() * S, r() * S, 2, 2);
  }
  return finish(c, false);
}

export function checkerTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 128);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 16; x++) {
      g.fillStyle = (x + y) % 2 ? "#0b0d12" : "#f8fafc";
      g.fillRect(x * 32, y * 32, 32, 32);
    }
  }
  return finish(c, false);
}

/** Scrolling chevrons for boost pads. Tiles vertically. */
export function boostTexture(base: string, arrow: string): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S, S);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = arrow;
  g.lineWidth = 26;
  g.lineJoin = "miter";
  for (let i = -1; i < 3; i++) {
    const y = S - i * 128;
    g.beginPath();
    g.moveTo(26, y);
    g.lineTo(S / 2, y - 64);
    g.lineTo(S - 26, y);
    g.stroke();
  }
  return finish(c);
}

/** Corner warning board: chevrons pointing right (mirror the mesh for left-handers). */
export function chevronBoardTexture(bg: string, fg: string): THREE.CanvasTexture {
  const [c, g] = canvas(256, 128);
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = fg;
  for (let i = 0; i < 3; i++) {
    const x = 22 + i * 78;
    g.beginPath();
    g.moveTo(x, 14);
    g.lineTo(x + 34, 14);
    g.lineTo(x + 68, 64);
    g.lineTo(x + 34, 114);
    g.lineTo(x, 114);
    g.lineTo(x + 34, 64);
    g.closePath();
    g.fill();
  }
  return finish(c, false);
}

export function labelTexture(text: string, color: string): THREE.CanvasTexture {
  const [c, g] = canvas(512, 112);
  g.font = "bold 58px 'Trebuchet MS', 'Segoe UI', sans-serif";
  const w = Math.min(492, g.measureText(text).width + 96);
  const x = (512 - w) / 2;
  g.fillStyle = "rgba(15,23,42,0.8)";
  g.beginPath();
  g.roundRect(x, 12, w, 88, 44);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.arc(x + 38, 56, 14, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#f8fafc";
  g.textBaseline = "middle";
  g.textAlign = "center";
  g.fillText(text, 256 + 18, 59, w - 96);
  return finish(c, false);
}

export function bannerTexture(text: string, bg: string, fg: string, trim: string): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 128);
  g.fillStyle = bg;
  g.fillRect(0, 0, 1024, 128);
  g.fillStyle = trim;
  g.fillRect(0, 0, 1024, 10);
  g.fillRect(0, 118, 1024, 10);
  g.font = "900 80px 'Trebuchet MS', 'Segoe UI', sans-serif";
  g.fillStyle = fg;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 512, 68);
  return finish(c, false);
}

/** A dashboard for the giant monitors and laptops. */
export function screenTexture(seed: number): THREE.CanvasTexture {
  const [c, g] = canvas(320, 200);
  const r = rng(seed * 31 + 5);
  g.fillStyle = "#0b1220";
  g.fillRect(0, 0, 320, 200);
  g.fillStyle = "#172033";
  g.fillRect(0, 0, 320, 24);
  g.fillStyle = "#f87171";
  g.fillRect(8, 8, 8, 8);
  g.fillStyle = "#fbbf24";
  g.fillRect(22, 8, 8, 8);
  g.fillStyle = "#34d399";
  g.fillRect(36, 8, 8, 8);
  const colors = ["#38bdf8", "#34d399", "#fbbf24", "#f472b6", "#a78bfa"];
  for (let i = 0; i < 8; i++) {
    const h = 20 + r() * 80;
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    g.fillRect(18 + i * 20, 180 - h, 13, h);
  }
  g.strokeStyle = "#38bdf8";
  g.lineWidth = 3;
  g.beginPath();
  for (let i = 0; i <= 8; i++) {
    const x = 190 + i * 14;
    const y = 150 - r() * 70 - i * 4;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  g.fillStyle = "#1e293b";
  for (let i = 0; i < 4; i++) g.fillRect(190, 40 + i * 12, 60 + r() * 50, 6);
  return finish(c, false);
}

export function whiteboardTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 512);
  g.fillStyle = "#f8fafc";
  g.fillRect(0, 0, 1024, 512);
  g.lineCap = "round";
  g.font = "bold 64px 'Comic Sans MS', 'Trebuchet MS', sans-serif";
  g.fillStyle = "#1d4ed8";
  g.fillText("RACE DAY!", 60, 100);
  g.strokeStyle = "#dc2626";
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(60, 125);
  g.lineTo(420, 118);
  g.stroke();
  g.strokeStyle = "#16a34a";
  g.beginPath();
  g.moveTo(560, 420);
  g.bezierCurveTo(520, 200, 760, 160, 900, 220);
  g.bezierCurveTo(1000, 280, 880, 440, 760, 380);
  g.bezierCurveTo(680, 340, 640, 460, 560, 420);
  g.stroke();
  g.font = "40px 'Comic Sans MS', 'Trebuchet MS', sans-serif";
  g.fillStyle = "#0f172a";
  ["1. Don't spill the coffee", "2. Drift early", "3. Winner picks lunch"].forEach((t, i) => g.fillText(t, 60, 210 + i * 70));
  return finish(c, false);
}

/** Lit office windows for night-time towers. Tiles in both directions. */
export function towerTexture(seed: number): THREE.CanvasTexture {
  const [c, g] = canvas(128, 256);
  const r = rng(seed);
  g.fillStyle = "#05060c";
  g.fillRect(0, 0, 128, 256);
  const tints = ["#ffd9a0", "#9be8ff", "#ffc2f2", "#fff3d0"];
  for (let y = 0; y < 16; y++) {
    const rowLit = r() > 0.25;
    for (let x = 0; x < 8; x++) {
      if (!rowLit || r() > 0.55) continue;
      g.fillStyle = tints[Math.floor(r() * tints.length)];
      g.globalAlpha = 0.35 + r() * 0.65;
      g.fillRect(x * 16 + 3, y * 16 + 4, 10, 8);
    }
  }
  g.globalAlpha = 1;
  return finish(c);
}

/** Soft round glow sprite. */
export function glowTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return finish(c, false);
}

/**
 * Road surfaces other than asphalt. u runs across the patch and v along the road; the tile is square
 * and repeats. Index matches SURFACE_TYPES.
 */
export function surfaceTexture(type: number): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S, S);
  const r = rng(1000 + type * 77);
  const dots = (n: number, colors: string[], min: number, max: number, alpha = 1) => {
    g.globalAlpha = alpha;
    for (let i = 0; i < n; i++) {
      g.fillStyle = colors[Math.floor(r() * colors.length)];
      g.beginPath();
      g.arc(r() * S, r() * S, min + r() * (max - min), 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  };
  /** Soft-edged blobs, drawn again one tile over so the texture wraps without a seam. */
  const blobs = (n: number, color: string, min: number, max: number, alpha: number) => {
    for (let i = 0; i < n; i++) {
      const x = r() * S;
      const y = r() * S;
      const rad = min + r() * (max - min);
      for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
        const grad = g.createRadialGradient(x + ox, y + oy, rad * 0.2, x + ox, y + oy, rad);
        grad.addColorStop(0, color);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        g.globalAlpha = alpha;
        g.fillStyle = grad;
        g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
      }
    }
    g.globalAlpha = 1;
  };
  /** Two tyre tracks running along the road. */
  const ruts = (color: string, alpha: number) => {
    for (const x of [S * 0.3, S * 0.7]) {
      const grad = g.createLinearGradient(x - 22, 0, x + 22, 0);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(0.5, color);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.globalAlpha = alpha;
      g.fillStyle = grad;
      g.fillRect(x - 22, 0, 44, S);
    }
    g.globalAlpha = 1;
  };
  const fill = (color: string) => {
    g.fillStyle = color;
    g.fillRect(0, 0, S, S);
  };
  switch (type) {
    case 1: // dirt
      fill("#9b7647");
      blobs(26, "#7d5c34", 18, 46, 0.5);
      blobs(18, "#b8915c", 14, 34, 0.45);
      ruts("#6e5030", 0.55);
      dots(520, ["#6b4d2b", "#b08a57", "#84633a"], 0.6, 1.8, 0.8);
      dots(34, ["#c9c2b4", "#8c867a"], 1.6, 3.6);
      break;
    case 2: // mud
      fill("#4b2f1a");
      blobs(22, "#6a4627", 16, 40, 0.5);
      blobs(16, "#24150a", 16, 44, 0.85);
      ruts("#2a180c", 0.6);
      dots(260, ["#2b1a0d", "#6f4a2a"], 0.7, 2.2, 0.8);
      // wet highlights
      g.strokeStyle = "rgba(255,236,210,0.28)";
      g.lineWidth = 1.6;
      for (let i = 0; i < 26; i++) {
        const x = r() * S;
        const y = r() * S;
        g.beginPath();
        g.arc(x, y, 6 + r() * 16, r() * 6, r() * 6 + 0.9);
        g.stroke();
      }
      break;
    case 3: { // ice
      const grad = g.createLinearGradient(0, 0, S, S);
      grad.addColorStop(0, "#d9f3ff");
      grad.addColorStop(0.5, "#b4e1f7");
      grad.addColorStop(1, "#d2efff");
      g.fillStyle = grad;
      g.fillRect(0, 0, S, S);
      blobs(14, "#ffffff", 20, 60, 0.5);
      blobs(10, "#7fc4e8", 20, 50, 0.4);
      g.lineCap = "round";
      for (let i = 0; i < 16; i++) {
        let x = r() * S;
        let y = r() * S;
        g.strokeStyle = `rgba(255,255,255,${0.5 + r() * 0.4})`;
        g.lineWidth = 0.8 + r() * 1.4;
        g.beginPath();
        g.moveTo(x, y);
        let a = r() * Math.PI * 2;
        for (let k = 0; k < 5; k++) {
          a += (r() - 0.5) * 1.4;
          x += Math.cos(a) * (10 + r() * 22);
          y += Math.sin(a) * (10 + r() * 22);
          g.lineTo(x, y);
        }
        g.stroke();
      }
      break;
    }
    case 4: // snow
      fill("#f3f7fc");
      blobs(26, "#cbd9ea", 14, 40, 0.5);
      blobs(18, "#ffffff", 14, 36, 0.8);
      ruts("#c3d2e4", 0.6);
      dots(160, ["#ffffff"], 0.5, 1.3);
      dots(120, ["#b9c9dc"], 0.6, 1.6, 0.6);
      break;
    case 5: // sand
      fill("#dfc27a");
      blobs(20, "#c9a95f", 16, 44, 0.5);
      g.strokeStyle = "rgba(160,125,60,0.5)";
      g.lineWidth = 2;
      for (let y = 8; y < S; y += 16) {
        g.beginPath();
        for (let x = 0; x <= S; x += 8) g.lineTo(x, y + Math.sin((x / S) * Math.PI * 4 + y) * 3);
        g.stroke();
      }
      dots(300, ["#f0dba0", "#b8974f"], 0.5, 1.4, 0.8);
      break;
    case 6: // boost road
      fill("#0b5f78");
      g.strokeStyle = "#7df3ff";
      g.lineWidth = 22;
      for (let i = -1; i < 3; i++) {
        const y = S - i * 128;
        g.beginPath();
        g.moveTo(30, y);
        g.lineTo(S / 2, y - 60);
        g.lineTo(S - 30, y);
        g.stroke();
      }
      break;
    case 7: { // oil
      fill("#0a0a12");
      const hues = ["#7c3aed", "#14b8a6", "#ec4899", "#3b82f6", "#eab308"];
      g.lineWidth = 5;
      for (let i = 0; i < 26; i++) {
        g.strokeStyle = hues[i % hues.length];
        g.globalAlpha = 0.16 + r() * 0.22;
        g.beginPath();
        g.ellipse(r() * S, r() * S, 16 + r() * 50, 8 + r() * 26, r() * Math.PI, 0, Math.PI * 2);
        g.stroke();
      }
      g.globalAlpha = 1;
      blobs(10, "#ffffff", 8, 22, 0.16);
      break;
    }
    default: // conveyor belts
      fill("#2a2f37");
      g.fillStyle = "#171a20";
      for (let y = 0; y < S; y += 32) g.fillRect(0, y, S, 5);
      g.fillStyle = "#3a4049";
      for (let y = 5; y < S; y += 32) g.fillRect(0, y, S, 2);
      g.strokeStyle = "#facc15";
      g.lineWidth = 12;
      for (let i = -1; i < 3; i++) {
        const y = S - i * 128 - 30;
        g.beginPath();
        g.moveTo(70, y);
        g.lineTo(S / 2, y - 44);
        g.lineTo(S - 70, y);
        g.stroke();
      }
      g.fillStyle = "#111318";
      g.fillRect(0, 0, 12, S);
      g.fillRect(S - 12, 0, 12, S);
  }
  return finish(c);
}
