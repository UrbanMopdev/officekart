/**
 * Physically based materials built on photo-scanned textures.
 *
 * Ground textures are projected in world space rather than through mesh UVs,
 * so the road, the verges and the landscape share one continuous grain, and
 * cliffs are textured from the side instead of being smeared from above.
 * Each helper patches three's standard material, so lighting, shadows, fog and
 * reflections keep working exactly as for any other surface.
 */
import * as THREE from "three";
import { worldTexture } from "./assets";

type Shader = Parameters<NonNullable<THREE.Material["onBeforeCompile"]>>[0];

const VARYINGS = "varying vec3 vWPos;\nvarying vec3 vWNrm;";

/** Pass world position and world normal to the fragment shader. Works for instanced meshes too. */
function worldVaryings(shader: Shader): void {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${VARYINGS}`)
    .replace(
      "#include <beginnormal_vertex>",
      `#include <beginnormal_vertex>
      #ifdef USE_INSTANCING
        vWNrm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
      #else
        vWNrm = normalize(mat3(modelMatrix) * objectNormal);
      #endif`,
    )
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
      #else
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      #endif`,
    );
  shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>\n${VARYINGS}`);
}

/** 0 dry .. 1 soaked. Shared by every road, and driven by the weather. */
export const roadWet = { value: 0 };

export interface TerrainLook {
  ground: string;
  rock: string;
  /** Metres of world per texture repeat. */
  groundSize: number;
  rockSize: number;
  groundTint: THREE.ColorRepresentation;
  rockTint: THREE.ColorRepresentation;
  /** Steepness (0 flat, 1 vertical) over which ground gives way to bare rock. */
  slope: [number, number];
  groundRough: number;
  rockRough: number;
}

/**
 * Landscape: a ground layer on the flats and a rock layer on anything steep,
 * the rock projected from three sides. Vertex colour is kept as a broad tint.
 */
export function terrainMaterial(look: TerrainLook): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const uniforms = {
    tGroundD: { value: worldTexture(`tex/${look.ground}_d.jpg`, true) },
    tGroundN: { value: worldTexture(`tex/${look.ground}_n.jpg`, false) },
    tRockD: { value: worldTexture(`tex/${look.rock}_d.jpg`, true) },
    tRockN: { value: worldTexture(`tex/${look.rock}_n.jpg`, false) },
    uScale: { value: new THREE.Vector2(1 / look.groundSize, 1 / look.rockSize) },
    uGroundTint: { value: new THREE.Color(look.groundTint) },
    uRockTint: { value: new THREE.Color(look.rockTint) },
    uSlope: { value: new THREE.Vector2(...look.slope) },
    uRough: { value: new THREE.Vector2(look.groundRough, look.rockRough) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    worldVaryings(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D tGroundD; uniform sampler2D tGroundN; uniform sampler2D tRockD; uniform sampler2D tRockN;
        uniform vec2 uScale; uniform vec3 uGroundTint; uniform vec3 uRockTint; uniform vec2 uSlope; uniform vec2 uRough;
        float tRockW; vec3 tWorldN;`,
      )
      .replace(
        "#include <map_fragment>",
        `vec3 wn = normalize(vWNrm);
        vec2 gu = vWPos.xz * uScale.x;
        // Two scales of the same photo, so the repeat does not show from a distance.
        vec3 gFine = texture2D(tGroundD, gu).rgb;
        vec3 gWide = texture2D(tGroundD, gu * 0.137 + 0.31).rgb;
        vec3 gd = mix(gFine, gWide, 0.45);
        vec3 bw = pow(abs(wn), vec3(5.0));
        bw /= (bw.x + bw.y + bw.z);
        vec2 rx = vWPos.zy * uScale.y; vec2 ry = vWPos.xz * uScale.y; vec2 rz = vWPos.xy * uScale.y;
        vec3 rd = texture2D(tRockD, rx).rgb * bw.x + texture2D(tRockD, ry).rgb * bw.y + texture2D(tRockD, rz).rgb * bw.z;
        rd = mix(rd, texture2D(tRockD, rz * 0.23).rgb * bw.z + texture2D(tRockD, rx * 0.23).rgb * bw.x + texture2D(tRockD, ry * 0.23).rgb * bw.y, 0.35);
        float patchy = gWide.g - 0.5;
        tRockW = smoothstep(uSlope.x, uSlope.y, (1.0 - wn.y) + patchy * 0.12);
        diffuseColor.rgb *= mix(gd * uGroundTint, rd * uRockTint, tRockW);
        // World-space bump from both layers.
        vec3 gn = texture2D(tGroundN, gu).xyz * 2.0 - 1.0;
        vec3 nx = texture2D(tRockN, rx).xyz * 2.0 - 1.0;
        vec3 ny = texture2D(tRockN, ry).xyz * 2.0 - 1.0;
        vec3 nz = texture2D(tRockN, rz).xyz * 2.0 - 1.0;
        vec3 nG = wn + vec3(gn.x, 0.0, gn.y) * 0.9;
        vec3 nR = wn + (vec3(0.0, nx.y, nx.x) * bw.x + vec3(ny.x, 0.0, ny.y) * bw.y + vec3(nz.x, nz.y, 0.0) * bw.z) * 1.3;
        tWorldN = normalize(mix(nG, nR, tRockW));`,
      )
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = mix(uRough.x, uRough.y, tRockW);")
      .replace("#include <normal_fragment_maps>", "normal = normalize(mat3(viewMatrix) * tWorldN);");
  };
  mat.customProgramCacheKey = () => "terrain";
  return mat;
}

