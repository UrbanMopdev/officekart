/**
 * The view from the driver's seat. One interior serves every car, sized to it:
 * dashboard, instrument binnacle with a live speed display, a steering wheel
 * that follows the driver's hands, pillars, mirror, door tops and the bonnet in
 * the car's own paint. Built in metres in the car's model space: +z forward,
 * +x to the driver's left, y up from the road.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { shade, type Cabin } from "./cabins";
import { buildHands, loadHands, type DriverHands } from "./hands";
import { roadWet } from "./materials";

export interface CockpitSpec {
  /** Driver's eye height above the road, and how far ahead of the car's centre the nose is. */
  eyeHeight: number;
  front: number;
  halfWidth: number;
  paint: THREE.Material;
}

export interface Cockpit {
  group: THREE.Group;
  /** The driver's eyes; the camera sits here. */
  eye: THREE.Object3D;
  /** Turn the steering wheel: -1 is full left, 1 is full right. */
  setSteer(steer: number): void;
  setSpeed(kmh: number, boost: boolean): void;
  /** Give the mirror a picture of the road behind, or null to go back to plain glass. */
  setRearView(texture: THREE.Texture | null): void;
  dispose(): void;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
  new THREE.BoxGeometry(w, h, d).applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));

function beam(a: THREE.Vector3, b: THREE.Vector3, w: number, d: number): THREE.BufferGeometry {
  const dir = b.clone().sub(a);
  const g = new THREE.BoxGeometry(w, dir.length(), d);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()));
  const m = a.clone().add(b).multiplyScalar(0.5);
  return g.translate(m.x, m.y, m.z);
}

const merged = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry => {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false)!;
  for (const p of parts) p.dispose();
  return g;
};

/** A small digital dash: rev bar, speed and gear. Redrawn only when the reading changes. */
export function speedScreen(width: number, height: number): { mesh: THREE.Mesh; texture: THREE.CanvasTexture; set(kmh: number, boost: boolean): void } {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  let shown = -1;
  const set = (kmh: number, boost: boolean): void => {
    const key = Math.round(kmh) * 2 + (boost ? 1 : 0);
    if (key === shown) return;
    shown = key;
    ctx.fillStyle = "#05070a";
    ctx.fillRect(0, 0, 256, 96);
    // Rev bar: climbs through each gear and drops back on the change.
    const gear = Math.min(6, 1 + Math.floor(kmh / 38));
    const rev = Math.min(1, 0.25 + ((kmh % 38) / 38) * 0.75);
    for (let i = 0; i < 24; i++) {
      const on = i / 24 < rev;
      ctx.fillStyle = on ? (i > 19 ? "#ff4b3a" : i > 15 ? "#ffc23a" : "#3ad1ff") : "#18222c";
      ctx.fillRect(10 + i * 10, 8, 7, 12);
    }
    ctx.fillStyle = boost ? "#ffc23a" : "#f2f6fa";
    ctx.font = "bold 56px ui-monospace, Menlo, monospace";
    ctx.textAlign = "right";
    ctx.fillText(String(Math.round(kmh)), 150, 78);
    ctx.font = "bold 16px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = "#8fa3b5";
    ctx.textAlign = "left";
    ctx.fillText("km/h", 158, 78);
    ctx.fillStyle = "#3ad1ff";
    ctx.font = "bold 40px ui-monospace, Menlo, monospace";
    ctx.fillText(String(gear), 214, 78);
    texture.needsUpdate = true;
  };
  set(0, false);
  return { mesh, texture, set };
}

