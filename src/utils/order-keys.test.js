import { describe, test, expect } from "vitest";
import {
  generateKeyBetween,
  generateNKeysBetween,
  isValidRank,
} from "./order-keys";

describe("generateKeyBetween", () => {
  test("first key, then after / before it, are ordered and valid", () => {
    const first = generateKeyBetween(null, null);
    const after = generateKeyBetween(first, null);
    const before = generateKeyBetween(null, first);
    expect(before < first).toBe(true);
    expect(first < after).toBe(true);
    [first, after, before].forEach((k) => expect(isValidRank(k)).toBe(true));
  });

  test("between two adjacent keys stays strictly between", () => {
    const a = generateKeyBetween(null, null);
    const b = generateKeyBetween(a, null);
    const mid = generateKeyBetween(a, b);
    expect(a < mid).toBe(true);
    expect(mid < b).toBe(true);
  });

  test("throws on invalid neighbour keys (legacy ranks must be migrated first)", () => {
    expect(() => generateKeyBetween("a", "z")).toThrow(); // bare legacy ranks
    expect(() => generateKeyBetween(null, "0000")).toThrow();
  });
});

describe("REGRESSION: repeated insert-before-first never overshoots", () => {
  // This is the bug that put a new folder below the existing minimum: the old
  // midpoint returned a key GREATER than the target once ranks decayed toward
  // the floor. With order keys this can never happen, at any depth.
  test("1000 sequential front insertions each produce a strictly smaller key", () => {
    let min = generateKeyBetween(null, null);
    for (let i = 0; i < 1000; i++) {
      const next = generateKeyBetween(null, min);
      expect(next < min).toBe(true); // would fail with the old overshoot bug
      expect(isValidRank(next)).toBe(true);
      min = next;
    }
  });

  test("1000 sequential end insertions each produce a strictly larger key", () => {
    let max = generateKeyBetween(null, null);
    for (let i = 0; i < 1000; i++) {
      const next = generateKeyBetween(max, null);
      expect(next > max).toBe(true);
      max = next;
    }
  });

  test("repeatedly inserting between the same two keys stays ordered", () => {
    const lo = generateKeyBetween(null, null);
    let hi = generateKeyBetween(lo, null);
    for (let i = 0; i < 200; i++) {
      const mid = generateKeyBetween(lo, hi);
      expect(lo < mid && mid < hi).toBe(true);
      hi = mid;
    }
  });
});

describe("generateNKeysBetween", () => {
  test("produces n strictly increasing, valid keys", () => {
    const keys = generateNKeysBetween(null, null, 50);
    expect(keys).toHaveLength(50);
    for (let i = 1; i < keys.length; i++) expect(keys[i - 1] < keys[i]).toBe(true);
    keys.forEach((k) => expect(isValidRank(k)).toBe(true));
  });

  test("fits n keys between two existing keys", () => {
    const a = generateKeyBetween(null, null);
    const b = generateKeyBetween(a, null);
    const keys = generateNKeysBetween(a, b, 20);
    const all = [a, ...keys, b];
    for (let i = 1; i < all.length; i++) expect(all[i - 1] < all[i]).toBe(true);
  });
});

describe("isValidRank", () => {
  test("accepts generated keys, rejects legacy / junk", () => {
    expect(isValidRank(generateKeyBetween(null, null))).toBe(true);
    expect(isValidRank("a0")).toBe(true);
    expect(isValidRank("0000")).toBe(false); // legacy
    expect(isValidRank("m")).toBe(false); // legacy
    expect(isValidRank("")).toBe(false);
    expect(isValidRank(null)).toBe(false);
    expect(isValidRank("a0 ")).toBe(false); // space not in alphabet
  });
});

describe("generateKeyBetween (front/back/between ordering)", () => {
  test("ordering holds for front, back and between", () => {
    const a = generateKeyBetween(null, null);
    const b = generateKeyBetween(a, null);
    const before = generateKeyBetween(null, a);
    const mid = generateKeyBetween(a, b);
    expect(before < a && a < mid && mid < b).toBe(true);
  });
});
