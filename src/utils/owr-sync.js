import { getItem, setItem } from "./storage";

let hasPendingChanges = false;
let syncStateListeners = [];

const getDirtyIds = () => {
  const raw = getItem("dirtyIds");
  if (raw !== null) {
    try {
      return new Set(JSON.parse(raw));
    } catch {
      return new Set();
    }
  }
  return new Set();
};

const setDirtyIds = (set) => {
  setItem("dirtyIds", JSON.stringify([...set]));
};

const notifySyncState = () => {
  const state = { hasPendingChanges };
  syncStateListeners.forEach((listener) => listener(state));
};

export const subscribeSyncState = (listener) => {
  syncStateListeners.push(listener);
  listener({ hasPendingChanges });
  return () => {
    syncStateListeners = syncStateListeners.filter((l) => l !== listener);
  };
};

export const markDirty = (id) => {
  if (!id) return;
  const set = getDirtyIds();
  if (!set.has(id)) {
    set.add(id);
    setDirtyIds(set);
  }
  if (!hasPendingChanges) {
    hasPendingChanges = true;
    notifySyncState();
  }
};

// Placeholder for the follow-up OWR sync branch. Ranking/list mutation code
// can safely record dirty ids now; the real sync engine will consume them.
export const pushToOWR = () => {
  if (!hasPendingChanges) {
    hasPendingChanges = true;
    notifySyncState();
  }
};

export const filterDeletedLists = (lists) => lists.filter((l) => !l._deleted);

export const __test__ = {
  getDirtyIds,
};