export function buildCockpit(spec: CockpitSpec): Cockpit {
  const group = new THREE.Group();
  const E = new THREE.Vector3(0.36, spec.eyeHeight, -0.12);
  const half = Math.min(0.86, spec.halfWidth - 0.08);
  const dashY = E.y - 0.41;
  const cowlZ = E.z + 1.0;

  const plastic = new THREE.MeshStandardMaterial({ color: "#16171a", roughness: 0.86, metalness: 0.05 });
  const cloth = new THREE.MeshStandardMaterial({ color: "#2b2d31", roughness: 0.95 });
  const leather = new THREE.MeshStandardMaterial({ color: "#0e0e10", roughness: 0.55 });
  const satin = new THREE.MeshStandardMaterial({ color: "#8d9198", roughness: 0.35, metalness: 0.9 });
  const mirrorGlass = new THREE.MeshStandardMaterial({ color: "#aab4c0", roughness: 0.03, metalness: 1 });

  // Dashboard: a deep top roll under the screen, a face towards the driver, the binnacle hood and centre stack.
  const dash = [
    box(half * 2, 0.07, 0.56, 0, dashY, E.z + 0.74, -0.06),
    box(half * 2, 0.3, 0.1, 0, dashY - 0.16, E.z + 0.53, 0.18),
    box(0.44, 0.025, 0.13, E.x, dashY + 0.175, E.z + 0.66, -0.1),
    box(0.025, 0.16, 0.13, E.x - 0.21, dashY + 0.1, E.z + 0.66),
    box(0.025, 0.16, 0.13, E.x + 0.21, dashY + 0.1, E.z + 0.66),
    box(0.42, 0.17, 0.03, E.x, dashY + 0.09, E.z + 0.7),
    box(0.3, 0.2, 0.05, 0, dashY - 0.1, E.z + 0.47, 0.3),
    // Door tops and the sills below them
    box(0.09, 0.07, 1.5, half + 0.04, dashY - 0.02, E.z + 0.1),
    box(0.09, 0.07, 1.5, -half - 0.04, dashY - 0.02, E.z + 0.1),
    box(0.07, 0.5, 1.5, half + 0.06, dashY - 0.3, E.z + 0.1),
    box(0.07, 0.5, 1.5, -half - 0.06, dashY - 0.3, E.z + 0.1),
    // Steering column and centre tunnel
    beam(new THREE.Vector3(E.x, dashY - 0.06, E.z + 0.46), new THREE.Vector3(E.x, dashY - 0.14, E.z + 0.62), 0.07, 0.07),
    box(0.26, 0.2, 0.9, 0, dashY - 0.42, E.z + 0.2),
    // Wipers resting on the scuttle
    beam(new THREE.Vector3(0.05, dashY + 0.045, cowlZ + 0.03), new THREE.Vector3(half * 0.8, dashY + 0.035, cowlZ + 0.08), 0.02, 0.012),
    beam(new THREE.Vector3(-half * 0.75, dashY + 0.045, cowlZ + 0.03), new THREE.Vector3(-0.05, dashY + 0.035, cowlZ + 0.08), 0.02, 0.012),
  ];
  group.add(new THREE.Mesh(merged(dash), plastic));

  // Pillars, roof lining and sun visors.
  const roofY = E.y + 0.27;
  const trim = [
    beam(new THREE.Vector3(half + 0.04, dashY + 0.04, cowlZ + 0.05), new THREE.Vector3(half - 0.1, roofY, E.z + 0.42), 0.06, 0.09),
    beam(new THREE.Vector3(-half - 0.04, dashY + 0.04, cowlZ + 0.05), new THREE.Vector3(-half + 0.1, roofY, E.z + 0.42), 0.06, 0.09),
    box(half * 2 - 0.16, 0.05, 1.3, 0, roofY + 0.03, E.z - 0.23),
    box(0.34, 0.015, 0.14, E.x, roofY - 0.005, E.z + 0.32, 0.2),
    box(0.34, 0.015, 0.14, -E.x, roofY - 0.005, E.z + 0.32, 0.2),
    beam(new THREE.Vector3(half - 0.1, roofY, E.z + 0.42), new THREE.Vector3(half - 0.1, roofY, E.z - 0.9), 0.07, 0.06),
    beam(new THREE.Vector3(-half + 0.1, roofY, E.z + 0.42), new THREE.Vector3(-half + 0.1, roofY, E.z - 0.9), 0.07, 0.06),
  ];
  group.add(new THREE.Mesh(merged(trim), cloth));

  // Mirrors: the interior one on its stalk, and the door mirror housings in body colour.
  // The interior mirror shows a live view behind when the game supplies one; otherwise it reflects the sky.
  const rearView = new THREE.MeshBasicMaterial({ color: "#c9ccd0", toneMapped: false });
  const mirror: THREE.Mesh<THREE.PlaneGeometry, THREE.Material> = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.055), mirrorGlass);
  // Sits just proud of its housing, turned the same way, facing the driver.
  const mirrorMount = new THREE.Group();
  mirrorMount.position.set(0.02, roofY - 0.075, E.z + 0.455);
  mirrorMount.rotation.set(0.1, 0.12, 0);
  mirror.rotation.y = Math.PI;
  mirror.position.z = -0.018;
  mirrorMount.add(mirror);
  group.add(mirrorMount);
  group.add(new THREE.Mesh(merged([box(0.22, 0.072, 0.03, 0.02, roofY - 0.075, E.z + 0.455, 0.1, 0.12), beam(new THREE.Vector3(0.02, roofY - 0.04, E.z + 0.47), new THREE.Vector3(0.02, roofY + 0.02, E.z + 0.52), 0.022, 0.022)]), plastic));
  const housings = [box(0.17, 0.105, 0.07, half + 0.19, dashY + 0.07, cowlZ - 0.1, 0, -0.25), box(0.17, 0.105, 0.07, -half - 0.19, dashY + 0.07, cowlZ - 0.1, 0, 0.25)];
  group.add(new THREE.Mesh(merged(housings), spec.paint));
  group.add(new THREE.Mesh(merged([box(0.145, 0.082, 0.008, half + 0.18, dashY + 0.07, cowlZ - 0.14, 0, -0.25), box(0.145, 0.082, 0.008, -half - 0.18, dashY + 0.07, cowlZ - 0.14, 0, 0.25)]), mirrorGlass));

  // Bonnet: the car's own paint, crowned across and falling away to the nose.
  const length = Math.max(0.9, spec.front - cowlZ);
  const hood = new THREE.PlaneGeometry(spec.halfWidth * 2 - 0.1, length, 10, 8).rotateX(-Math.PI / 2);
  const hp = hood.getAttribute("position");
  for (let i = 0; i < hp.count; i++) {
    const x = hp.getX(i) / spec.halfWidth;
    const along = 1 - (hp.getZ(i) / length + 0.5); // 0 at the screen, 1 at the nose
    hp.setY(i, dashY + 0.05 - 0.2 * along * along - 0.03 * along + 0.05 * (1 - x * x) - 0.05 * Math.pow(Math.abs(x), 6));
    hp.setZ(i, cowlZ + along * length);
  }
  hood.computeVertexNormals();
  const bonnet = new THREE.Mesh(hood, spec.paint);
  bonnet.receiveShadow = true;
  group.add(bonnet);

  // Instruments: a small screen redrawn as the speed changes.
  const dial = speedScreen(0.33, 0.124);
  const screen = dial.mesh;
  screen.position.set(E.x, dashY + 0.1, E.z + 0.67);
  screen.rotation.set(0.5, Math.PI, 0);
  group.add(screen);
  const setSpeed = dial.set;
  const screenTex = dial.texture;

  // Centre screen: a faint glow, like a map left on.
  const centre = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.14), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.016, 0.04, 0.065), toneMapped: false }));
  centre.position.set(0, dashY - 0.095, E.z + 0.44);
  centre.rotation.set(0.3, Math.PI, 0);
  group.add(centre);

  // Steering wheel: leather rim, three satin spokes, turning about its own axis.
  const column = new THREE.Group();
  column.position.set(E.x, dashY + 0.0, E.z + 0.41);
  column.rotation.x = 0.38;
  const wheel = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.182, 0.0165, 12, 40), leather);
  const spokes = new THREE.Mesh(merged([box(0.34, 0.03, 0.012, 0, -0.012, 0), box(0.035, 0.17, 0.012, 0, -0.095, 0)]), satin);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.064, 0.035, 20).rotateX(Math.PI / 2), leather);
  // A marker at twelve o'clock, as on a racing wheel.
  const marker = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.036, 0.036).translate(0, 0.182, 0), new THREE.MeshStandardMaterial({ color: "#d4202a", roughness: 0.5 }));
  wheel.add(rim, spokes, hub, marker);
  column.add(wheel);
  group.add(column);

  const eye = new THREE.Object3D();
  eye.position.copy(E);
  group.add(eye);

  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.receiveShadow = true;
  });

  return {
    group,
    eye,
    setSteer(steer) {
      wheel.rotation.z = steer * 1.75;
    },
    setSpeed,
    setRearView(texture) {
      if (texture && rearView.map !== texture) {
        rearView.map = texture;
        rearView.needsUpdate = true;
      }
      mirror.material = texture ? rearView : mirrorGlass;
    },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        if (m.material !== spec.paint) (m.material as THREE.Material).dispose();
      });
      screenTex.dispose();
    },
  };
}


