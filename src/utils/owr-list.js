import { pushToOWR, markDirty } from "./owr-sync";
import { rankAtTop } from "./list-ordering";
import { getItem, setItem } from "./storage";

const stamp = () => new Date().toISOString();

const stripMetadataFields = (list) => {
  if (!list) return list;
  const { updated_at, _broadcast_until, ...rest } = list;
  return rest;
};

export const hasMeaningfulListChange = (currentList, nextList) => {
  const currentSerialized = JSON.stringify(stripMetadataFields(currentList));
  const nextSerialized = JSON.stringify(stripMetadataFields(nextList));
  return currentSerialized !== nextSerialized;
};

export const makeTombstone = (listId) => ({
  id: listId,
  _deleted: true,
  updated_at: stamp(),
});

/**
 * THE single list-collection mutation primitive. Every code path that changes
 * the set of lists/folders MUST go through this so the invariants live in one
 * place and can't be forgotten:
 *
 *   1. Read the authoritative array fresh from storage. This INCLUDES soft-
 *      delete tombstones, which never exist in Redux — serializing the Redux
 *      view back to storage silently drops pending deletions (they then
 *      resurrect on the next pull). Reading fresh is the only safe source.
 *   2. Apply a pure transform: (before[]) => after[]. Transforms must be
 *      side-effect free; see the *Op builders below.
 *   3. Auto-mark every id whose content meaningfully changed / appeared /
 *      vanished as dirty, so the next sync actually pushes it. This kills the
 *      entire class of "forgot markDirty" bugs.
 *   4. Persist, then trigger a debounced push.
 *
 * Returns the full after-array (tombstones included). UI code should not call
 * this directly — use the useListCommit() hook, which also dispatches the
 * filtered (non-deleted) view to Redux.
 */
export const commitLists = (transform) => {
  const before = JSON.parse(getItem("owb.lists")) || [];
  const after = transform(before) || before;

  const beforeById = new Map(before.map((l) => [l.id, l]));
  const afterIds = new Set();
  const dirty = [];
  for (const next of after) {
    if (!next?.id) continue;
    afterIds.add(next.id);
    const prev = beforeById.get(next.id);
    if (!prev || hasMeaningfulListChange(prev, next)) dirty.push(next.id);
  }
  // Ids that vanished entirely without leaving a tombstone — defensive; real
  // deletions go through deleteListOp/deleteFolderOp which leave tombstones.
  for (const id of beforeById.keys()) {
    if (!afterIds.has(id)) dirty.push(id);
  }

  setItem("owb.lists", JSON.stringify(after));
  if (dirty.length > 0) {
    dirty.forEach((id) => markDirty(id));
    pushToOWR(after);
  }
  return after;
};

// ---------------------------------------------------------------------------
// Pure operation builders. Each returns a (lists[]) => lists[] transform for
// commitLists. They never touch storage, Redux, or the dirty set — that's the
// primitive's job — so they're trivially unit-testable in isolation.
// ---------------------------------------------------------------------------

/** Prepend a brand-new list/folder. (Display order is rank-based, so array
 *  position is irrelevant; prepend just keeps newest-first in the raw array.) */
export const addListOp = (newList) => (lists) => [
  { ...newList, updated_at: newList.updated_at || stamp() },
  ...lists,
];

/**
 * Add a brand-new top-level entity (new list / folder / import) at the very top
 * — just below any pinned lists. Computes the top rank against the live set
 * (tombstones filtered, so a deleted list's rank can't bound the new one) and
 * forces folder:null. Shared by all "create at top" call sites.
 */
export const addAtTopOp = (entity) => (lists) =>
  addListOp({
    ...entity,
    folder: null,
    rank: rankAtTop(lists.filter((l) => !l._deleted)),
  })(lists);

/** Shallow-merge `fields` into the list with `id` (rank/folder/name/etc.). */
export const patchListOp = (id, fields) => (lists) =>
  lists.map((l) => (l.id === id ? { ...l, ...fields, updated_at: stamp() } : l));

/** Flip a list's pinned state. No-op if the id isn't present. */
export const togglePinnedOp = (id) => (lists) => {
  const target = lists.find((l) => l.id === id);
  if (!target) return lists;
  const pinned_at = target.pinned_at ? null : stamp();
  return lists.map((l) =>
    l.id === id ? { ...l, pinned_at, updated_at: stamp() } : l,
  );
};

/** Replace a single list with a tombstone. */
export const deleteListOp = (id) => (lists) =>
  lists.map((l) => (l.id === id ? makeTombstone(id) : l));

/**
 * Delete a folder. With `deleteContents`, every child is tombstoned too.
 * Otherwise children are re-parented to top level (folder: null) so they stay
 * visible — leaving them pointing at the dead folder would orphan them out of
 * the UI and eventually out of storage (sortByRank drops dangling children).
 */
export const deleteFolderOp = (folderId, { deleteContents } = {}) => (lists) =>
  lists.map((l) => {
    if (l.id === folderId) return makeTombstone(folderId);
    if (l.folder === folderId && l.type !== "folder") {
      return deleteContents
        ? makeTombstone(l.id)
        : { ...l, folder: null, updated_at: stamp() };
    }
    return l;
  });

// ---------------------------------------------------------------------------
// Higher-level helpers used outside the home screen, kept as thin wrappers
// over commitLists so they share the exact same persistence/sync guarantees.
// ---------------------------------------------------------------------------

export const updateLocalList = (updatedList) => {
  if (!updatedList?.id) return;
  try {
    commitLists((lists) => {
      const current = lists.find((l) => l.id === updatedList.id);
      if (!current) return lists;
      const merged = { ...current, ...updatedList };
      // Skip churn when only sync-only metadata changed.
      if (!hasMeaningfulListChange(current, merged)) return lists;
      return lists.map((l) =>
        l.id === merged.id ? { ...merged, updated_at: stamp() } : l,
      );
    });
  } catch (error) {}
};

export const removeFromLocalList = (listId) => commitLists(deleteListOp(listId));
