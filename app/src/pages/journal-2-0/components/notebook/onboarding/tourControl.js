// How anything outside the tour asks it to open (wave 8, lane 8C, C2).
//
// The tour itself (NotebookTour.jsx) is its own lazy chunk, mounted by NotebookTab only while
// `notebook_onboarding_enabled` is on — so a button that wants it ("Take the tour" on the
// first-run screen) must not import it. It announces instead: a window event the mounted tour
// listens for, plus a one-shot flag for a tour whose chunk has not mounted yet.
//
// A link from outside the Notebook (the help article) navigates to the Notebook with
// `state: { startTour: true }`, which the tour reads on mount (TOUR_START_STATE).

export const TOUR_OPEN_EVENT = 'uct:notebook-tour-open'
export const TOUR_START_STATE = Object.freeze({ startTour: true })

let pending = false

/** Open the tour now, whatever the member's tour preference says. */
export function openNotebookTour() {
  pending = true
  try {
    window.dispatchEvent(new CustomEvent(TOUR_OPEN_EVENT))
  } catch {
    // no window (never in the app): the pending flag still carries the request
  }
}

/** Whether a request is waiting, WITHOUT taking it (wave 8 final review, fix I-2): the gate
 *  that decides whether to fetch the tour's chunk asks this; the tour itself, once mounted,
 *  takes the request. */
export function hasPendingTourOpen() {
  return pending
}

/** The tour asks once, on mount: was it asked to open before it existed? */
export function takePendingTourOpen() {
  const was = pending
  pending = false
  return was
}

/** Rails only. */
export function __resetTourControl() {
  pending = false
}
