import {
  generateKeyBetween,
  generateNKeysBetween,
  isValidRank,
} from "./order-keys";

const byRank = (a, b) => {
  if (!a.rank && !b.rank) return 0;
  if (!a.rank) return 1;
  if (!b.rank) return -1;
  if (a.rank < b.rank) return -1;
  if (a.rank > b.rank) return 1;
  return 0;
};

// A list/folder lives at the top level when it's a folder or has no folder.
const isTopLevel = (l) => l.type === "folder" || l.folder == null;
// Ordering context: the top-level run, or a specific folder's contents.
const rankContext = (l) => (isTopLevel(l) ? "__top__" : l.folder);
// A brand-new item arrives without a rank (folders excepted — they're created
// with one). Such an arrival floats to the top of its context.
//
// NOTE: this fork does not implement pinning. Lists may carry a `pinned_at`
// field (set by the Battle Builder app and preserved through sync), but it is
// never read here — ordering is purely rank-based.
const isArrival = (l) => l.rank == null && l.type !== "folder";

export const sortByRank = (lists) => {
  const topLevel = lists.filter(isTopLevel);

  const sortedTopLevel = [...topLevel].sort(byRank);

  const result = [];
  const placed = new Set();
  for (const item of sortedTopLevel) {
    result.push(item);
    placed.add(item);

    if (item.type === "folder") {
      const contents = lists
        .filter((l) => l.folder === item.id)
        .sort(byRank);
      contents.forEach((c) => placed.add(c));
      result.push(...contents);
    }
  }

  // Safety net: an item whose `folder` points at a folder that no longer
  // exists is neither top-level nor a child of any present folder, so the
  // loop above would silently drop it (and the next merge would persist its
  // absence — permanent data loss). Surface orphans at top level instead.
  const orphans = lists.filter((l) => !placed.has(l)).sort(byRank);
  result.push(...orphans);

  return result;
};

// A key strictly above the current minimum. Only valid order keys constrain the
// position — legacy/not-yet-migrated ranks are ignored so this can never be
// handed an invalid bound (which would throw).
export const rankAtTop = (lists) => {
  const valid = lists.map((l) => l?.rank).filter(isValidRank);
  const min = valid.length ? valid.reduce((m, r) => (r < m ? r : m)) : null;
  return generateKeyBetween(null, min);
};

// A rank that orders `source`'s duplicate right after it within its folder.
// Siblings outside the folder don't constrain the *position*, but ranks are
// globally unique (ensureRanks treats them so) — so we de-conflict the chosen
// key against ALL live ranks, not just folder siblings, to avoid minting a
// duplicate of some other context's key (which would force a full rekey).
export const rankAfter = (lists, source) => {
  const siblingFolder = source?.folder || null;
  const siblings = lists
    .filter((l) => (l.folder || null) === siblingFolder && isValidRank(l.rank))
    .slice()
    .sort(byRank);
  const used = new Set(lists.filter((l) => isValidRank(l.rank)).map((l) => l.rank));
  const srcRank = isValidRank(source?.rank) ? source.rank : null;
  if (srcRank) {
    const idx = siblings.findIndex((l) => l.id === source.id);
    const next = idx >= 0 ? siblings[idx + 1] : null;
    return uniqueRankBetween(srcRank, next?.rank ?? null, used);
  }
  // No usable source rank → place at the top of the context.
  return uniqueRankBetween(null, siblings[0]?.rank ?? null, used);
};

// Rewrite a list with a freshly assigned order key: default a missing folder
// field to top-level. Shared by both the migration and steady-state arrival
// paths so the rules live in one place.
const withRank = (l, rank) => {
  const next = { ...l, rank, updated_at: new Date().toISOString() };
  if (l.folder === undefined && l.type !== "folder") next.folder = null;
  return next;
};