/** Raindrops for glass: beads in the red channel, larger drops with short tails in the green. Tiles. */
function dropsTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "lighter";
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const dot = (x: number, y: number, r: number, colour: string): void => {
    // Drawn at each wrap position so the texture has no seams.
    for (const ox of [-size, 0, size])
      for (const oy of [-size, 0, size]) {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, colour);
        g.addColorStop(0.55, colour);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
  };
  for (let i = 0; i < 170; i++) dot(rnd() * size, rnd() * size, 1.2 + rnd() * rnd() * 4.5, "rgb(255,0,0)");
  for (let i = 0; i < 26; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 2.5 + rnd() * 3;
    dot(x, y, r, "rgb(0,255,0)");
    for (let t = 1; t < 7; t++) dot(x + (rnd() - 0.5) * 1.5, y - t * r * 0.9, r * (0.7 - t * 0.08), "rgb(0,90,0)");
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/**
 * The concept car's instrument panel, redrawn live in the layout its designers gave it: fuel, engine
 * speed and throttle as stacks of bars, the speed in large figures, temperature on the right. Drawn
 * in white; the panel's own material gives it its amber glow.
 */
function panelScreen(): { texture: THREE.CanvasTexture; set(kmh: number, boost: boolean): void } {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  let shown = -1;
  const stack = (x: number, w: number, lit: number, label: string): void => {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    ctx.strokeRect(x, 30, w, 172);
    for (let i = 0; i < 9; i++) {
      const y = 182 - i * 18.5;
      if (i < lit) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(x + 8, y, w - 16, 12);
      } else {
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 8, y, w - 16, 12);
      }
    }
    ctx.fillStyle = "#fff";
    ctx.font = "600 17px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, x + w / 2, 228);
  };
  const set = (kmh: number, boost: boolean): void => {
    const speed = Math.round(kmh);
    const rev = Math.min(1, 0.22 + ((kmh % 38) / 38) * 0.78);
    const key = speed * 40 + Math.round(rev * 9) * 2 + (boost ? 1 : 0);
    if (key === shown) return;
    shown = key;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 1024, 256);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(165, 18);
    ctx.lineTo(860, 18);
    ctx.quadraticCurveTo(880, 20, 892, 40);
    ctx.lineTo(985, 220);
    ctx.quadraticCurveTo(990, 238, 970, 238);
    ctx.lineTo(55, 238);
    ctx.quadraticCurveTo(34, 238, 40, 220);
    ctx.lineTo(132, 40);
    ctx.quadraticCurveTo(142, 20, 165, 18);
    ctx.stroke();
    stack(168, 72, 8, "fuel");
    stack(254, 76, Math.round(rev * 9), "engine RPM");
    stack(344, 76, boost ? 9 : Math.min(9, Math.round((kmh / 150) * 7)), "power");
    stack(818, 52, 5, "temp");
    ctx.fillStyle = "#fff";
    ctx.font = "700 150px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText(String(speed), 600, 172);
    ctx.font = "600 22px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText("speed km/h", 600, 222);
    texture.needsUpdate = true;
  };
  set(0, false);
  return { texture, set };
}

