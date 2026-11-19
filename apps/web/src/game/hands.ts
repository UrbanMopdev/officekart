/**
 * The driver's hands on the steering wheel, in the first-person view: two gloved hands gripping the
 * rim at a quarter to three, turning with the wheel, and forearms in the sleeves of a race suit that
 * follow them from the driver's elbows.
 *
 * The hand is the open "generic hand" model from the WebXR Input Profiles project (MIT licence),
 * which is rigged: its fingers are curled round the rim here rather than modelled gripping.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type Side = "l" | "r";
const FINGERS = ["index", "middle", "ring", "pinky"] as const;

/** How the grip is posed. Angles in radians; lengths in metres. Tuned by eye against real cabins. */
export const GRIP = {
  /** Finger curl at the three joints from the knuckle outwards. */
  curl: [1.05, 1.35, 0.75],
  /** The little finger closes a touch more, the index a touch less. */
  spread: [-0.12, 0, 0.08, 0.16],
  thumb: [0.35, 0.3, 0.45],
  /** Thumb swung in across the palm. */
  thumbIn: 0.55,
  /** Where the rim runs through the hand, in the model's own space (left hand; mirrored for the right). */
  hold: [-0.012, -0.036, 0.004],
  /** Extra turn of the whole hand about the rim, so the wrist drops towards the driver's lap. */
  roll: 0.5,
  /** Tilt of the knuckle line off the rim. */
  yaw: 0.12,
  pitch: -0.1,
  /** Hands sit a little above the middle of the wheel. */
  clock: 0.16,
  /** The driver's elbows relative to the eyes: out to the side, down, forwards. */
  elbow: [0.27, -0.44, 0.1],
  forearm: [0.031, 0.044],
  /** How far inside the rim's centre line the hand sits, so the fingers close round it. */
  inset: 0.02,
  /** And how far towards the driver. */
  proud: 0.004,
};

interface HandModel {
  scene: THREE.Group;
  wrist: THREE.Object3D;
}
const models: Partial<Record<Side, HandModel>> = {};
let state: "idle" | "loading" | "ready" | "failed" = "idle";
let version = 0;
export const handsVersion = (): number => version;

/** Rebuild the flat list of joints as a proper skeleton, so a knuckle carries the rest of its finger. */
function rig(scene: THREE.Group): HandModel {
  scene.updateMatrixWorld(true);
  const get = (name: string): THREE.Object3D => {
    const o = scene.getObjectByName(name);
    if (!o) throw new Error(`hand model has no ${name}`);
    return o;
  };
  const wrist = get("wrist");
  const chain = (names: string[]): void => {
    let parent = wrist;
    for (const n of names) {
      const bone = get(n);
      parent.attach(bone);
      parent = bone;
    }
  };
  for (const f of FINGERS) chain([`${f}-finger-metacarpal`, `${f}-finger-phalanx-proximal`, `${f}-finger-phalanx-intermediate`, `${f}-finger-phalanx-distal`, `${f}-finger-tip`]);
  chain(["thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip"]);
  return { scene, wrist };
}

let loading: Promise<boolean> | null = null;
/** Fetch the hand models. Safe to call more than once; resolves true when they are ready. */
export function loadHands(): Promise<boolean> {
  if (loading) return loading;
  state = "loading";
  const loader = new GLTFLoader();
  loading = Promise.all((["l", "r"] as Side[]).map(async (side) => (models[side] = rig((await loader.loadAsync(`/world/models/hand_${side}.glb`)).scene)))).then(
    () => {
      state = "ready";
      version++;
      return true;
    },
    (err) => {
      state = "failed";
      console.warn("The driver's hands could not be loaded.", err);
      return false;
    },
  );
  return loading;
}

/** Close one hand round a rim. Joints bend about their own x axis; a negative turn closes the finger. */
function grip(model: HandModel, side: Side, g: typeof GRIP): void {
  const bend = (name: string, angle: number): void => {
    const b = model.scene.getObjectByName(name);
    if (!b) return;
    b.userData.rest ??= b.quaternion.clone();
    b.quaternion.copy(b.userData.rest as THREE.Quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -angle));
  };
  FINGERS.forEach((f, i) => {
    const more = 1 + g.spread[i];
    bend(`${f}-finger-phalanx-proximal`, g.curl[0] * more);
    bend(`${f}-finger-phalanx-intermediate`, g.curl[1] * more);
    bend(`${f}-finger-phalanx-distal`, g.curl[2] * more);
  });
  bend("thumb-phalanx-proximal", g.thumb[1]);
  bend("thumb-phalanx-distal", g.thumb[2]);
  // The thumb's base swings across the palm about the hand's long axis.
  const base = model.scene.getObjectByName("thumb-metacarpal");
  if (base) {
    base.userData.rest ??= base.quaternion.clone();
    const sign = side === "l" ? 1 : -1;
    base.quaternion
      .copy(base.userData.rest as THREE.Quaternion)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -g.thumbIn * sign))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -g.thumb[0]));
  }
}

