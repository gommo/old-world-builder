/**
 * User-scoped localStorage abstraction (OWR sprout)
 *
 * Prefixes user-specific keys with `u.{storageKey}.` so that
 * different users on the same browser don't collide.
 * The storageKey comes from the backend sync API response.
 *
 * Scoped keys: owb.lists, owb.settings, dirtyIds
 * Non-scoped (browser-level): lang, owb.timezone, owb.datasets, etc.
 */

const ACTIVE_KEY = "owb.activeStorageKey";
const SCOPED_KEYS = ["owb.lists", "owb.settings", "dirtyIds"];
// Prefix-scoped keys are matched by startsWith. Used for keys with a
// dynamic suffix per list (e.g. `owb.game.<listId>`) where enumerating
// every value in SCOPED_KEYS would be impractical.
const SCOPED_PREFIXES = ["owb.game."];

const hasLocalStorage = () => typeof localStorage !== "undefined";

let activeKey = hasLocalStorage() ? localStorage.getItem(ACTIVE_KEY) || null : null;

const isScopedKey = (baseKey) =>
  SCOPED_KEYS.includes(baseKey) ||
  SCOPED_PREFIXES.some((p) => baseKey.startsWith(p));

const resolveKey = (baseKey) =>
  activeKey && isScopedKey(baseKey)
    ? `u.${activeKey}.${baseKey}`
    : baseKey;

export const getActiveStorageKey = () => activeKey;

/**
 * Set the active storage key (called when sync response arrives).
 * On first login, migrates unscoped data to the scoped key. Always purges
 * any other-user scoped data — switching back repulls from the server, so
 * holding onto stale users only burns localStorage quota.
 * Returns true if a different user was previously active (user switch).
 */
export const setActiveStorageKey = (key) => {
  if (!hasLocalStorage()) return false;
  if (!key || key === activeKey) return false;
  const prev = activeKey;
  activeKey = key;
  localStorage.setItem(ACTIVE_KEY, key);
  if (!prev) migrateUnscopedToScoped(key);
  purgeOtherScopes(key);
  return prev !== null;
};

/**
 * Remove every `u.<otherKey>.*` entry from localStorage, keeping only the
 * scoped data for `keepKey`. Server is the source of truth — a future switch
 * back to a removed user repulls their lists.
 */
const purgeOtherScopes = (keepKey) => {
  if (!hasLocalStorage()) return;
  const keepPrefix = `u.${keepKey}.`;
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("u.") && !k.startsWith(keepPrefix)) {
      toRemove.push(k);
    }
  }
  toRemove.forEach((k) => localStorage.removeItem(k));
};

/**
 * One-time migration: move unscoped owb.lists / owb.settings
 * into the user-scoped key, then remove the unscoped copy.
 */
const migrateUnscopedToScoped = (key) => {
  if (!hasLocalStorage()) return;
  for (const base of SCOPED_KEYS) {
    const scoped = `u.${key}.${base}`;
    const data = localStorage.getItem(base);
    if (data && !localStorage.getItem(scoped)) {
      localStorage.setItem(scoped, data);
      localStorage.removeItem(base);
    }
  }
};

export const getItem = (key) =>
  hasLocalStorage() ? localStorage.getItem(resolveKey(key)) : null;
export const setItem = (key, val) => {
  if (hasLocalStorage()) localStorage.setItem(resolveKey(key), val);
};
export const removeItem = (key) => {
  if (hasLocalStorage()) localStorage.removeItem(resolveKey(key));
};

// Module-load purge: a returning user with an existing activeKey would
// otherwise miss the purge that runs in setActiveStorageKey, so any stale
// `u.<otherKey>.*` data from prior sessions sticks around eating quota.
// Run it once on import to clean those up.
if (activeKey) {
  purgeOtherScopes(activeKey);
}
