/** Builds and animates one kart. Imperative three.js: karts update every frame. */
import * as THREE from "three";
import { FLAG, KART_COLORS } from "@office-kart/shared";
import { labelTexture } from "./textures";

const SPARK_COLORS = ["#cbd5e1", "#38bdf8", "#fb923c", "#e879f9"];

const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.36, 14).rotateZ(Math.PI / 2);
const wheelMat = new THREE.MeshLambertMaterial({ color: "#111827" });
const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.38, 8).rotateZ(Math.PI / 2);
const hubMat = new THREE.MeshLambertMaterial({ color: "#e2e8f0" });
const darkMat = new THREE.MeshLambertMaterial({ color: "#1f2937" });
const shirtMat = new THREE.MeshLambertMaterial({ color: "#f8fafc" });
const visorMat = new THREE.MeshLambertMaterial({ color: "#0f172a" });
const shadowGeo = new THREE.CircleGeometry(1.5, 20).rotateX(-Math.PI / 2);
const shadowMat = new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.22, depthWrite: false });
const sparkGeo = new THREE.OctahedronGeometry(0.26);
const flameGeo = new THREE.ConeGeometry(0.34, 1.5, 10).rotateX(-Math.PI / 2);

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

export class KartVisual {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly sparks: THREE.Mesh[] = [];
  private readonly sparkMat = new THREE.MeshBasicMaterial({ color: SPARK_COLORS[0] });
  private readonly flames: THREE.Mesh[] = [];
  private readonly label: THREE.Sprite;
  private readonly paint: THREE.MeshLambertMaterial;
  private readonly trim: THREE.MeshLambertMaterial;
  private slide = 0;
  private hop = 0;
  private wasDrifting = false;
  private colorIndex = -1;
  private labelText = "";

  constructor() {
    this.paint = new THREE.MeshLambertMaterial({ color: "#ffffff" });
    this.trim = new THREE.MeshLambertMaterial({ color: "#ffffff" });
    const b = this.body;
    // Kart faces +z. Roughly 1.7 wide, 2.6 long.
    b.add(box(1.5, 0.36, 2.5, this.paint, 0, 0.5, 0));
    b.add(box(1.0, 0.3, 0.6, this.trim, 0, 0.56, 1.35));
    b.add(box(0.34, 0.3, 1.3, darkMat, -0.78, 0.6, 0));
    b.add(box(0.34, 0.3, 1.3, darkMat, 0.78, 0.6, 0));
    b.add(box(0.95, 0.75, 0.22, darkMat, 0, 1.0, -0.62));
    b.add(box(0.1, 0.5, 0.1, darkMat, 0, 0.9, 0.55));
    b.add(box(0.5, 0.08, 0.08, darkMat, 0, 1.15, 0.5));
    b.add(box(1.6, 0.08, 0.4, this.trim, 0, 1.28, -1.2));
    b.add(box(0.1, 0.55, 0.1, darkMat, -0.6, 0.98, -1.2));
    b.add(box(0.1, 0.55, 0.1, darkMat, 0.6, 0.98, -1.2));
    // Driver
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.7, 12), shirtMat);
    torso.position.set(0, 1.1, -0.2);
    b.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), this.trim);
    head.position.set(0, 1.78, -0.2);
    b.add(head);
    b.add(box(0.62, 0.2, 0.3, visorMat, 0, 1.8, 0.05));
    for (const [x, z] of [
      [-0.9, 0.85],
      [0.9, 0.85],
      [-0.9, -0.85],
      [0.9, -0.85],
    ]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(x, 0.42, z);
      b.add(w);
      const hub = new THREE.Mesh(hubGeo, hubMat);
      hub.position.set(x, 0.42, z);
      b.add(hub);
    }
    for (const x of [-0.9, 0.9]) {
      const s = new THREE.Mesh(sparkGeo, this.sparkMat);
      s.position.set(x, 0.25, -1.35);
      s.visible = false;
      b.add(s);
      this.sparks.push(s);
    }
    for (const x of [-0.4, 0.4]) {
      const f = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: "#fb923c", transparent: true, opacity: 0.9 }));
      f.position.set(x, 0.55, -1.95);
      f.visible = false;
      b.add(f);
      this.flames.push(f);
    }
    this.group.add(this.body);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.position.y = 0.08;
    this.group.add(shadow);

    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
    this.label.scale.set(5.5, 1.2, 1);
    this.label.position.y = 3.3;
    this.group.add(this.label);
  }

  setIdentity(name: string, colorIndex: number, showLabel: boolean): void {
    if (colorIndex !== this.colorIndex) {
      this.colorIndex = colorIndex;
      const base = new THREE.Color(KART_COLORS[colorIndex % KART_COLORS.length]);
      this.paint.color.copy(base);
      this.trim.color.copy(base).lerp(new THREE.Color("#ffffff"), 0.45);
      this.labelText = "";
    }
    if (name !== this.labelText) {
      this.labelText = name;
      const mat = this.label.material;
      mat.map?.dispose();
      mat.map = labelTexture(name, KART_COLORS[colorIndex % KART_COLORS.length]);
      mat.needsUpdate = true;
    }
    this.label.visible = showLabel;
  }

  update(x: number, z: number, heading: number, speed: number, flags: number, dt: number, time: number): void {
    this.group.position.set(x, 0, z);
    this.group.rotation.y = heading;

    const drift = flags & FLAG.DRIFT_LEFT ? -1 : flags & FLAG.DRIFT_RIGHT ? 1 : 0;
    const level = (flags >> FLAG.LEVEL_SHIFT) & 3;
    const boosting = (flags & FLAG.BOOST) !== 0;

    if (drift !== 0 && !this.wasDrifting) this.hop = 1;
    this.wasDrifting = drift !== 0;
    this.hop = Math.max(0, this.hop - dt * 3.6);

    // Angle the body into the slide; a right-hand drift turns the nose right (negative yaw).
    const k = 1 - Math.exp(-dt * 10);
    this.slide += (-drift * 0.38 - this.slide) * k;
    this.body.rotation.y = this.slide;
    this.body.rotation.z = this.slide * 0.25;
    this.body.position.y = Math.sin(this.hop * Math.PI) * 0.55 + (boosting ? Math.sin(time * 60) * 0.02 : 0);

    const showSparks = drift !== 0 && Math.abs(speed) > 4;
    this.sparkMat.color.set(SPARK_COLORS[level]);
    for (let i = 0; i < this.sparks.length; i++) {
      const s = this.sparks[i];
      s.visible = showSparks;
      if (showSparks) {
        const pulse = 0.7 + level * 0.35 + Math.sin(time * 40 + i * 2.1) * 0.3;
        s.scale.setScalar(pulse);
        s.rotation.set(time * 9, time * 13 + i, 0);
        s.position.y = 0.22 + Math.abs(Math.sin(time * 31 + i)) * 0.25;
      }
    }
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      f.visible = boosting;
      if (boosting) f.scale.set(1, 1, 0.8 + Math.abs(Math.sin(time * 45 + i)) * 0.7);
    }
  }

  dispose(): void {
    this.label.material.map?.dispose();
    this.label.material.dispose();
    this.paint.dispose();
    this.trim.dispose();
    this.sparkMat.dispose();
  }
}
