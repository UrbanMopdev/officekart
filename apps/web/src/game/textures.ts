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
  tex.anisotropy = 8;
  return tex;
}

/** Road surface: u runs across the road, v along it. */
export function roadTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = "#3a4256";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.045)" : "rgba(0,0,0,0.07)";
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  g.fillStyle = "#f8fafc";
  g.fillRect(6, 0, 7, 256);
  g.fillRect(243, 0, 7, 256);
  g.fillStyle = "#fbbf24";
  g.fillRect(124, 0, 8, 128);
  return finish(c);
}

export function carpetTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const tones = ["#b9c4d6", "#aebbd0"];
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 2; x++) {
      g.fillStyle = tones[(x + y) % 2];
      g.fillRect(x * 128, y * 128, 128, 128);
    }
  }
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.06)" : "rgba(30,41,59,0.05)";
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 3);
  }
  return finish(c);
}

export function checkerTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 64);
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 ? "#0f172a" : "#f8fafc";
      g.fillRect(x * 32, y * 32, 32, 32);
    }
  }
  return finish(c, false);
}

export function boostTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = "#f97316";
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "#fef08a";
  g.lineWidth = 14;
  g.lineJoin = "miter";
  for (let i = 0; i < 3; i++) {
    const y = 112 - i * 40;
    g.beginPath();
    g.moveTo(18, y);
    g.lineTo(64, y - 30);
    g.lineTo(110, y);
    g.stroke();
  }
  return finish(c, false);
}

export function labelTexture(text: string, color: string): THREE.CanvasTexture {
  const [c, g] = canvas(512, 112);
  g.font = "bold 58px 'Trebuchet MS', 'Segoe UI', sans-serif";
  const w = Math.min(492, g.measureText(text).width + 56);
  const x = (512 - w) / 2;
  g.fillStyle = "rgba(15,23,42,0.78)";
  g.beginPath();
  g.roundRect(x, 12, w, 88, 44);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.arc(x + 34, 56, 13, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#f8fafc";
  g.textBaseline = "middle";
  g.textAlign = "center";
  g.fillText(text, 256 + 16, 59, w - 80);
  return finish(c, false);
}

export function bannerTexture(text: string): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 128);
  g.fillStyle = "#4f46e5";
  g.fillRect(0, 0, 1024, 128);
  g.fillStyle = "#fbbf24";
  g.fillRect(0, 0, 1024, 12);
  g.fillRect(0, 116, 1024, 12);
  g.font = "bold 78px 'Trebuchet MS', 'Segoe UI', sans-serif";
  g.fillStyle = "#f8fafc";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 512, 68);
  return finish(c, false);
}

/** A tiny bar chart for the giant monitors. */
export function screenTexture(seed: number): THREE.CanvasTexture {
  const [c, g] = canvas(256, 160);
  g.fillStyle = "#0f172a";
  g.fillRect(0, 0, 256, 160);
  g.fillStyle = "#1e293b";
  g.fillRect(0, 0, 256, 22);
  const colors = ["#38bdf8", "#34d399", "#fbbf24", "#f472b6"];
  for (let i = 0; i < 9; i++) {
    const h = 24 + ((Math.sin(seed * 12.9898 + i * 4.1) + 1) / 2) * 96;
    g.fillStyle = colors[(i + seed) % colors.length];
    g.fillRect(18 + i * 26, 148 - h, 18, h);
  }
  return finish(c, false);
}