// One-time migration: re-key EVERY non-deleted item with a fresh valid order
// key. Keys are assigned as a single increasing sequence in display order
// (top-level run, each folder's children right after their folder), so they're
// GLOBALLY unique and each context stays correctly ordered. Genuine arrivals
// (no rank) float to the top of their context. Heals legacy (free-form) and
// decayed (`0000`-floor) ranks in one pass. Duplicates among otherwise-valid
// ranks are handled by dedupeRanks, not here.
const rekeyAll = (lists) => {
  const live = lists.filter((l) => !l._deleted);
  // Within a context: arrivals first (top), then existing items by rank.
  const orderCtx = (items) => [
    ...items.filter(isArrival),
    ...items.filter((l) => !isArrival(l)).sort(byRank),
  ];

  const topLevel = orderCtx(live.filter((l) => rankContext(l) === "__top__"));
  const flat = [];
  for (const item of topLevel) {
    flat.push(item);
    if (item.type === "folder") {
      flat.push(...orderCtx(live.filter((l) => l.folder === item.id)));
    }
  }
  // Orphans (folder points at a missing folder) — append so nothing is lost.
  const seen = new Set(flat.map((l) => l.id));
  for (const l of live) if (!seen.has(l.id)) flat.push(l);

  const keys = generateNKeysBetween(null, null, flat.length);
  const newRankById = new Map(flat.map((l, i) => [l.id, keys[i]]));

  let needsUpdate = false;
  const result = lists.map((l) => {
    const nr = l._deleted ? undefined : newRankById.get(l.id);
    if (nr === undefined) return l;
    needsUpdate = true;
    return withRank(l, nr);
  });
  return { lists: result, needsUpdate };
};

// Steady state (all present ranks already valid + unique): assign a key to any
// rankless item, floating it to the TOP of its own context in array order.
const floatArrivals = (lists) => {
  // smallest valid rank per context = the ceiling new arrivals must beat, plus
  // the global set of in-use ranks so a folder arrival can't mint a key that
  // collides with another context's rank (ranks are globally unique).
  const ctxCeil = new Map();
  const used = new Set();
  for (const l of lists) {
    if (l._deleted || !isValidRank(l.rank)) continue;
    used.add(l.rank);
    const c = rankContext(l);
    const cur = ctxCeil.get(c);
    if (cur === undefined || l.rank < cur) ctxCeil.set(c, l.rank);
  }
  const ctxLo = new Map(); // last key assigned per context (for stacking)
  let needsUpdate = false;
  const result = lists.map((l) => {
    if (l._deleted || l.rank != null) return l; // only rankless items
    const c = rankContext(l);
    const newRank = uniqueRankBetween(ctxLo.get(c) ?? null, ctxCeil.get(c) ?? null, used);
    ctxLo.set(c, newRank); // next arrival in this context ranks just below ceil
    used.add(newRank);
    needsUpdate = true;
    return withRank(l, newRank);
  });
  return { lists: result, needsUpdate };
};

// A duplicate rank means two devices independently minted the same key (e.g.
// both dragged an item to the same spot before syncing). Repair it with the
// lightest possible touch so the two devices CONVERGE instead of fighting: the
// lowest-id holder keeps the rank, every other holder is re-keyed just above
// it. Only the re-keyed losers get a fresh updated_at (and so become dirty), so
// a single collision no longer re-stamps and re-pushes the entire list — which
// is what made reorders bounce back across devices (each load re-keyed
// everything, bumped every updated_at, and steamrolled the other device's
// order via last-write-wins). The lowest-id tie-break and id-ordered processing
// are deterministic, so both devices resolve the collision to the SAME keys and
// stop changing — no more ping-pong.
const dedupeRanks = (lists) => {
  const live = lists.filter((l) => !l._deleted);

  // Deterministic owner per rank = lowest id. Everyone else must be re-keyed.
  const ownerByRank = new Map();
  for (const l of live) {
    if (!isValidRank(l.rank)) continue;
    const cur = ownerByRank.get(l.rank);
    if (cur === undefined || l.id < cur) ownerByRank.set(l.rank, l.id);
  }
  const isKeeper = (l) =>
    isValidRank(l.rank) && ownerByRank.get(l.rank) === l.id;
  const used = new Set(ownerByRank.keys());

  // Smallest keeper rank strictly above `rank` within `context` — the upper
  // bound for slotting a loser right after the rank it collided on.
  const nextKeptAbove = (context, rank) => {
    let best = null;
    for (const l of live) {
      if (!isKeeper(l) || rankContext(l) !== context) continue;
      if (l.rank > rank && (best === null || l.rank < best)) best = l.rank;
    }
    return best;
  };

  // Re-key losers in id order so multiple collisions on the same rank stack
  // identically on every device.
  const losers = live
    .filter((l) => isValidRank(l.rank) && !isKeeper(l))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const ctxLo = new Map(); // per (context, collided-rank): last key handed out
  const newRankById = new Map();
  for (const l of losers) {
    const c = rankContext(l);
    const key = `${c} ${l.rank}`;
    const lower = ctxLo.get(key) ?? l.rank;
    const upper = nextKeptAbove(c, l.rank);
    const nr = uniqueRankBetween(lower, upper, used);
    used.add(nr);
    ctxLo.set(key, nr);
    newRankById.set(l.id, nr);
  }

  const result = lists.map((l) => {
    const nr = l._deleted ? undefined : newRankById.get(l.id);
    return nr === undefined ? l : withRank(l, nr);
  });
  return { lists: result, needsUpdate: newRankById.size > 0 };
};

