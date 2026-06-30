import { describe, test, expect, beforeEach, vi } from "vitest";

const { owrFetchMock } = vi.hoisted(() => ({ owrFetchMock: vi.fn() }));
vi.mock("./owr-fetch", () => ({
  owrFetch: owrFetchMock,
  refreshAccessToken: vi.fn(),
}));

const storage = {};
const localStorageMock = {
  getItem: (key) => (key in storage ? storage[key] : null),
  setItem: (key, value) => {
    storage[key] = value;
  },
  removeItem: (key) => {
    delete storage[key];
  },
  clear: () => {
    Object.keys(storage).forEach((key) => delete storage[key]);
  },
};
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

beforeEach(() => {
  localStorageMock.clear();
});

const { __test__, markDirty, cleanupDeletedLists, owrSyncLists } = await import(
  "./owr-sync"
);
const { mergeLists, applyDelta, applySyncResponse, reparentOrphans, splitDirtyLists, getDirtyIds } = __test__;

describe("mergeLists", () => {
  test("adds server-only lists", () => {
    const server = [
      { id: "s1", name: "Server", updated_at: "2026-01-01T00:00:00Z" },
    ];
    const result = mergeLists([], server);
    expect(result.some((l) => l.id === "s1")).toBe(true);
  });

  test("keeps local-only lists", () => {
    const local = [
      { id: "l1", name: "Local", updated_at: "2026-01-01T00:00:00Z" },
    ];
    const result = mergeLists(local, []);
    expect(result.some((l) => l.id === "l1")).toBe(true);
  });

  test("keeps newer of local vs server when both exist", () => {
    const local = [
      { id: "1", name: "Local", updated_at: "2026-02-01T00:00:00Z" },
    ];
    const server = [
      { id: "1", name: "Server", updated_at: "2026-01-01T00:00:00Z" },
    ];
    const result = mergeLists(local, server);
    expect(result.find((l) => l.id === "1").name).toBe("Local");
  });

  test("undeletes local when server has a newer non-tombstone version", () => {
    const local = [
      { id: "1", _deleted: true, updated_at: "2026-01-01T00:00:00Z" },
    ];
    const server = [
      { id: "1", name: "Restored", updated_at: "2026-02-01T00:00:00Z" },
    ];
    const result = mergeLists(local, server);
    expect(result.find((l) => l.id === "1").name).toBe("Restored");
    expect(result.find((l) => l.id === "1")._deleted).toBeUndefined();
  });

  test("drops the entry when local delete wins", () => {
    const local = [
      { id: "1", _deleted: true, updated_at: "2026-02-01T00:00:00Z" },
    ];
    const server = [
      { id: "1", name: "Old", updated_at: "2026-01-01T00:00:00Z" },
    ];
    const result = mergeLists(local, server);
    expect(result.find((l) => l.id === "1")).toBeUndefined();
  });

  test("skips server-only tombstones (nothing to delete locally)", () => {
    const server = [
      { id: "s1", _deleted: true, updated_at: "2026-01-01T00:00:00Z" },
    ];
    const result = mergeLists([], server);
    expect(result.find((l) => l.id === "s1")).toBeUndefined();
  });

  test("drops the list when server tombstone supersedes local non-deleted", () => {
    const local = [
      { id: "1", name: "Local", updated_at: "2026-01-01T00:00:00Z" },
    ];
    const server = [
      { id: "1", _deleted: true, updated_at: "2026-02-01T00:00:00Z" },
    ];
    const result = mergeLists(local, server);
    expect(result.find((l) => l.id === "1")).toBeUndefined();
  });
});

