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

/** Rails only. */
export function __resetRegistryTourControl() {
  pendingId = null
}
