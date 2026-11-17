import { randomInt } from "node:crypto";
import { CODE_ALPHABET, CODE_LENGTH } from "@office-kart/shared";

const active = new Set<string>();

/** Cryptographically random six-character lobby code, unique among live rooms. */
export function reserveCode(): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!active.has(code)) {
      active.add(code);
      return code;
    }
  }
  throw new Error("Could not allocate a lobby code");
}

export function releaseCode(code: string): void {
  active.delete(code);
}

export function activeRoomCount(): number {
  return active.size;
}