export interface DriverHands {
  /** Call after the wheel has been turned, so the forearms follow the hands. */
  update(angle?: number): void;
  remove(): void;
}

/**
 * Put the hands on a wheel. `spin` is the node that turns with the wheel (x to the driver's right, y up
 * the wheel, z at the driver); `shell` is the still cabin it sits in; `eye` is the driver's eyes there.
 */
export function buildHands(spin: THREE.Object3D, shell: THREE.Object3D, radius: number, eye: THREE.Vector3, glove: THREE.Material, sleeve: THREE.Material, g: typeof GRIP = GRIP): DriverHands | null {
  if (state !== "ready") return null;
  const holders: THREE.Group[] = [];
  const arms: { mesh: THREE.Mesh; cuff: THREE.Mesh; wrist: THREE.Object3D; elbow: THREE.Vector3; rest: THREE.Vector3 | null }[] = [];
  const toShell = new THREE.Matrix4();
  const armGeo = new THREE.CylinderGeometry(g.forearm[0], g.forearm[1], 1, 14, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  const cuffGeo = new THREE.CylinderGeometry(g.forearm[0] * 1.12, g.forearm[0] * 1.12, 0.035, 14).rotateX(Math.PI / 2);
  for (const side of ["l", "r"] as Side[]) {
    const model = models[side]!;
    grip(model, side, g);
    const sign = side === "l" ? -1 : 1;
    // Stand the hand up on the rim: palm to the hub, thumb up the rim, fingers round the far side.
    const hand = new THREE.Group();
    hand.add(model.scene);
    model.scene.position.set(side === "l" ? -g.hold[0] : g.hold[0], -g.hold[1], -g.hold[2]);
    const holder = new THREE.Group();
    const at = Math.PI / 2 - g.clock;
    holder.position.set(sign * Math.sin(at) * (radius - g.inset), Math.cos(at) * (radius - g.inset), g.proud);
    // Follow the rim round to where the hand sits, then roll the wrist down and out.
    holder.rotation.set(0, 0, -sign * g.clock);
    hand.rotation.set(Math.PI / 2 + g.pitch, sign * g.roll, sign * g.yaw, "ZYX");
    holder.add(hand);
    spin.add(holder);
    holders.push(holder);
    model.scene.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      m.material = glove;
      m.frustumCulled = false;
      m.receiveShadow = true;
    });
    const mesh = new THREE.Mesh(armGeo, sleeve);
    const cuff = new THREE.Mesh(cuffGeo, sleeve);
    mesh.frustumCulled = cuff.frustumCulled = false;
    mesh.receiveShadow = true;
    shell.add(mesh, cuff);
    arms.push({ mesh, cuff, wrist: model.wrist, elbow: new THREE.Vector3(eye.x - sign * g.elbow[0], eye.y + g.elbow[1], eye.z + g.elbow[2]), rest: null });
  }
  const w = new THREE.Vector3();
  const e = new THREE.Vector3();
  const t = new THREE.Vector3();
  const update = (): void => {
    shell.updateWorldMatrix(true, false);
    spin.updateWorldMatrix(true, true);
    toShell.copy(shell.matrixWorld).invert();
    for (const a of arms) {
      a.wrist.getWorldPosition(w).applyMatrix4(toShell);
      a.rest ??= w.clone();
      // The elbow gives a little as the hand travels round the wheel.
      e.copy(a.elbow).addScaledVector(t.copy(w).sub(a.rest), 0.3);
      a.mesh.position.copy(e);
      a.mesh.lookAt(shell.localToWorld(t.copy(w)));
      a.mesh.scale.set(1, 1, e.distanceTo(w) + 0.01);
      a.cuff.position.copy(w);
      a.cuff.quaternion.copy(a.mesh.quaternion);
    }
  };
  // The arm meshes are aimed in world space, so the shell must not be mid-move when this runs.
  update();
  return {
    update,
    remove() {
      for (const h of holders) h.removeFromParent();
      for (const a of arms) {
        a.mesh.removeFromParent();
        a.cuff.removeFromParent();
      }
      armGeo.dispose();
      cuffGeo.dispose();
    },
  };
}
