import { describe, test, expect, beforeEach, vi } from "vitest";

// In-memory store backing the storage mock
const store = {};
vi.mock("./storage", () => ({
  getItem: (key) => store[key] ?? null,
  setItem: (key, val) => { store[key] = String(val); },
  removeItem: (key) => { delete store[key]; },
  setActiveStorageKey: vi.fn(),
}));

const markDirtyMock = vi.fn();
vi.mock("./owr-sync", () => ({
  pushToOWR: vi.fn(),
  markDirty: (...args) => markDirtyMock(...args),
}));

import {
  updateLocalList,
  removeFromLocalList,
  commitLists,
  addListOp,
  addAtTopOp,
  patchListOp,
  togglePinnedOp,
  deleteListOp,
  deleteFolderOp,
  makeTombstone,
} from "./owr-list";
import { pushToOWR } from "./owr-sync";

const clearStore = () => Object.keys(store).forEach((k) => delete store[k]);
const readStore = () => JSON.parse(store["owb.lists"] || "[]");

describe("updateLocalList", () => {
  beforeEach(() => {
    clearStore();
    vi.clearAllMocks();
  });

  test("merges partial updates with stored list before syncing", () => {
    const existingList = {
      id: "list-1",
      name: "Original",
      army: "the-empire",
      units: [{ id: "u-1" }],
      updated_at: "2026-01-01T00:00:00.000Z",
    };

    store["owb.lists"] = JSON.stringify([existingList]);

    updateLocalList({
      id: "list-1",
      name: "Renamed",
    });

    const stored = JSON.parse(store["owb.lists"]);
    expect(stored[0].name).toBe("Renamed");
    expect(stored[0].army).toBe("the-empire");
    expect(stored[0].units).toEqual([{ id: "u-1" }]);
    expect(stored[0].updated_at).not.toBe(existingList.updated_at);
    expect(pushToOWR).toHaveBeenCalledTimes(1);
    expect(markDirtyMock).toHaveBeenCalledWith("list-1");
  });

  test("treats folder `open` toggle as a meaningful change and syncs", () => {
    const existingList = {
      id: "f1",
      name: "Folder",
      type: "folder",
      open: true,
      updated_at: "2026-01-01T00:00:00.000Z",
    };

    store["owb.lists"] = JSON.stringify([existingList]);

    updateLocalList({
      id: "f1",
      name: "Folder",
      type: "folder",
      open: false,
    });

    const stored = JSON.parse(store["owb.lists"]);
    expect(stored[0].open).toBe(false);
    expect(stored[0].updated_at).not.toBe(existingList.updated_at);
    expect(pushToOWR).toHaveBeenCalledTimes(1);
  });

  test("does not sync when only sync-only fields change", () => {
    const existingList = {
      id: "list-1",
      name: "Original",
      army: "the-empire",
      updated_at: "2026-01-01T00:00:00.000Z",
      _broadcast_until: "2026-01-02T00:00:00.000Z",
    };

    store["owb.lists"] = JSON.stringify([existingList]);

    updateLocalList({
      id: "list-1",
      updated_at: "2026-01-03T00:00:00.000Z",
      _broadcast_until: "2026-01-04T00:00:00.000Z",
    });

    const stored = JSON.parse(store["owb.lists"]);
    expect(stored[0]).toEqual(existingList);
    expect(pushToOWR).not.toHaveBeenCalled();
  });
});

describe("removeFromLocalList", () => {
  beforeEach(() => {
    clearStore();
    vi.clearAllMocks();
  });

  test("replaces list with slim tombstone and syncs", () => {
    const lists = [
      { id: "list-1", name: "Keep" },
      {
        id: "list-2",
        name: "Delete Me",
        units: [{ id: "u1" }, { id: "u2" }],
        points: 1500,
        rank: "0|hzzzzz:",
      },
    ];
    store["owb.lists"] = JSON.stringify(lists);

    removeFromLocalList("list-2");

    const stored = JSON.parse(store["owb.lists"]);
    expect(stored).toHaveLength(2);
    expect(stored[0]._deleted).toBeUndefined();
    expect(stored[1]).toEqual({
      id: "list-2",
      _deleted: true,
      updated_at: expect.any(String),
    });
    expect(pushToOWR).toHaveBeenCalledTimes(1);
    expect(markDirtyMock).toHaveBeenCalledWith("list-2");
  });

  test("leaves other lists unchanged when deleting", () => {
    store["owb.lists"] = JSON.stringify([{ id: "list-1", name: "Only" }]);

    removeFromLocalList("nonexistent-id");

    const stored = JSON.parse(store["owb.lists"]);
    expect(stored).toHaveLength(1);
    expect(stored[0]._deleted).toBeUndefined();
  });

  test("handles empty localStorage", () => {
    removeFromLocalList("any-id");

    const stored = JSON.parse(store["owb.lists"]);
    expect(stored).toHaveLength(0);
  });
});

