import { useCallback } from "react";
import { useDispatch } from "react-redux";

import { setLists } from "../state/lists";
import { commitLists } from "./owr-list";
import { filterDeletedLists } from "./owr-sync";

/**
 * The one way UI code mutates the list collection.
 *
 * Returns a `commit(transform)` function that runs the change through the
 * single commitLists primitive (fresh read → keeps tombstones, auto-dirty,
 * persist, push) and then dispatches the non-deleted view to Redux. Every
 * screen calls `commit(op(...))` and nothing else — the 4-step save chore
 * lives in exactly one place.
 *
 * @returns {(transform: (lists: object[]) => object[]) => object[]}
 */
export const useListCommit = () => {
  const dispatch = useDispatch();
  return useCallback(
    (transform) => {
      const after = commitLists(transform);
      dispatch(setLists(filterDeletedLists(after)));
      return after;
    },
    [dispatch],
  );
};