// Ensure every list/folder has a valid, unique order key. Each step touches
// ONLY the items it must, so a single defect can't re-key the whole set:
//  - Invalid rank (legacy free-form, decayed, corrupt) ⇒ one-time, order-
//    preserving full re-key migration.
//  - Duplicate rank ⇒ targeted, deterministic dedupe (devices converge).
//  - Rankless arrival ⇒ float to the top of its context.
//  - Otherwise, no change.
export const ensureRanks = (lists) => {
  const validRanks = lists
    .filter((l) => !l._deleted && isValidRank(l.rank))
    .map((l) => l.rank);
  const hasInvalid = lists.some(
    (l) => !l._deleted && l.rank != null && !isValidRank(l.rank),
  );
  if (hasInvalid) return rekeyAll(lists);

  let result = lists;
  let needsUpdate = false;

  if (new Set(validRanks).size !== validRanks.length) {
    const deduped = dedupeRanks(result);
    result = deduped.lists;
    needsUpdate = needsUpdate || deduped.needsUpdate;
  }

  if (result.some((l) => !l._deleted && l.rank == null)) {
    const floated = floatArrivals(result);
    result = floated.lists;
    needsUpdate = needsUpdate || floated.needsUpdate;
  }

  return { lists: result, needsUpdate };
};

// Decide which folder a drop position falls into. Shared by reorderList
// (commits the rank) and handleDragUpdate (shows the visual indent cue) so
// they agree.
//
// To make "drop into the last position of an open folder" reachable, Home.jsx
// inserts a phantom drop-zone item after each open folder's last child (or
// right after the header for empty open folders). Phantoms have folder=X so
// they match the same-folder branches below; dropping past the phantom lands
// on top-level naturally.
export const dropFolderFor = (withoutItem, insertAt) => {
  const prev = withoutItem[insertAt - 1] || null;
  const next = withoutItem[insertAt] || null;

  // A CLOSED folder must never receive a drop. Its children are hidden
  // (height:0) but still occupy rbd flat indices, so a drop can land between
  // them — guard every "into folder" branch against a collapsed target.
  const isClosed = (folderId) =>
    withoutItem.some(
      (l) => l.id === folderId && l.type === "folder" && l.open === false,
    );

  if (prev?.type === "folder") {
    return prev.open === false ? null : prev.id;
  }
  if (prev?.folder) {
    if (isClosed(prev.folder)) return null;
    if (!next) return prev.folder;
    if (next.folder === prev.folder) return prev.folder;
    if (next.type === "folder") return prev.folder;
    if (next.folder) return prev.folder;
    return null;
  }
  if (next?.folder && next.type !== "folder") {
    if (isClosed(next.folder)) return null;
    return next.folder;
  }
  return null;
};

// Choose a rank that doesn't collide with any existing rank in `lists`.
// generateKeyBetween is unaware of in-use ranks — when it picks one that's
// already taken, ensureRanks would later see a duplicate and re-key the set.
// Tighten the lower bound iteratively until we land on a free slot.
const uniqueRankBetween = (prevRank, nextRank, used) => {
  // Guard against inconsistent anchors (prev >= next, which order keys reject
  // by throwing): fall back to "just after prev" so a reorder can never crash.
  let lower = prevRank;
  let upper =
    prevRank != null && nextRank != null && prevRank >= nextRank
      ? null
      : nextRank;
  let candidate = generateKeyBetween(lower, upper);
  while (used.has(candidate)) {
    lower = candidate;
    candidate = generateKeyBetween(lower, upper);
  }
  return candidate;
};

