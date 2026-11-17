import { Canvas } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import { DEFAULT_TRACK_ID, getTrack } from "@office-kart/shared";
import { useStore, type Quality } from "../store";
import { Effects } from "./Effects";
import { World } from "./World";

const STEP_DOWN: Record<Quality, Quality> = { high: "medium", medium: "low", low: "low" };

export function Game() {
  const quality = useStore((s) => s.quality);
  const theme = useStore((s) => getTrack(s.room?.trackId ?? DEFAULT_TRACK_ID).def.theme);
  return (
    // Remount on a quality change: shadow maps and the render pipeline are set up once.
    <Canvas
      key={quality}
      className="!absolute inset-0"
      shadows={quality !== "low"}
      dpr={quality === "low" ? 1 : [1, quality === "high" ? 1.75 : 1.25]}
      camera={{ fov: 62, near: 0.4, far: 1600, position: [0, 95, -175] }}
      gl={{ antialias: quality === "low", powerPreference: "high-performance", stencil: false }}
    >
      {/* If the machine cannot hold frame rate, drop a quality level (unless the player chose one). */}
      <PerformanceMonitor
        flipflops={2}
        onDecline={() => {
          const s = useStore.getState();
          if (!s.qualityLocked) s.setQuality(STEP_DOWN[s.quality], false);
        }}
      />
      <World quality={quality} />
      {quality !== "low" && <Effects quality={quality} theme={theme} />}
    </Canvas>
  );
}