export interface GroundLook {
  texture: string;
  size: number;
  tint?: THREE.ColorRepresentation;
  roughness?: number;
  bump?: number;
}

/** A flat-ish surface (verge, deck, shoulder) covered in one world-projected ground photo. */
export function groundMaterial(look: GroundLook, params: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: look.roughness ?? 0.95, metalness: 0, ...params });
  const uniforms = {
    tD: { value: worldTexture(`tex/${look.texture}_d.jpg`, true) },
    tN: { value: worldTexture(`tex/${look.texture}_n.jpg`, false) },
    uP: { value: new THREE.Vector2(1 / look.size, look.bump ?? 0.8) },
    uTint: { value: new THREE.Color(look.tint ?? "#ffffff") },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    worldVaryings(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D tD; uniform sampler2D tN; uniform vec2 uP; uniform vec3 uTint; vec3 tWorldN;")
      .replace(
        "#include <map_fragment>",
        `vec2 gu = vWPos.xz * uP.x;
        vec3 gd = mix(texture2D(tD, gu).rgb, texture2D(tD, gu * 0.137 + 0.31).rgb, 0.4);
        diffuseColor.rgb *= gd * uTint;
        vec3 gn = texture2D(tN, gu).xyz * 2.0 - 1.0;
        tWorldN = normalize(normalize(vWNrm) * (gl_FrontFacing ? 1.0 : -1.0) + vec3(gn.x, 0.0, gn.y) * uP.y);`,
      )
      .replace("#include <normal_fragment_maps>", "normal = normalize(mat3(viewMatrix) * tWorldN);");
  };
  mat.customProgramCacheKey = () => "ground";
  return mat;
}

/**
 * Tarmac: photographed asphalt in world space, with the painted lines taken
 * from the track's own line texture and worn by the grain underneath.
 */