// ===========================================================================
// commitLists — THE single mutation primitive. These tests lock the
// invariants that every call site relies on, so no future caller can quietly
// reintroduce a "forgot a step" bug.
// ===========================================================================
describe("commitLists", () => {
  beforeEach(() => {
    clearStore();
    vi.clearAllMocks();
  });

  test("preserves soft-delete tombstones across an unrelated change", () => {
    // The Redux view never contains tombstones; a write that came from Redux
    // would drop this one and the deletion would resurrect on next pull.
    store["owb.lists"] = JSON.stringify([
      { id: "live", name: "Live", pinned_at: null },
      { id: "gone", _deleted: true, updated_at: "2026-01-01T00:00:00.000Z" },
    ]);

    commitLists(togglePinnedOp("live"));

    const stored = readStore();
    const tomb = stored.find((l) => l.id === "gone");
    expect(tomb).toEqual({
      id: "gone",
      _deleted: true,
      updated_at: "2026-01-01T00:00:00.000Z",
    });
  });

  test("marks the changed id dirty and pushes once", () => {
    store["owb.lists"] = JSON.stringify([
      { id: "a", name: "A", pinned_at: null },
      { id: "b", name: "B", pinned_at: null },
    ]);

    commitLists(togglePinnedOp("a"));

    expect(markDirtyMock).toHaveBeenCalledTimes(1);
    expect(markDirtyMock).toHaveBeenCalledWith("a");
    expect(pushToOWR).toHaveBeenCalledTimes(1);
  });

  test("marks a newly added id dirty", () => {
    store["owb.lists"] = JSON.stringify([{ id: "a", name: "A" }]);

    commitLists(addListOp({ id: "new", name: "New" }));

    expect(markDirtyMock).toHaveBeenCalledWith("new");
    expect(markDirtyMock).toHaveBeenCalledTimes(1);
  });

  test("marks an id that vanished without a tombstone dirty (defensive)", () => {
    store["owb.lists"] = JSON.stringify([
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ]);

    commitLists((lists) => lists.filter((l) => l.id !== "b"));

    expect(markDirtyMock).toHaveBeenCalledWith("b");
  });

  test("does NOT push or mark dirty when nothing meaningfully changed", () => {
    store["owb.lists"] = JSON.stringify([{ id: "a", name: "A" }]);

    commitLists((lists) => lists.map((l) => ({ ...l }))); // identical content

    expect(markDirtyMock).not.toHaveBeenCalled();
    expect(pushToOWR).not.toHaveBeenCalled();
  });

  test("ignores metadata-only (updated_at) changes — no dirty, no push", () => {
    store["owb.lists"] = JSON.stringify([
      { id: "a", name: "A", updated_at: "2026-01-01T00:00:00.000Z" },
    ]);

    commitLists((lists) =>
      lists.map((l) => ({ ...l, updated_at: "2026-09-09T00:00:00.000Z" })),
    );

    expect(markDirtyMock).not.toHaveBeenCalled();
    expect(pushToOWR).not.toHaveBeenCalled();
  });

  test("returns the full after-array including tombstones", () => {
    store["owb.lists"] = JSON.stringify([
      { id: "a", name: "A", pinned_at: null },
      { id: "gone", _deleted: true, updated_at: "x" },
    ]);

    const after = commitLists(togglePinnedOp("a"));

    expect(after).toHaveLength(2);
    expect(after.some((l) => l._deleted)).toBe(true);
  });

  test("persists the after-array to storage", () => {
    store["owb.lists"] = JSON.stringify([{ id: "a", name: "A" }]);

    commitLists(addListOp({ id: "b", name: "B" }));

    const ids = readStore().map((l) => l.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
  });
});

// ===========================================================================
// Pure operation builders — no storage, no sync, just (lists) => lists.
// ===========================================================================
describe("operation builders", () => {
  test("addListOp prepends and stamps updated_at", () => {
    const out = addListOp({ id: "new", name: "New" })([{ id: "a" }]);
    expect(out[0].id).toBe("new");
    expect(out[0].updated_at).toEqual(expect.any(String));
    expect(out[1].id).toBe("a");
  });

  test("addListOp keeps an explicit updated_at if provided", () => {
    const out = addListOp({ id: "n", updated_at: "fixed" })([]);
    expect(out[0].updated_at).toBe("fixed");
  });

  test("addAtTopOp prepends a top-level entity ranked above the live minimum", () => {
    const lists = [
      { id: "a", name: "A", rank: "a5", folder: null },
      { id: "b", name: "B", rank: "am", folder: null },
      { id: "gone", _deleted: true, rank: "a0", updated_at: "x" }, // tombstone — ignored
    ];
    const out = addAtTopOp({ id: "new", name: "New" })(lists);
    const created = out.find((l) => l.id === "new");
    expect(out[0].id).toBe("new"); // prepended
    expect(created.folder).toBe(null);
    expect(created.rank < "a5").toBe(true); // above the minimum LIVE rank
    expect(created.updated_at).toEqual(expect.any(String));
  });

  test("patchListOp merges fields into the target only", () => {
    const out = patchListOp("a", { rank: "z", folder: "f1" })([
      { id: "a", name: "A", rank: "m" },
      { id: "b", name: "B" },
    ]);
    expect(out[0]).toMatchObject({ id: "a", name: "A", rank: "z", folder: "f1" });
    expect(out[0].updated_at).toEqual(expect.any(String));
    expect(out[1]).toEqual({ id: "b", name: "B" });
  });

  test("togglePinnedOp pins an unpinned list", () => {
    const out = togglePinnedOp("a")([{ id: "a", pinned_at: null }]);
    expect(out[0].pinned_at).toEqual(expect.any(String));
  });

  test("togglePinnedOp unpins a pinned list", () => {
    const out = togglePinnedOp("a")([{ id: "a", pinned_at: "2026-01-01" }]);
    expect(out[0].pinned_at).toBeNull();
  });

  test("togglePinnedOp is a no-op for a missing id", () => {
    const input = [{ id: "a", pinned_at: null }];
    expect(togglePinnedOp("missing")(input)).toBe(input);
  });

  test("deleteListOp replaces the target with a tombstone", () => {
    const out = deleteListOp("a")([{ id: "a", name: "A" }, { id: "b" }]);
    expect(out[0]).toEqual({
      id: "a",
      _deleted: true,
      updated_at: expect.any(String),
    });
    expect(out[1]).toEqual({ id: "b" });
  });

  test("deleteFolderOp with deleteContents tombstones folder AND children", () => {
    const out = deleteFolderOp("f1", { deleteContents: true })([
      { id: "f1", type: "folder" },
      { id: "c1", folder: "f1", name: "Child" },
      { id: "other", folder: null, name: "Other" },
    ]);
    expect(out[0]._deleted).toBe(true);
    expect(out[1]._deleted).toBe(true);
    expect(out[2]).toEqual({ id: "other", folder: null, name: "Other" });
  });

  test("deleteFolderOp without deleteContents re-parents children to top level", () => {
    // The orphan bug: children must NOT keep pointing at the dead folder, or
    // they vanish from the UI (and eventually from storage).
    const out = deleteFolderOp("f1", { deleteContents: false })([
      { id: "f1", type: "folder" },
      { id: "c1", folder: "f1", name: "Child" },
    ]);
    expect(out[0]._deleted).toBe(true);
    expect(out[1]).toMatchObject({ id: "c1", folder: null, name: "Child" });
    expect(out[1]._deleted).toBeUndefined();
  });
});
