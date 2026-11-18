/**
 * The view from the driver's seat. One interior serves every car, sized to it:
 * dashboard, instrument binnacle with a live speed display, a steering wheel
 * that follows the driver's hands, pillars, mirror, door tops and the bonnet in
 * the car's own paint. Built in metres in the car's model space: +z forward,
 * +x to the driver's left, y up from the road.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

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
  wheel: THREE.Group;
  setSpeed(kmh: number, boost: boolean): void;
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
  group.add(new THREE.Mesh(merged([box(0.2, 0.055, 0.012, 0.02, roofY - 0.075, E.z + 0.44, 0.1, 0.12)]), mirrorGlass));
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
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  const screenTex = new THREE.CanvasTexture(canvas);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.124), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
  screen.position.set(E.x, dashY + 0.1, E.z + 0.67);
  screen.rotation.set(0.5, Math.PI, 0);
  group.add(screen);
  let shown = -1;
  const setSpeed = (kmh: number, boost: boolean): void => {
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
    screenTex.needsUpdate = true;
  };
  setSpeed(0, false);

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
    wheel,
    setSpeed,
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
