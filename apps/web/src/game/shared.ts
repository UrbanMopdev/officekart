/** Per-frame kart positions, written by the 3D world and read by the mini-map. */
export const kartPos = new Float32Array(24);
export const kartActive = new Uint8Array(12);

/** How fast it should feel right now, written by the 3D world and read by the screen overlays. */
export const feel = {
  /** 0..1: strength of the speed lines. */
  rush: 0,
  /** True while tucked into another kart's slipstream. */
  draft: false,
};
