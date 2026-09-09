// Every capture door dispatches ONE event; CaptureHost renders ONE dialog.
//
// ⛔ Why an event and not a dozen imports: the doors live in unrelated trees
// (the app-wide command palette, a Notebook tab, a research workspace, the
// Screener). Threading a callback through all of them would give each one a
// chance to pass something slightly different — which is precisely the drift
// Slice 2 exists to prevent. One channel, one payload shape, one dialog.
export const CAPTURE_OPEN_EVENT = 'uct:capture-open'

/** Open capture. `detail.destination` is the door's DEFAULT (it stays visible
 *  and changeable); `detail.initial` prefills source fields. Doors pass context;
 *  they never pass semantics. */
export function openCapture(detail = {}) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CAPTURE_OPEN_EVENT, { detail }))
}
