import { CODE_ALPHABET, CODE_LENGTH, NAME_MAX_LENGTH } from "./constants";

/**
 * Normalise a player-supplied nickname. Returns null when nothing usable is
 * left. Only letters, digits, spaces and a few punctuation marks survive, so a
 * name can never carry markup or control characters into another client.
 */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} _\-.']/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX_LENGTH)
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Normalise a lobby code typed or pasted by a player. Returns null if invalid. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}

export function formatRaceTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "--:--.---";
  const total = Math.round(ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const milli = total % 1000;
  return `${m}:${String(s).padStart(2, "0")}.${String(milli).padStart(3, "0")}`;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
