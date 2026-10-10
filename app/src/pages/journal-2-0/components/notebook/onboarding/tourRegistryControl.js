// How anything outside the generic tour engine asks it to open a REGISTERED tour by
// id (wave 14, lane W14-0) -- mirrors tourControl.js exactly, generalized with a
// tour id. The base tour keeps its OWN control module (tourControl.js, its own
// `TOUR_OPEN_EVENT`, its own pending flag), completely unchanged; this module is
// for every OTHER tour `RegistryToursGate.jsx` runs.
//
// ONE pending tour at a time (plan section 4.3, decision D3: "one prompt at a
// time"), exactly like the base tour's own single pending flag -- a second request
// before the first is taken replaces it rather than queuing, which is W14-C's own
// queueing design to build once more than one tour exists to queue.

export const REGISTRY_TOUR_OPEN_EVENT = 'uct:notebook-registry-tour-open'
/** Fired by the gate whenever a requested tour ends, `{tourId, opened}`: `opened` is false
 *  when it never showed a step (nothing to point at, nothing to open, or its flags off). */
export const REGISTRY_TOUR_CLOSED_EVENT = 'uct:notebook-registry-tour-closed'

export function announceRegistryTourClosed(tourId, opened) {
  try {
    window.dispatchEvent(new CustomEvent(REGISTRY_TOUR_CLOSED_EVENT, { detail: { tourId, opened: opened === true } }))
  } catch {
    // no window (never in the app)
  }
}

let pendingId = null

/** Open a registered tour now, whatever its own seen-state says. */
export function openRegistryTour(tourId) {
  pendingId = tourId
  try {
    window.dispatchEvent(new CustomEvent(REGISTRY_TOUR_OPEN_EVENT, { detail: { tourId } }))
  } catch {
    // no window (never in the app): the pending id still carries the request
  }
}

/** Keep `tourId`'s request alive across a navigation, WITHOUT asking anyone to open it now.
 *  The app's route boundary is keyed by pathname (components/RouteErrorBoundary.jsx), so a
 *  tour whose start is on another page remounts the whole shell, this gate included, on the
 *  way there; the new gate takes the request on mount and the tour goes on (W14-Q2). */
export function carryRegistryTourOpen(tourId) {
  pendingId = tourId
}

/** Whether a request is waiting, WITHOUT taking it. */
export function hasPendingRegistryTourOpen() {
  return pendingId
}

/** The gate asks once, on mount: was it asked to open something before it existed? */
export function takePendingRegistryTourOpenAny() {
  const was = pendingId
  pendingId = null
  return was
}

/** A router `location.state` with the tour request removed (null when nothing else is left).
 *  The gate spends the request the moment it reads it, and the engine never carries it on. */
export function stripTourState(state) {
  if (!state || typeof state !== 'object') return state ?? null
  const { startRegistryTourId: _ignored, ...rest } = state
  return Object.keys(rest).length ? rest : null
}

// ── Which registered tour the gate is running right now (Notebook UX pass, 2026-10-10) ───────
// Research Home folds an empty box (Reporting soon, Passed setups) to its one-line header, and a
// folded box's content is UNMOUNTED -- so a walkthrough whose anchors live in that box would wait
// on a screen that does not show them and close with nothing shown. The gate publishes the tour
// it is running (`wantedId`) here, whatever opened it (Help's Replay, the Learn menu, the offer,
// the checklist, a request carried across a page change), and Research Home opens its folded
// boxes while one is wanted. The gate is the one writer; nothing here opens a tour.
let wantedNow = null
const wantedListeners = new Set()

/** The gate's own call: the tour it is running now, or null. */
export function publishRegistryTourWanted(tourId) {
  const next = tourId || null
  if (next === wantedNow) return
  wantedNow = next
  for (const fn of Array.from(wantedListeners)) fn()
}

/** The tour the gate is running now, or null (a `useSyncExternalStore` snapshot). */
export function getRegistryTourWanted() {
  return wantedNow
}

/** Subscribe to changes of `getRegistryTourWanted()`; returns the unsubscribe. */
export function subscribeRegistryTourWanted(fn) {
  wantedListeners.add(fn)
  return () => { wantedListeners.delete(fn) }
}

/** Rails only. */
export function __resetRegistryTourControl() {
  pendingId = null
  wantedNow = null
}
