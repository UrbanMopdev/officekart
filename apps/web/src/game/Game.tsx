import { useState } from "react";
import { Canvas } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import { World } from "./World";

export function Game() {
  const [dpr, setDpr] = useState(() => Math.min(window.devicePixelRatio || 1, 1.75));
  return (
    <Canvas
      className="!absolute inset-0"
      dpr={dpr}
      camera={{ fov: 62, near: 0.3, far: 900, position: [0, 95, -175] }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      {/* Drop the render resolution on machines that cannot hold frame rate. */}
      <PerformanceMonitor onDecline={() => setDpr(1)} />
      <World />
    </Canvas>
  );
}
