import { describe, test, expect, beforeEach, vi } from "vitest";

class MemoryStorage {
  constructor() {
    this.store = {};
  }
  get length() {
    return Object.keys(this.store).length;
  }
  key(i) {
    return Object.keys(this.store)[i] ?? null;
  }
  getItem(k) {
    return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null;
  }
  setItem(k, v) {
    this.store[k] = String(v);
  }
  removeItem(k) {
    delete this.store[k];
  }
  clear() {
    this.store = {};
  }
}

vi.stubGlobal("localStorage", new MemoryStorage());

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
});

describe("storage seam", () => {
  test("setItem/getItem round-trips against the bare key", async () => {
    const { getItem, setItem } = await import("./storage");
    setItem("owb.lists", "[1]");

    expect(localStorage.getItem("owb.lists")).toBe("[1]");
    expect(getItem("owb.lists")).toBe("[1]");
  });

  test("getItem returns null for a missing key", async () => {
    const { getItem } = await import("./storage");
    expect(getItem("owb.lists")).toBeNull();
  });

  test("removeItem deletes the key", async () => {
    const { getItem, setItem, removeItem } = await import("./storage");
    setItem("dirtyIds", '["x"]');
    removeItem("dirtyIds");

    expect(getItem("dirtyIds")).toBeNull();
    expect(localStorage.getItem("dirtyIds")).toBeNull();
  });
});
