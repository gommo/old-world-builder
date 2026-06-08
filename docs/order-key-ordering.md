# Order-Key List Ordering

List and folder order is stored in each entity's `rank` field using fractional
indexing order keys. The app compares ranks with normal string comparison, and
moving one item only changes that item's `rank` and, when needed, `folder`.

## Why explicit ranks

Array position is fragile for sync. If two devices reorder different lists, a
full-array sync can only pick one array as the winner. With explicit ranks,
those edits can merge because each changed list carries its own order key.

This also makes database-backed sync practical: the server can store lists in
any array order, while clients sort by `rank` for display.

## Implementation

- `src/utils/order-keys.js` wraps the `fractional-indexing` package and adds
  rank validation.
- `src/utils/list-ordering.js` sorts, migrates, and reorders lists/folders.
- `src/utils/owr-list.js` is the single mutation primitive for list collection
  writes. It reads storage fresh, preserves tombstones, marks changed ids dirty,
  and persists the result.

## Migration

`ensureRanks` handles legacy data:

- invalid or duplicate existing ranks trigger a full re-key in display order;
- rankless arrivals get a new key at the top of their current context;
- tombstones are preserved and not re-ranked;
- orphaned folder children are surfaced instead of dropped.

Extra list fields used by this system are:

| Field | Type | Purpose |
| --- | --- | --- |
| `rank` | `string` | Sort key for list/folder order |
| `folder` | `string \| null` | Parent folder id, or top-level when null |
| `updated_at` | `string` | Per-list sync conflict timestamp |
| `_deleted` | `boolean` | Soft-delete tombstone for sync |
