/**
 * Tyre marks left on the road by drifting karts: one mesh holding a ring of
 * quads, so the newest marks overwrite the oldest and nothing is allocated
 * while racing.
 */
import * as THREE from "three";

export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly attr: THREE.BufferAttribute;
  private head = 0;
  /** Last rear-wheel positions per kart slot: lx, ly, lz, rx, ry, rz, live. */
  private readonly last = new Map<number, Float32Array>();

  constructor(private readonly cap = 1600) {
    this.pos = new Float32Array(cap * 18);
    const geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.pos, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", this.attr);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x0b0b0d, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  private quad(ax: number, ay: number, az: number, bx: number, by: number, bz: number, half: number): void {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) return;
    const px = (-dz / len) * half;
    const pz = (dx / len) * half;
    const p = this.pos;
    let o = this.head * 18;
    const put = (x: number, y: number, z: number) => {
      p[o++] = x;
      p[o++] = y + 0.07;
      p[o++] = z;
    };
    put(ax - px, ay, az - pz);
    put(ax + px, ay, az + pz);
    put(bx - px, by, bz - pz);
    put(ax + px, ay, az + pz);
    put(bx + px, by, bz + pz);
    put(bx - px, by, bz - pz);
    this.head = (this.head + 1) % this.cap;
    this.attr.needsUpdate = true;
  }

  /** Call every frame for each kart with its rear wheels' world positions; `on` while it is sliding on the ground. */
  track(slot: number, on: boolean, l: THREE.Vector3, r: THREE.Vector3): void {
    let s = this.last.get(slot);
    if (!s) {
      s = new Float32Array(7);
      this.last.set(slot, s);
    }
    if (!on) {
      s[6] = 0;
      return;
    }
    if (s[6] === 0) {
      s.set([l.x, l.y, l.z, r.x, r.y, r.z, 1]);
      return;
    }
    const moved = Math.hypot(l.x - s[0], l.z - s[2]);
    if (moved < 0.45) return;
    // A jump in position (respawn, teleport) starts a new mark instead of drawing a line across the track.
    if (moved < 6) {
      this.quad(s[0], s[1], s[2], l.x, l.y, l.z, 0.17);
      this.quad(s[3], s[4], s[5], r.x, r.y, r.z, 0.17);
    }
    s.set([l.x, l.y, l.z, r.x, r.y, r.z, 1]);
  }

  clear(): void {
    this.pos.fill(0);
    this.attr.needsUpdate = true;
    this.last.clear();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
