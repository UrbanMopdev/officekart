import { Bloom, EffectComposer, N8AO, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import type { TrackTheme } from "@office-kart/shared";
import type { Quality } from "../store";

/**
 * Post-processing. Rendering is HDR: lights and glowing surfaces are brighter
 * than white, bloom picks up only those, and filmic tone mapping brings the
 * result back into range.
 */
export function Effects({ quality, theme }: { quality: Quality; theme: TrackTheme }) {
  const neon = theme === "neon" || theme === "chaos" || theme === "volcano";
  return (
    <EffectComposer multisampling={4} enableNormalPass={false}>
      {quality === "high" ? <N8AO halfRes quality="medium" aoRadius={3.2} distanceFalloff={1} intensity={neon ? 1.6 : 2.4} /> : <></>}
      <Bloom mipmapBlur intensity={neon ? 1.15 : 0.5} luminanceThreshold={1} luminanceSmoothing={0.25} radius={0.8} />
      <Vignette offset={0.22} darkness={neon ? 0.7 : 0.5} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