// A valid rank anchor within `context` ("__top__" for the top-level run, or a
// folder id for that folder's contents). Phantom drop-slots never anchor (no
// real rank). Shared by reorderList and reorderFolder. `excludeIds` drops a
// dragged folder's own contents.
const isRankAnchor = (item, context, excludeIds) => {
  if (!item || item._phantom) return false;
  if (excludeIds && excludeIds.has(item.id)) return false;
  if (context === "__top__") return isTopLevel(item);
  return item.folder === context;
};

// Largest child rank of a folder, so a drop right after a COLLAPSED folder can
// advance the lower bound past its hidden children and land after the whole
// group (hidden children occupy rbd flat indices but height:0).
const maxChildRank = (lists, folderId, fallback) => {
  let max = fallback;
  for (const child of lists) {
    if (child.folder === folderId && child.rank && (!max || child.rank > max)) {
      max = child.rank;
    }
  }
  return max;
};

// Anchor ranks for an insertion at `insertAt` within `items`, scanning out from
// the drop point for the nearest valid anchor on each side. Advances past a
// collapsed folder's hidden children. Returns { prevRank, nextRank }.
const anchorRanks = (items, insertAt, context, allLists, excludeIds) => {
  let prevRank = null;
  for (let i = insertAt - 1; i >= 0; i--) {
    const c = items[i];
    if (isRankAnchor(c, context, excludeIds)) {
      prevRank = c.rank || null;
      if (c.type === "folder" && c.open === false) {
        prevRank = maxChildRank(allLists, c.id, prevRank);
      }
      break;
    }
  }
  let nextRank = null;
  for (let i = insertAt; i < items.length; i++) {
    if (isRankAnchor(items[i], context, excludeIds)) {
      nextRank = items[i].rank || null;
      break;
    }
  }
  return { prevRank, nextRank };
};

export const reorderList = (lists, sourceIndex, destIndex) => {
  const item = lists[sourceIndex];

  const withoutItem = lists.filter((_, i) => i !== sourceIndex);
  const insertAt = destIndex;

  const newFolder = dropFolderFor(withoutItem, insertAt);

  // Anchor against the same context the item lands in — the top-level run (when
  // newFolder is null) or the target folder's contents — so we never anchor on
  // an unrelated rank space (e.g. another folder's children). See isRankAnchor /
  // anchorRanks.
  const context = newFolder === null ? "__top__" : newFolder;
  const { prevRank, nextRank } = anchorRanks(withoutItem, insertAt, context, lists);

  const usedRanks = new Set(
    lists.filter((l) => l.id !== item.id && l.rank).map((l) => l.rank),
  );
  const newRank = uniqueRankBetween(prevRank, nextRank, usedRanks);

  return lists.map((l) =>
    l.id === item.id
      ? { ...l, rank: newRank, folder: newFolder, updated_at: new Date().toISOString() }
      : l
  );
};

export const reorderFolder = (lists, sourceIndex, destIndex) => {
  const folder = lists[sourceIndex];

  if (folder?.type !== "folder") {
    return reorderList(lists, sourceIndex, destIndex);
  }

  // rbd's destIndex is the position in the NEW array (after removing source).
  // Operate on the post-removal array so destIndex maps correctly regardless
  // of whether source < dest or source > dest.
  const contentIds = new Set(
    lists.filter((l) => l.folder === folder.id).map((l) => l.id),
  );
  const withoutFolder = lists.filter((_, i) => i !== sourceIndex);

  // A folder ranks relative to the TOP-LEVEL run only — anchor there, excluding
  // the folder's own contents. isRankAnchor skips phantom drop-slots.
  const { prevRank, nextRank } = anchorRanks(
    withoutFolder,
    destIndex,
    "__top__",
    lists,
    contentIds,
  );

  const usedRanks = new Set(
    lists.filter((l) => l.id !== folder.id && l.rank).map((l) => l.rank),
  );
  const newRank = uniqueRankBetween(prevRank, nextRank, usedRanks);

  return lists.map((l) =>
    l.id === folder.id
      ? { ...l, rank: newRank, updated_at: new Date().toISOString() }
      : l,
  );
};