describe("applyDelta", () => {
  test("removes deleted IDs", () => {
    const local = [{ id: "1" }, { id: "2" }];
    const result = applyDelta(local, [], ["2"]);
    expect(result.map((l) => l.id)).toEqual(["1"]);
  });

  test("replaces existing list with delta version", () => {
    const local = [{ id: "1", name: "Old" }];
    const delta = [{ id: "1", name: "New" }];
    const result = applyDelta(local, delta, []);
    expect(result.find((l) => l.id === "1").name).toBe("New");
  });

  test("keeps unchanged local lists", () => {
    const local = [{ id: "1", name: "Keep" }];
    const result = applyDelta(local, [], []);
    expect(result.find((l) => l.id === "1").name).toBe("Keep");
  });

  test("adds brand-new lists from delta", () => {
    const local = [{ id: "1" }];
    const delta = [{ id: "2", name: "New" }];
    const result = applyDelta(local, delta, []);
    expect(result.some((l) => l.id === "2")).toBe(true);
  });

  test("drops the list when delta sends a tombstone (does not store the marker)", () => {
    const local = [{ id: "1", name: "Local" }];
    const delta = [{ id: "1", _deleted: true }];
    const result = applyDelta(local, delta, []);
    expect(result.find((l) => l.id === "1")).toBeUndefined();
  });

  test("drops stale local tombstones not referenced by the delta", () => {
    const local = [{ id: "1", _deleted: true, updated_at: "2026-01-01T00:00:00Z" }];
    const result = applyDelta(local, [], []);
    expect(result.find((l) => l.id === "1")).toBeUndefined();
  });

  test("skips brand-new server tombstones (nothing to delete locally)", () => {
    const local = [];
    const delta = [{ id: "1", _deleted: true }];
    const result = applyDelta(local, delta, []);
    expect(result.find((l) => l.id === "1")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// reparentOrphans (orphan repair at the merge seam)
// ---------------------------------------------------------------------------
describe("orphan repair", () => {
  test("reparentOrphans clears a pointer to a missing folder and marks dirty", () => {
    const result = reparentOrphans([
      { id: "child", folder: "gone", updated_at: "2026-01-01T00:00:00Z" },
    ]);
    expect(result.find((l) => l.id === "child").folder).toBe(null);
    expect(getDirtyIds().has("child")).toBe(true);
  });

  test("reparentOrphans bumps updated_at so the fix wins LWW", () => {
    const before = "2026-01-01T00:00:00Z";
    const result = reparentOrphans([{ id: "child", folder: "gone", updated_at: before }]);
    const repaired = result.find((l) => l.id === "child");
    expect(new Date(repaired.updated_at).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  test("reparentOrphans treats a tombstoned folder as missing", () => {
    const result = reparentOrphans([
      { id: "f1", type: "folder", _deleted: true, updated_at: "2026-01-01T00:00:00Z" },
      { id: "child", folder: "f1", updated_at: "2026-01-01T00:00:00Z" },
    ]);
    expect(result.find((l) => l.id === "child").folder).toBe(null);
  });

  test("reparentOrphans leaves a child of a live folder untouched and clean", () => {
    const result = reparentOrphans([
      { id: "f1", type: "folder", updated_at: "2026-01-01T00:00:00Z" },
      { id: "child", folder: "f1", updated_at: "2026-01-01T00:00:00Z" },
    ]);
    expect(result.find((l) => l.id === "child").folder).toBe("f1");
    expect(getDirtyIds().has("child")).toBe(false);
  });

  test("reparentOrphans is idempotent for already top-level lists", () => {
    const result = reparentOrphans([{ id: "child", folder: null, updated_at: "x" }]);
    expect(result.find((l) => l.id === "child").folder).toBe(null);
    expect(getDirtyIds().has("child")).toBe(false);
  });

  test("mergeLists repairs an orphan surfaced by the merge", () => {
    // Server has the child pointing at a folder that exists nowhere.
    const server = [{ id: "child", folder: "gone", updated_at: "2026-02-01T00:00:00Z" }];
    const merged = mergeLists([], server);
    expect(merged.find((l) => l.id === "child").folder).toBe(null);
    expect(getDirtyIds().has("child")).toBe(true);
  });

  test("applyDelta repairs an orphan surfaced by the delta", () => {
    const local = [{ id: "child", folder: "f1", updated_at: "2026-01-01T00:00:00Z" }];
    // Delta drops the folder (tombstone) but never clears the child's pointer.
    const delta = [{ id: "f1", type: "folder", _deleted: true, updated_at: "2026-02-01T00:00:00Z" }];
    const merged = applyDelta(local, delta, []);
    expect(merged.find((l) => l.id === "child").folder).toBe(null);
    expect(getDirtyIds().has("child")).toBe(true);
  });
});

describe("applySyncResponse", () => {
  test("post-filters tombstones we just sent (drop on ack)", () => {
    const local = [
      { id: "1", _deleted: true, updated_at: "2026-02-01T00:00:00Z" },
      { id: "2", name: "Keep", updated_at: "2026-01-01T00:00:00Z" },
    ];
    const data = {
      lists: [{ id: "1", _deleted: true, updated_at: "2026-02-01T00:00:00Z" }],
      deleted_ids: [],
    };
    const dirtySent = [
      { id: "1", _deleted: true, updated_at: "2026-02-01T00:00:00Z" },
    ];
    const result = applySyncResponse(local, data, dirtySent);
    expect(result.find((l) => l.id === "1")).toBeUndefined();
    expect(result.find((l) => l.id === "2")).toBeDefined();
  });

  test("keeps a resurrected list when server returns a newer non-tombstone version", () => {
    const local = [
      { id: "1", _deleted: true, updated_at: "2026-01-01T00:00:00Z" },
    ];
    const data = {
      lists: [{ id: "1", name: "Restored", updated_at: "2026-02-01T00:00:00Z" }],
    };
    const dirtySent = [
      { id: "1", _deleted: true, updated_at: "2026-01-01T00:00:00Z" },
    ];
    const result = applySyncResponse(local, data, dirtySent);
    expect(result.find((l) => l.id === "1").name).toBe("Restored");
  });

  test("works without a dirtySent argument", () => {
    const local = [{ id: "1", name: "Local", updated_at: "2026-01-01T00:00:00Z" }];
    const data = { lists: [] };
    const result = applySyncResponse(local, data);
    expect(result).toEqual(local);
  });
});

describe("`open` syncs like any other attribute", () => {
  test("mergeLists takes the server's `open` value when server wins", () => {
    const local = [
      { id: "f1", type: "folder", open: false, updated_at: "2026-01-01T00:00:00Z" },
    ];
    const server = [
      { id: "f1", type: "folder", open: true, updated_at: "2026-02-01T00:00:00Z" },
    ];
    const merged = mergeLists(local, server).find((l) => l.id === "f1");
    expect(merged.open).toBe(true);
  });

  test("applyDelta takes the delta's `open` value", () => {
    const local = [
      { id: "f1", type: "folder", open: false, updated_at: "2026-01-01T00:00:00Z" },
    ];
    const delta = [
      { id: "f1", type: "folder", open: true, updated_at: "2026-02-01T00:00:00Z" },
    ];
    const merged = applyDelta(local, delta, []).find((l) => l.id === "f1");
    expect(merged.open).toBe(true);
  });
});

describe("dirty id tracking", () => {
  test("seeds dirty ids from existing lists on first call when no key is set", () => {
    localStorage.setItem(
      "owb.lists",
      JSON.stringify([{ id: "a" }, { id: "b" }]),
    );
    expect(getDirtyIds()).toEqual(new Set(["a", "b"]));
    expect(JSON.parse(localStorage.getItem("dirtyIds"))).toEqual(["a", "b"]);
  });

  test("markDirty adds an id to the persisted set", () => {
    localStorage.setItem("dirtyIds", JSON.stringify([]));
    markDirty("a");
    expect(JSON.parse(localStorage.getItem("dirtyIds"))).toEqual(["a"]);
  });

  test("markDirty is idempotent", () => {
    localStorage.setItem("dirtyIds", JSON.stringify(["a"]));
    markDirty("a");
    expect(JSON.parse(localStorage.getItem("dirtyIds"))).toEqual(["a"]);
  });

  test("splitDirtyLists keeps only ids in the dirty set", () => {
    localStorage.setItem("dirtyIds", JSON.stringify(["b"]));
    const lists = [
      { id: "a", updated_at: "2026-01-01T00:00:00Z" },
      { id: "b", updated_at: "2026-01-01T00:00:00Z" },
    ];
    const { dirty } = splitDirtyLists(lists);
    expect(dirty.map((l) => l.id)).toEqual(["b"]);
  });

  test("applySyncResponse clears dirty ids whose content hasn't moved on", () => {
    localStorage.setItem("dirtyIds", JSON.stringify(["1", "2"]));
    localStorage.setItem(
      "owb.lists",
      JSON.stringify([
        { id: "1", updated_at: "2026-01-01T00:00:00Z" },
        { id: "2", updated_at: "2026-01-01T00:00:00Z" },
      ]),
    );
    const dirtySent = [
      { id: "1", updated_at: "2026-01-01T00:00:00Z" },
      { id: "2", updated_at: "2026-01-01T00:00:00Z" },
    ];
    applySyncResponse([], { lists: [] }, dirtySent);
    expect(JSON.parse(localStorage.getItem("dirtyIds"))).toEqual([]);
  });

  test("applySyncResponse does not clear an id whose content was edited mid-round-trip", () => {
    // Sent updated_at = T1, but during the trip the user re-edited the list
    // and bumped its updated_at to T2. The id stays dirty for the next sync.
    localStorage.setItem("dirtyIds", JSON.stringify(["1"]));
    localStorage.setItem(
      "owb.lists",
      JSON.stringify([{ id: "1", updated_at: "2026-02-01T00:00:00Z" }]),
    );
    const dirtySent = [{ id: "1", updated_at: "2026-01-01T00:00:00Z" }];
    applySyncResponse([], { lists: [] }, dirtySent);
    expect(JSON.parse(localStorage.getItem("dirtyIds"))).toEqual(["1"]);
  });

  test("applySyncResponse re-marks server-reported unknown_ids dirty for re-push", () => {
    localStorage.setItem("dirtyIds", JSON.stringify([]));
    localStorage.setItem(
      "owb.lists",
      JSON.stringify([{ id: "orphan", updated_at: "2026-01-01T00:00:00Z" }]),
    );
    applySyncResponse([], { lists: [], unknown_ids: ["orphan"] }, []);
    expect(JSON.parse(localStorage.getItem("dirtyIds"))).toEqual(["orphan"]);
  });

  test("applySyncResponse does not clear ids edited during the round-trip", () => {
    // Sent {1, 2}, but user edited 3 while waiting for the response.
    localStorage.setItem("dirtyIds", JSON.stringify(["1", "2", "3"]));
    localStorage.setItem(
      "owb.lists",
      JSON.stringify([
        { id: "1", updated_at: "2026-01-01T00:00:00Z" },
        { id: "2", updated_at: "2026-01-01T00:00:00Z" },
      ]),
    );
    const dirtySent = [
      { id: "1", updated_at: "2026-01-01T00:00:00Z" },
      { id: "2", updated_at: "2026-01-01T00:00:00Z" },
    ];
    applySyncResponse([], { lists: [] }, dirtySent);
    expect(JSON.parse(localStorage.getItem("dirtyIds"))).toEqual(["3"]);
  });

  test("getDirtyIds re-seeds from owb.lists when dirtyIds is corrupted", () => {
    localStorage.setItem(
      "owb.lists",
      JSON.stringify([{ id: "a" }, { id: "b" }]),
    );
    localStorage.setItem("dirtyIds", "{not json}");
    expect(getDirtyIds()).toEqual(new Set(["a", "b"]));
    expect(JSON.parse(localStorage.getItem("dirtyIds"))).toEqual(["a", "b"]);
  });

  test("getDirtyIds re-seeds when dirtyIds isn't an array", () => {
    localStorage.setItem("owb.lists", JSON.stringify([{ id: "a" }]));
    localStorage.setItem("dirtyIds", JSON.stringify({ a: true }));
    expect(getDirtyIds()).toEqual(new Set(["a"]));
  });
});

// ---------------------------------------------------------------------------
// cleanupDeletedLists (offline-delete resurrection guard)
// ---------------------------------------------------------------------------
describe("cleanupDeletedLists", () => {
  const ancient = "2020-01-01T00:00:00.000Z"; // well past the 7-day window
  const idsIn = () =>
    JSON.parse(localStorage.getItem("owb.lists"))
      .map((l) => l.id)
      .sort();

  test("purges an ACKED tombstone older than the retention window", () => {
    localStorage.setItem("dirtyIds", JSON.stringify([])); // nothing pending = server confirmed
    localStorage.setItem(
      "owb.lists",
      JSON.stringify([
        { id: "live", updated_at: ancient },
        { id: "gone", _deleted: true, updated_at: ancient },
      ]),
    );
    cleanupDeletedLists();
    expect(idsIn()).toEqual(["live"]);
  });

  test("keeps an UNACKED tombstone past the window — the resurrection-bug guard", () => {
    // Delete made offline: id still dirty, tombstone aged out the window. It
    // must survive so the delete still reaches the server; otherwise the next
    // pull resurrects the list.
    localStorage.setItem("dirtyIds", JSON.stringify(["gone"]));
    localStorage.setItem(
      "owb.lists",
      JSON.stringify([
        { id: "live", updated_at: ancient },
        { id: "gone", _deleted: true, updated_at: ancient },
      ]),
    );
    cleanupDeletedLists();
    expect(idsIn()).toEqual(["gone", "live"]);
  });

  test("keeps a fresh (within-window) acked tombstone", () => {
    localStorage.setItem("dirtyIds", JSON.stringify([]));
    localStorage.setItem(
      "owb.lists",
      JSON.stringify([
        { id: "gone", _deleted: true, updated_at: new Date().toISOString() },
      ]),
    );
    cleanupDeletedLists();
    expect(idsIn()).toEqual(["gone"]);
  });

  test("never purges non-deleted lists, dirty or not", () => {
    localStorage.setItem("dirtyIds", JSON.stringify([]));
    localStorage.setItem(
      "owb.lists",
      JSON.stringify([
        { id: "a", updated_at: ancient },
        { id: "b", updated_at: ancient },
      ]),
    );
    cleanupDeletedLists();
    expect(idsIn()).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// owrSyncLists — only a confirmed auth failure should drop tokens / log out
// ---------------------------------------------------------------------------
describe("owrSyncLists failure handling", () => {
  beforeEach(() => {
    owrFetchMock.mockReset();
    localStorage.setItem("owb.owrAccessToken", "tok");
    localStorage.setItem("owb.owrRefreshToken", "ref");
  });

  const hasTokens = () =>
    localStorage.getItem("owb.owrAccessToken") === "tok" &&
    localStorage.getItem("owb.owrRefreshToken") === "ref";
  const dispatchedWith = (dispatch, pred) =>
    dispatch.mock.calls.some(([action]) => pred(action?.payload || {}));

  test("auth failure (owrFetch null) logs out and drops tokens", async () => {
    owrFetchMock.mockResolvedValue(null); // 401 + refresh exhausted
    const dispatch = vi.fn();
    await owrSyncLists({ dispatch });
    expect(hasTokens()).toBe(false);
    expect(dispatchedWith(dispatch, (p) => p.loggedIn === false)).toBe(true);
  });

  test("server 5xx keeps the session and surfaces syncError", async () => {
    owrFetchMock.mockResolvedValue({ ok: false, status: 500 });
    const dispatch = vi.fn();
    await owrSyncLists({ dispatch });
    expect(hasTokens()).toBe(true);
    expect(dispatchedWith(dispatch, (p) => p.syncError === true)).toBe(true);
    expect(dispatchedWith(dispatch, (p) => p.loggedIn === false)).toBe(false);
  });

  test("network failure (owrFetch throws) keeps tokens", async () => {
    owrFetchMock.mockRejectedValue(new Error("network down"));
    const dispatch = vi.fn();
    await owrSyncLists({ dispatch });
    expect(hasTokens()).toBe(true);
    expect(dispatchedWith(dispatch, (p) => p.loggedIn === false)).toBe(false);
  });
});
