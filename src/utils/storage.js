/**
 * Single localStorage seam for the OWR sync/list modules.
 */

const hasLocalStorage = () => typeof localStorage !== "undefined";

export const getItem = (key) =>
  hasLocalStorage() ? localStorage.getItem(key) : null;

export const setItem = (key, val) => {
  if (hasLocalStorage()) localStorage.setItem(key, val);
};

export const removeItem = (key) => {
  if (hasLocalStorage()) localStorage.removeItem(key);
};
