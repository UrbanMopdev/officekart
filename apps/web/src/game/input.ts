/** Keyboard input, sampled once per simulation tick. */
import { INPUT_BITS } from "@office-kart/shared";

const down = new Set<string>();

/** State of the on-screen controls, written by the touch overlay. */
export const touch = {
  /** A finger is on the steering pad; `steer` is its analogue value, -1..1. */
  steering: false,
  steer: 0,
  gas: false,
  brake: false,
  drift: false,
  use: false,
  reset: false,
  /** Accelerate without holding anything (the default on phones). */
  autoGas: false,
};
let resetQueued = false;
let steer = 0;
let enabled = false;

const GAME_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "KeyR", "ShiftLeft", "ShiftRight", "KeyE"]);

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

window.addEventListener("keydown", (e) => {
  if (!enabled || isTyping(e.target)) return;
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  if (e.code === "KeyR" && !e.repeat) resetQueued = true;
  down.add(e.code);
});
window.addEventListener("keyup", (e) => down.delete(e.code));
window.addEventListener("blur", () => down.clear());

export function setInputEnabled(on: boolean): void {
  enabled = on;
  if (!on) {
    down.clear();
    resetQueued = false;
    steer = 0;
  }
}

/** Returns [inputBits, steer] for this tick. */
export function sampleInput(): [number, number] {
  let bits = 0;
  if (down.has("KeyW") || down.has("ArrowUp") || touch.gas || (touch.autoGas && !touch.brake)) bits |= INPUT_BITS.ACCEL;
  if (down.has("KeyS") || down.has("ArrowDown") || touch.brake) bits |= INPUT_BITS.BRAKE;
  if (down.has("Space") || touch.drift) bits |= INPUT_BITS.DRIFT;
  if (touch.use) bits |= INPUT_BITS.USE;
  if (touch.reset) {
    resetQueued = true;
    touch.reset = false;
  }
  if (down.has("ShiftLeft") || down.has("ShiftRight") || down.has("KeyE")) bits |= INPUT_BITS.USE;
  if (resetQueued) {
    bits |= INPUT_BITS.RESET;
    resetQueued = false;
  }
  if (touch.steering) {
    // The steering pad is already analogue: use it as it is.
    steer = Math.round(Math.max(-1, Math.min(1, touch.steer)) * 100) / 100;
    return [bits, steer];
  }
  const left = down.has("KeyA") || down.has("ArrowLeft");
  const right = down.has("KeyD") || down.has("ArrowRight");
  const target = (right ? 1 : 0) - (left ? 1 : 0);
  // Ease the digital keys into an analogue value so steering is not twitchy.
  // The eased value is what gets sent, so client and server stay identical.
  steer += (target - steer) * (target === 0 ? 0.5 : 0.34);
  if (Math.abs(target - steer) < 0.02) steer = target;
  steer = Math.round(steer * 100) / 100;
  return [bits, steer];
}
