// The Flagged set: this browser's copy, which every star, Shift+F and useFlagged reads. A write tells every mounted
// useFlagged at once (the event). No React here, so the Agent's host writes through the very same two functions a star
// does (agent/host.js buildFlaggedSource) instead of a second copy of the storage key.

export const FLAGGED_STORAGE_KEY = 'uct_flagged'
export const FLAGGED_SYNC_EVENT = 'uct:flagged-changed'

export function readFlagged() {
  try { return JSON.parse(localStorage.getItem(FLAGGED_STORAGE_KEY) ?? '[]') }
  catch { return [] }
}

export function writeFlagged(arr) {
  localStorage.setItem(FLAGGED_STORAGE_KEY, JSON.stringify(arr))
  window.dispatchEvent(new Event(FLAGGED_SYNC_EVENT))
}
