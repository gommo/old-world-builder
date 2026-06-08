import { describe, test, expect, beforeEach, vi } from "vitest";

// In-memory localStorage mock with iteration support (length + key(i))
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

describe("setActiveStorageKey purges other scopes", () => {
  test("removes u.<otherKey>.* keys when activating a new key", async () => {
    localStorage.setItem("u.alice.owb.lists", "[1]");
    localStorage.setItem("u.alice.owb.settings", "{}");
    localStorage.setItem("u.bob.owb.lists", "[2]");
    localStorage.setItem("lang", "en"); // unscoped, should survive

    const { setActiveStorageKey } = await import("./storage");
    setActiveStorageKey("alice");

    expect(localStorage.getItem("u.alice.owb.lists")).toBe("[1]");
    expect(localStorage.getItem("u.alice.owb.settings")).toBe("{}");
    expect(localStorage.getItem("u.bob.owb.lists")).toBeNull();
    expect(localStorage.getItem("lang")).toBe("en");
  });

  test("idempotent — re-activating the same key purges nothing new", async () => {
    localStorage.setItem("u.alice.owb.lists", "[1]");
    localStorage.setItem("owb.activeStorageKey", "alice");

    const { setActiveStorageKey } = await import("./storage");
    const switched = setActiveStorageKey("alice");

    expect(switched).toBe(false);
    expect(localStorage.getItem("u.alice.owb.lists")).toBe("[1]");
  });

  test("module load purges stale scopes when activeKey is already set", async () => {
    localStorage.setItem("owb.activeStorageKey", "alice");
    localStorage.setItem("u.alice.owb.lists", "[1]");
    localStorage.setItem("u.bob.owb.lists", "[stale]");
    localStorage.setItem("u.carol.dirtyIds", '["x"]');

    await import("./storage"); // module-load side effect runs the purge

    expect(localStorage.getItem("u.alice.owb.lists")).toBe("[1]");
    expect(localStorage.getItem("u.bob.owb.lists")).toBeNull();
    expect(localStorage.getItem("u.carol.dirtyIds")).toBeNull();
  });

  test("first-time activation migrates unscoped data and purges stale users", async () => {
    localStorage.setItem("owb.lists", "[from-pre-login]");
    localStorage.setItem("u.bob.owb.lists", "[stale]");

    const { setActiveStorageKey } = await import("./storage");
    setActiveStorageKey("alice");

    expect(localStorage.getItem("u.alice.owb.lists")).toBe("[from-pre-login]");
    expect(localStorage.getItem("owb.lists")).toBeNull();
    expect(localStorage.getItem("u.bob.owb.lists")).toBeNull();
  });
});

describe("prefix-scoped keys (owb.game.*)", () => {
  test("setItem under active key scopes the prefix-matching key", async () => {
    localStorage.setItem("owb.activeStorageKey", "alice");

    const { setItem } = await import("./storage");
    setItem("owb.game.abc123", '{"banners":2}');

    expect(localStorage.getItem("u.alice.owb.game.abc123")).toBe('{"banners":2}');
    expect(localStorage.getItem("owb.game.abc123")).toBeNull();
  });

  test("getItem reads back the scoped value", async () => {
    localStorage.setItem("owb.activeStorageKey", "alice");
    localStorage.setItem("u.alice.owb.game.abc123", '{"banners":2}');

    const { getItem } = await import("./storage");
    expect(getItem("owb.game.abc123")).toBe('{"banners":2}');
  });

  test("unscoped fallback when no active key", async () => {
    const { setItem, getItem } = await import("./storage");
    setItem("owb.game.abc123", '{"banners":2}');

    expect(localStorage.getItem("owb.game.abc123")).toBe('{"banners":2}');
    expect(getItem("owb.game.abc123")).toBe('{"banners":2}');
  });

  test("user switch purges other-user game state", async () => {
    localStorage.setItem("u.alice.owb.game.abc", "[alice-game]");
    localStorage.setItem("u.bob.owb.game.xyz", "[bob-game]");

    const { setActiveStorageKey } = await import("./storage");
    setActiveStorageKey("alice");

    expect(localStorage.getItem("u.alice.owb.game.abc")).toBe("[alice-game]");
    expect(localStorage.getItem("u.bob.owb.game.xyz")).toBeNull();
  });
});
