import { useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import { DEFAULT_TRACK_ID, getTrack } from "@office-kart/shared";
import { IS_TOUCH, useStore, type Quality } from "../store";
import { Effects } from "./Effects";
import { World } from "./World";

const STEP_DOWN: Record<Quality, Quality> = { high: "medium", medium: "low", low: "low" };
/** Sharpest and softest render scale for each quality level. */
const SCALE: Record<Quality, [number, number]> = { high: [0.8, 1.5], medium: [0.7, 1.25], low: IS_TOUCH ? [0.75, 1.5] : [0.6, 1] };

export function Game() {
  const quality = useStore((s) => s.quality);
  const lobby = useStore((s) => s.room?.phase === "lobby");
  const theme = useStore((s) => getTrack(s.room?.trackId ?? DEFAULT_TRACK_ID).def.theme);
  const device = Math.min(window.devicePixelRatio || 1, SCALE[quality][1]);
  const floor = Math.min(device, SCALE[quality][0]);
  const [dpr, setDpr] = useState(device);
  const struggling = useRef(0);
  useEffect(() => setDpr(device), [device]);

  return (
    // Remount only when the quality level itself changes: shadow maps and the render pipeline are set up once.
    <Canvas
      key={quality}
      className="touch-game !absolute inset-0"
      shadows={quality !== "low"}
      // The lobby fly-around sits behind a panel, so it runs at a lighter resolution.
      dpr={lobby ? Math.min(1, dpr) : dpr}
      camera={{ fov: 62, near: 0.4, far: 1600, position: [0, 95, -175] }}
      gl={{ antialias: quality === "low", powerPreference: "high-performance", stencil: false }}
    >
      {/*
        Hold the frame rate by trading resolution a little at a time, with no interruption.
        Only if the lowest resolution still cannot keep up does the quality level drop.
      */}
      <PerformanceMonitor
        factor={1}
        step={0.2}
        onChange={({ factor }) => {
          setDpr(Math.round((floor + (device - floor) * factor) * 20) / 20);
          struggling.current = factor <= 0.01 ? struggling.current + 1 : 0;
          const s = useStore.getState();
          if (struggling.current >= 3 && !s.qualityLocked && s.room?.phase !== "racing") {
            struggling.current = 0;
            s.setQuality(STEP_DOWN[s.quality], false);
          }
        }}
      />
      <World quality={quality} />
      {quality !== "low" && <Effects quality={lobby ? "medium" : quality} theme={theme} />}
    </Canvas>
  );
}