export interface CabinFit {
  paint: THREE.Material;
  second: THREE.Material;
  /** The player's colour, for the upholstery accents of cars that have them. */
  tint: THREE.Color;
  /** Where the car's shell sits on the kart: ride height and shift along the car. */
  ride: number;
  offsetZ: number;
}

/**
 * The driver's view from a real cabin model: the car's own dashboard, wheel, seats and pillars, with
 * its bodywork in the player's paint. Parts stay shared with the loaded model, which is used by one
 * car at a time (your own).
 */
export function buildCabinCockpit(cabin: Cabin, fit: CabinFit): Cockpit {
  // A cabin serves one car at a time; if an earlier car was never told to let go of it, do that now.
  cabin.release?.();
  const group = new THREE.Group();
  const shell = new THREE.Group();
  shell.position.set(0, fit.ride, fit.offsetZ);
  shell.add(cabin.scene);
  group.add(shell);

  for (const m of cabin.paint) m.material = fit.paint;
  for (const m of cabin.paint2) m.material = fit.second;
  // Glass seen from inside: almost clear, with a faint sheen that picks up the sky.
  const glass = new THREE.MeshPhysicalMaterial({ color: "#9fb0bb", transparent: true, opacity: 0.045, roughness: 0.03, metalness: 0, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 0.7 });
  // In the rain, drops bead on the glass and run slowly down it.
  const drops = dropsTexture();
  const dropTime = { value: 0 };
  // Two wiper blades sweep the windscreen while it rains: drawn on the glass itself, clearing the drops
  // in their arcs, which then bead up again until the next pass.
  const sc = cabin.screen;
  const width = Math.max(0.8, sc.left - sc.right);
  const wipe = {
    uWipeA: { value: new THREE.Vector2(sc.left - width * 0.1, sc.low) },
    uWipeB: { value: new THREE.Vector2(sc.left - width * 0.56, sc.low) },
    uWipeLen: { value: width * 0.47 },
    uWipeFrom: { value: sc.from },
  };
  glass.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uWet: roadWet, tDrops: { value: drops }, uDropTime: dropTime }, wipe);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 cabinPos; varying vec3 vCab;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCab = cabinPos;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uWet; uniform sampler2D tDrops; uniform float uDropTime; varying vec3 vCab;
        uniform vec2 uWipeA; uniform vec2 uWipeB; uniform float uWipeLen; uniform float uWipeFrom;
        // One blade: x = how much of the rain it has cleared here (1 just wiped, 0 not reached), y = the blade itself.
        vec2 wiper(vec2 pivot, float phase) {
          // The screen is raked, so its height is foreshortened seen from the front; undo that for a round sweep.
          vec2 d = vec2(vCab.x - pivot.x, (vCab.y - pivot.y) / 0.62);
          float r = length(d);
          if (r > uWipeLen || r < 0.05 || d.y < -0.01) return vec2(0.0);
          // Blades park pointing across the car (towards -x) and sweep up and over.
          const float park = 3.02; const float top = 1.12;
          float u = (park - atan(d.y, d.x)) / (park - top);
          if (u < 0.0 || u > 1.0) return vec2(0.0);
          float at = 0.5 - 0.5 * cos(phase);
          float pass = acos(clamp(1.0 - 2.0 * u, -1.0, 1.0));
          float since = min(mod(phase - pass, 6.2832), mod(phase + pass, 6.2832)) / 4.6;
          float blade = 1.0 - smoothstep(0.006, 0.011, abs(u - at) * (park - top) * r);
          return vec2(1.0 - smoothstep(0.0, 1.9, since), blade);
        }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        if (uWet > 0.01) {
          vec2 at = vCab.xy * 2.7 + vec2(vCab.z * 1.3, vCab.z * 0.4);
          float beads = texture2D(tDrops, at).r;
          float runs = texture2D(tDrops, at * 0.62 + vec2(0.0, uDropTime * 0.045)).g;
          float drop = max(beads, runs) * uWet;
          float film = uWet * 0.03;
          if (vCab.z > uWipeFrom && uWet > 0.3) {
            float phase = uDropTime * 4.6;
            vec2 w = max(wiper(uWipeA, phase), wiper(uWipeB, phase));
            drop *= 1.0 - w.x * 0.92;
            film *= 1.0 - w.x;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012), w.y);
            diffuseColor.a = max(diffuseColor.a, w.y * 0.96);
          }
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.88, 0.95), drop);
          diffuseColor.a = min(1.0, diffuseColor.a + drop * 0.5 + film);
        }`,
      );
  };
  glass.customProgramCacheKey = () => "cabin-glass-rain-2";
  for (const m of cabin.glass) {
    m.material = glass;
    m.renderOrder = 5;
  }
  // Upholstery accents take a deep version of the player's colour.
  const accents: THREE.MeshStandardMaterial[] = [];
  for (const m of cabin.accent) {
    const mat = m.material as THREE.MeshStandardMaterial;
    if (!accents.includes(mat)) accents.push(mat);
  }
  for (const a of accents) a.color.copy(fit.tint).multiplyScalar(0.55).lerp(new THREE.Color("#1a1512"), 0.35);

  const disposables: { dispose(): void }[] = [glass, drops];
  let setSpeed: Cockpit["setSpeed"] = () => {};
  if (cabin.panel && cabin.spec.livePanel) {
    const panel = panelScreen();
    cabin.panel.emissiveMap = panel.texture;
    cabin.panel.needsUpdate = true;
    setSpeed = panel.set;
    disposables.push(panel.texture);
  } else if (cabin.spec.readout) {
    const r = cabin.spec.readout;
    const dial = speedScreen(r.size[0], r.size[1]);
    dial.mesh.position.set(r.at[0], r.at[1], r.at[2]);
    dial.mesh.rotation.set(r.tilt, Math.PI + (r.yaw ?? 0), 0, "YXZ");
    shell.add(dial.mesh);
    setSpeed = dial.set;
    disposables.push(dial.texture, dial.mesh.geometry, dial.mesh.material as THREE.Material);
  }

  // Mirrors show the road behind when the game supplies the picture, and the sky otherwise.
  const rearView = new THREE.MeshBasicMaterial({ color: "#c9ccd0", toneMapped: false });
  disposables.push(rearView);
  const mirrorHome = cabin.mirrors.map((m) => m.material);

  const eye = new THREE.Object3D();
  eye.position.set(cabin.spec.eye[0], cabin.spec.eye[1], cabin.spec.eye[2]);
  shell.add(eye);

  // The driver's hands: gloves on the rim, sleeves in a deep shade of the player's colour.
  const glove = new THREE.MeshStandardMaterial({ color: "#17181b", roughness: 0.72 });
  const sleeve = new THREE.MeshStandardMaterial({ color: fit.tint.clone().multiplyScalar(0.3).lerp(new THREE.Color("#141416"), 0.35), roughness: 0.9 });
  shade(glove);
  shade(sleeve);
  disposables.push(glove, sleeve);
  let hands: DriverHands | null = null;
  void loadHands();

  const dispose = (): void => {
    if (cabin.release !== dispose) return;
    cabin.release = null;
    cabin.mirrors.forEach((m, i) => (m.material = mirrorHome[i]));
    hands?.remove();
    if (cabin.spin) cabin.spin.rotation.z = 0;
    if (cabin.panel) cabin.panel.emissiveMap = null;
    shell.remove(cabin.scene);
    for (const d of disposables) d.dispose();
  };
  cabin.release = dispose;

  return {
    group,
    eye,
    setSteer(steer) {
      if (!cabin.spin) return;
      // The wheel's axis points at the driver, so a turn to the right is a negative angle about it.
      cabin.spin.rotation.z = -steer * 0.95;
      hands ??= buildHands(cabin.spin, shell, cabin.wheelRadius, eye.position, glove, sleeve);
      hands?.update(cabin.spin.rotation.z);
    },
    setSpeed(kmh, boost) {
      dropTime.value = performance.now() / 1000;
      setSpeed(kmh, boost);
    },
    setRearView(texture) {
      if (!cabin.mirrorsMapped) return;
      if (texture && rearView.map !== texture) {
        rearView.map = texture;
        rearView.needsUpdate = true;
      }
      cabin.mirrors.forEach((m, i) => (m.material = texture ? rearView : mirrorHome[i]));
    },
    dispose,
  };
}