export function roadMaterial(lines: THREE.Texture, tint: THREE.ColorRepresentation, roughness: number, metalness: number, circuit = false): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ map: lines, roughness, metalness });
  const uniforms = {
    tD: { value: worldTexture("tex/asphalt_d.jpg", true, 16) },
    tN: { value: worldTexture("tex/asphalt_n.jpg", false, 16) },
    uTint: { value: new THREE.Color(tint) },
    uCircuit: { value: circuit ? 1 : 0 },
    uWet: roadWet,
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    worldVaryings(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D tD; uniform sampler2D tN; uniform vec3 uTint; uniform float uCircuit; uniform float uWet; vec3 tWorldN; float tPaint; float tRubber;")
      .replace(
        "#include <map_fragment>",
        `vec4 lines = texture2D(map, vMapUv);
        vec2 au = vWPos.xz * 0.11;
        vec3 fine = texture2D(tD, au).rgb;
        vec3 wide = texture2D(tD, au * 0.19 + 0.4).rgb;
        vec3 asp = mix(fine, wide, 0.4) * uTint;
        float grain = clamp(dot(fine, vec3(0.333)) / max(dot(wide, vec3(0.333)), 0.004), 0.5, 1.6);
        tPaint = smoothstep(0.14, 0.45, max(lines.r, max(lines.g, lines.b)));
        // Paint sits on the high spots of the grain and has worn off the low ones.
        tPaint *= smoothstep(0.55, 0.95, grain + 0.25);
        float across = vMapUv.x;
        float along = vMapUv.y;
        // A real circuit has edge lines only, and they are thin, off-white and scuffed.
        float edge = max(smoothstep(0.1, 0.06, across), smoothstep(0.9, 0.94, across));
        tPaint *= mix(1.0, edge * (0.55 + 0.45 * smoothstep(0.3, 0.6, wide.g * 9.0)), uCircuit);
        // The racing line: rubber laid down where cars actually drive, wandering from side to side.
        float line = 0.5 + 0.2 * sin(along * 0.55) + 0.07 * sin(along * 1.7 + 1.3);
        tRubber = uCircuit * smoothstep(0.24, 0.02, abs(across - line)) * (0.55 + 0.45 * sin(along * 0.23 + 2.0));
        tRubber = max(tRubber, 0.0);
        // Patch repairs, tar seams and a centre joint.
        float repair = smoothstep(0.62, 0.66, texture2D(tD, vWPos.xz * 0.0031 + 0.7).g * 12.0 - floor(texture2D(tD, vWPos.xz * 0.0031 + 0.7).g * 12.0)) * uCircuit;
        float seam = uCircuit * (1.0 - smoothstep(0.0, 0.004, abs(across - 0.5))) * 0.5;
        float crack = uCircuit * smoothstep(0.985, 1.0, sin(vWPos.x * 0.9 + sin(vWPos.z * 0.6) * 2.5) * sin(vWPos.z * 0.83 + sin(vWPos.x * 0.5) * 2.0));
        // Dust and bleaching towards the edges where nobody drives.
        float dusty = uCircuit * smoothstep(0.34, 0.5, abs(across - 0.5)) * 0.35;
        asp *= 1.0 - 0.34 * tRubber - 0.12 * repair - seam * 0.4 - crack * 0.5;
        asp = mix(asp, asp * 1.5 + vec3(0.012, 0.011, 0.009), dusty);
        vec3 paintCol = mix(lines.rgb * (0.62 + 0.2 * grain), vec3(0.74, 0.73, 0.69) * (0.75 + 0.25 * grain), uCircuit);
        // Wet tarmac is darker, and standing water smooths the grain away.
        asp *= mix(1.0, 0.55, uWet);
        diffuseColor.rgb *= mix(asp, paintCol, tPaint);
        vec3 an = texture2D(tN, au).xyz * 2.0 - 1.0;
        float film = uWet * (0.55 + 0.45 * smoothstep(0.35, 0.65, wide.g * 9.0));
        tWorldN = normalize(normalize(vWNrm) + vec3(an.x, 0.0, an.y) * 0.75 * (1.0 - 0.8 * film));`,
      )
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = roughness * mix(1.0, 0.72, tPaint) * (1.0 - 0.3 * tRubber) * (1.0 - 0.72 * uWet * (0.55 + 0.45 * smoothstep(0.35, 0.65, texture2D(tD, vWPos.xz * 0.0209 + 0.4).g * 9.0)));")
      .replace("#include <normal_fragment_maps>", "normal = normalize(mat3(viewMatrix) * tWorldN);");
  };
  mat.customProgramCacheKey = () => "road";
  return mat;
}

/**
 * Kerbs: painted concrete that has been driven over for years. The colour
 * comes from the mesh; the paint is chipped back to concrete and blackened
 * with rubber.
 */
export function kerbMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, side: THREE.DoubleSide });
  const uniforms = { tD: { value: worldTexture("tex/asphalt_d.jpg", true, 16) }, tN: { value: worldTexture("tex/asphalt_n.jpg", false, 16) } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    worldVaryings(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D tD; uniform sampler2D tN; vec3 tWorldN;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec2 ku = vWPos.xz * 0.21;
        float fine = dot(texture2D(tD, ku).rgb, vec3(0.333));
        float wide = dot(texture2D(tD, ku * 0.13 + 0.2).rgb, vec3(0.333));
        float grainK = clamp(fine / max(wide, 0.004), 0.4, 1.7);
        float chips = smoothstep(0.85, 1.15, 1.25 - grainK + (wide * 14.0 - 0.45)) * 0.6;
        float scuff = smoothstep(0.4, 0.75, sin(vWPos.x * 0.35 + vWPos.z * 0.27) * 0.5 + 0.5 + (grainK - 1.0) * 0.6);
        vec3 concrete = vec3(0.34, 0.33, 0.31) * (0.7 + 0.3 * grainK);
        diffuseColor.rgb = mix(diffuseColor.rgb * (0.7 + 0.25 * grainK), concrete, chips * 0.75);
        diffuseColor.rgb *= 1.0 - 0.3 * scuff;
        vec3 kn = texture2D(tN, ku).xyz * 2.0 - 1.0;
        tWorldN = normalize(normalize(vWNrm) * (gl_FrontFacing ? 1.0 : -1.0) + vec3(kn.x, 0.0, kn.y) * 0.6);`,
      )
      .replace("#include <normal_fragment_maps>", "normal = normalize(mat3(viewMatrix) * tWorldN);");
  };
  mat.customProgramCacheKey = () => "kerb";
  return mat;
}

/** Settle snow on whatever faces the sky: rocks, barriers, branches. */
export function snowCap<T extends THREE.MeshStandardMaterial>(mat: T, amount = 1): T {
  const uniforms = { uSnow: { value: amount } };
  const previous = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    previous?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    worldVaryings(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uSnow; float tSnow;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float snowBreak = fract(sin(dot(floor(vWPos.xz * 3.0), vec2(12.9898, 78.233))) * 43758.5453) * 0.18;
        tSnow = smoothstep(0.42, 0.72, normalize(vWNrm).y * (gl_FrontFacing ? 1.0 : -1.0) + snowBreak * 0.6) * uSnow;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.97), tSnow);`,
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.85, tSnow);");
  };
  mat.customProgramCacheKey = () => `snow:${amount}`;
  return mat;
}

