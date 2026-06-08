// Order keys ("fractional indexing") for list/folder ordering.
//
// Backed by the battle-tested `fractional-indexing` library (rocicorp/Figma,
// MIT) at its default base-62 alphabet. This module is the single seam over
// that dependency: it adds the one thing the library doesn't provide —
// `isValidRank` (the library throws on malformed keys, so we must detect
// legacy/corrupt ranks before calling it) — plus null-bound convenience.
//
// Why order keys and not a hand-rolled "midpoint between two strings": a naive
// midpoint cannot reliably insert BEFORE the current first key — once the
// minimum decays toward the floor it overshoots and returns a key GREATER than
// the target (the "new folder lands at the bottom" bug). Order keys carry an
// integer magnitude header (`a0`, `Zz`, …) giving unbounded headroom in both
// directions with no decay. Keys are compared with plain string `<`, matching
// sortByRank.
import {
  generateKeyBetween as fiBetween,
  generateNKeysBetween as fiNBetween,
  BASE_62_DIGITS as BASE,
} from "fractional-indexing";

// `getIntegerLength` / `SMALLEST_INTEGER` / the validation below intentionally
// mirror the library's (un-exported) internals so we can detect legacy /
// corrupt ranks before handing them to the library, which throws on bad input.
const SMALLEST_INTEGER = "A" + "0".repeat(25); // 'A' header ⇒ length 27

const getIntegerLength = (head) => {
  if (head >= "a" && head <= "z") return head.charCodeAt(0) - "a".charCodeAt(0) + 2;
  if (head >= "A" && head <= "Z") return "Z".charCodeAt(0) - head.charCodeAt(0) + 2;
  return 0;
};

/**
 * True for well-formed order keys in the library's default base-62 format.
 * Used to detect legacy / corrupted ranks so ensureRanks can migrate them.
 * Mirrors the library's own validation so we never hand it a key it rejects.
 */
export const isValidRank = (key) => {
  if (typeof key !== "string" || key.length === 0) return false;
  if (key === SMALLEST_INTEGER) return false;
  for (const c of key) if (BASE.indexOf(c) === -1) return false;
  const len = getIntegerLength(key[0]);
  if (len === 0 || len > key.length) return false;
  const fractional = key.slice(len);
  if (fractional[fractional.length - 1] === "0") return false; // can't end in 0
  return true;
};

/** Order key strictly between a and b (nullish bound = open). Never overshoots. */
export const generateKeyBetween = (a, b) => fiBetween(a ?? null, b ?? null);

/** n order keys evenly spread strictly between a and b. */
export const generateNKeysBetween = (a, b, n) => fiNBetween(a ?? null, b ?? null, n);