/**
 * A frozen lake: wind-swept snow lying in drifts over dark, glassy ice that
 * mirrors the sky.
 */
export function iceMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.1, metalness: 0 });
  const uniforms = {
    tD: { value: worldTexture("tex/snow_d.jpg", true) },
    tN: { value: worldTexture("tex/snow_n.jpg", false) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    worldVaryings(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D tD; uniform sampler2D tN; float tDrift; vec3 tWorldN;")
      .replace(
        "#include <map_fragment>",
        `vec2 gu = vWPos.xz * 0.05;
        vec3 snow = texture2D(tD, gu).rgb;
        // Long drifts, drawn out along the wind.
        float d1 = texture2D(tD, vWPos.xz * vec2(0.004, 0.011) + 0.2).g;
        float d2 = texture2D(tD, vWPos.xz * vec2(0.019, 0.043)).g;
        tDrift = smoothstep(0.50, 0.62, d1 * 0.65 + d2 * 0.35);
        // Cracks and trapped bubbles in the clear ice.
        float crack = texture2D(tN, vWPos.xz * 0.012).r;
        vec3 ice = vec3(0.035, 0.085, 0.11) + vec3(0.25, 0.35, 0.38) * smoothstep(0.56, 0.6, crack) * 0.5;
        diffuseColor.rgb *= mix(ice, snow, tDrift);
        vec3 gn = texture2D(tN, gu).xyz * 2.0 - 1.0;
        tWorldN = normalize(vec3(0.0, 1.0, 0.0) + vec3(gn.x, 0.0, gn.y) * mix(0.03, 0.8, tDrift));`,
      )
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = mix(0.07, 0.9, tDrift);")
      .replace("#include <normal_fragment_maps>", "normal = normalize(mat3(viewMatrix) * tWorldN);");
  };
  mat.customProgramCacheKey = () => "ice";
  return mat;
}

/**
 * Lava: a dark crust that drifts and splits over glowing melt. The glow is
 * far brighter than white, so bloom turns it into light.
 */
export function lavaMaterial(): { material: THREE.ShaderMaterial; tick: (time: number) => void } {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      tCrust: { value: worldTexture("tex/basalt_d.jpg", true) },
      fogColor: { value: new THREE.Color() },
      fogNear: { value: 1 },
      fogFar: { value: 1000 },
    },
    fog: true,
    vertexShader: `varying vec3 vW; varying float vDepth;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uTime; uniform sampler2D tCrust; uniform vec3 fogColor; uniform float fogNear; uniform float fogFar;
      varying vec3 vW; varying float vDepth;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p) { float a = 0.5; float s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
      void main() {
        vec2 p = vW.xz * 0.018;
        vec2 flow = vec2(uTime * 0.012, uTime * 0.007);
        // The crust is carried along and folded by the current underneath.
        vec2 warp = vec2(fbm(p * 1.3 + flow), fbm(p * 1.3 - flow + 5.2));
        float plates = fbm(p * 2.2 + warp * 1.6 + flow * 0.6);
        float cracks = 1.0 - smoothstep(0.0, 0.11, abs(plates - 0.5));
        float pools = smoothstep(0.58, 0.8, fbm(p * 0.6 - flow * 0.8 + warp));
        float heat = clamp(cracks * 0.85 + pools * 1.2, 0.0, 1.6);
        heat *= 0.8 + 0.2 * sin(uTime * 0.9 + plates * 20.0);
        vec3 crust = texture2D(tCrust, vW.xz * 0.03 + warp * 0.05).rgb * vec3(0.5, 0.42, 0.4);
        vec3 glow = mix(vec3(1.6, 0.16, 0.02), vec3(5.5, 1.9, 0.35), smoothstep(0.35, 1.2, heat));
        vec3 col = mix(crust + vec3(0.25, 0.03, 0.0) * (1.0 - cracks), glow, smoothstep(0.15, 0.6, heat));
        float fog = smoothstep(fogNear, fogFar, vDepth);
        gl_FragColor = vec4(mix(col, fogColor, fog), 1.0);
      }`,
  });
  return { material, tick: (time) => (material.uniforms.uTime.value = time) };
}
