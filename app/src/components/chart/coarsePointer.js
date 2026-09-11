/* coarsePointer.js — the ONE answer to a single, narrow question:
 *
 *      "Is the primary pointer driving CHART INTERACTION a coarse one?"
 *
 * ⭐ THE CONTRACT, stated so nobody has to infer it:
 *   • It is about the PRIMARY pointer, via `(pointer: coarse)` — the browser's own
 *     answer. A finger or stylus is coarse; a mouse or trackpad is fine.
 *   • It is LIVE. An iPad gains a trackpad when a Magic Keyboard is attached and
 *     the query flips mid-session; this tracks that.
 *   • It is NOT a device detector, NOT a viewport tier, and NOT "does touch
 *     hardware exist". Those are three different questions with three different
 *     right answers — see WHAT THIS IS NOT below.
 *
 * ⛔ WHY THIS MODULE EXISTS AT ALL, rather than just calling `useHasCoarsePointer`.
 * `ChartDrawingOverlay` decided coarseness in a MODULE-LOAD CONSTANT:
 *
 *      const _COARSE_POINTER = !!window.matchMedia?.('(pointer: coarse)')?.matches
 *      const HIT_THRESHOLD = _COARSE_POINTER ? 15 : 8
 *
 * Two consequences, and the second is why a hook alone cannot replace it:
 *   1. Frozen at import. A resized frame — or an iPad losing its trackpad — could
 *      never become a touch surface, which is exactly why four coarse-pointer
 *      drawing behaviours were unverifiable in the 2026-09 mobile teardown.
 *   2. `HIT_THRESHOLD` is read by ~20 MODULE-SCOPE PURE FUNCTIONS (the hit-test
 *      family). A React hook cannot be called from those, and threading a
 *      parameter through twenty hit-test signatures is a large, risky refactor of
 *      geometry code for no user-visible gain.
 *
 * So this module publishes the same fact through TWO doors that cannot disagree,
 * because they read one store:
 *   • `isCoarsePointer()` / `hitThreshold()` / `handleRadius()` — synchronous, for
 *     pure functions and non-React callers.
 *   • `useCoarsePointer()` — a `useSyncExternalStore` hook, for component branches
 *     that must RE-RENDER when the pointer changes.
 *
 * ⛔ WHAT THIS IS NOT — do not migrate these to it:
 *   • CSS `@media (pointer: coarse)` rules. Presentation belongs in CSS. This
 *     module is for JS BEHAVIOUR that must branch.
 *   • `useIsPhone` / `useIsTouch` (`styles/breakpoints.js`). Those are VIEWPORT
 *     TIERS. A touchscreen laptop is wide and coarse; a small window is narrow and
 *     fine. Width is a layout question.
 *   • `'ontouchstart' in window || navigator.maxTouchPoints > 0` in
 *     `useMobileSWR` / `livePriceStore` / `PullToRefresh`. That asks "does touch
 *     hardware EXIST", which those use as a proxy for a battery/bandwidth-
 *     constrained client to slow polling. A hybrid laptop answers YES to that and
 *     must still get fine-pointer grab radii. Equating the two is the specific
 *     mistake this file exists to prevent.
 */

import { useSyncExternalStore } from 'react'

const QUERY = '(pointer: coarse)'

/** Grab radius in px. A finger is imprecise; a mouse is not. */
export const HIT_COARSE = 15
export const HIT_FINE = 8
/** Selection-handle PAINT radius in px (the halo is drawn from the GRAB radius). */
export const HANDLE_COARSE = 7
export const HANDLE_FINE = 4
/**
 * GRAB radius of a selected drawing's control handle, in px.
 *
 * ⭐ A HANDLE IS THE ONE THING ON THE CHART YOU HAVE ALREADY CHOSEN. The body
 * threshold (`HIT_COARSE`) has to stay modest, or a finger tapping empty space
 * next to a line would keep grabbing the line instead of panning the chart. A
 * handle has no such tension: it only exists while its drawing is selected, it
 * is painted with a halo that says "touch here", and the user's intent when
 * they reach for it is unambiguous. So its grab radius on touch is a full
 * fingertip (24px ≈ 6mm), not the 17px it inherited from the body threshold —
 * which is why adjusting a trendline's end on a phone used to take three tries.
 *
 * ⛔ THE HALO PAINTS THIS SAME NUMBER (`drawingRenderers.renderSelectionHandles`)
 * so what a finger sees is exactly what it can grab. Change them together — they
 * cannot, because both read this one export.
 *
 * Fine pointer keeps the value the mouse always had: the body threshold + 2.
 */
export const HANDLE_GRAB_COARSE = 24
export const HANDLE_GRAB_FINE = HIT_FINE + 2
/**
 * Movement required before a grab becomes a DRAG, in px.
 *
 * ⛔ WITHOUT THIS, TAP-TO-SELECT AND DRAG-TO-MOVE ARE THE SAME GESTURE. The
 * overlay writes `dragRef` on pointerdown and the very next pointermove applied
 * the delta, so on a finger — which always jitters a pixel or two — tapping a
 * trendline to select it NUDGED IT OFF ITS ANCHOR. The user then has to notice
 * the damage and undo it, on a surface where undo is not obvious.
 *
 * ⭐ 8px for a finger is roughly the jitter of a deliberate tap and well under
 * the movement of an intended drag; 2px for a mouse keeps precision work exact.
 * A mouse barely needs one, but a threshold of zero is not a threshold.
 */
export const SLOP_COARSE = 8
export const SLOP_FINE = 2

let _mql = null            // cached MediaQueryList, or null when unavailable
let _resolved = false      // has _mql been looked up yet?
const _subs = new Set()

function mql() {
  if (_resolved) return _mql
  _resolved = true
  // Lazy, never at import: a module evaluated during SSR or before jsdom installs
  // matchMedia must not freeze a wrong answer for the life of the process.
  try {
    _mql = (typeof window !== 'undefined' && typeof window.matchMedia === 'function')
      ? window.matchMedia(QUERY)
      : null
  } catch {
    _mql = null              // a hostile/partial matchMedia must not break charting
  }
  if (_mql) {
    const notify = () => { for (const fn of [..._subs]) { try { fn() } catch { /* a bad subscriber must not stop the rest */ } } }
    // Safari <14 only has the deprecated addListener; charts run there.
    if (typeof _mql.addEventListener === 'function') _mql.addEventListener('change', notify)
    else if (typeof _mql.addListener === 'function') _mql.addListener(notify)
  }
  return _mql
}

/**
 * Is the primary pointer coarse right now?
 *
 * ⭐ DETERMINISTIC FALLBACK: **false** when the question cannot be asked (no
 * `window`, no `matchMedia`, a throwing implementation). Fine-pointer is the safe
 * default — it yields the SMALLER grab radius, so a wrong guess costs precision
 * rather than making a mouse grab drawings it never touched.
 */
export function isCoarsePointer() {
  const m = mql()
  return !!(m && m.matches)
}

/** Grab radius for the current pointer. Call it; never cache the result. */
export function hitThreshold() { return isCoarsePointer() ? HIT_COARSE : HIT_FINE }

/** Selection-handle paint radius for the current pointer. */
export function handleRadius() { return isCoarsePointer() ? HANDLE_COARSE : HANDLE_FINE }
/** Grab radius of a selected drawing's control handle. See HANDLE_GRAB_COARSE. */
export function handleGrabRadius() { return isCoarsePointer() ? HANDLE_GRAB_COARSE : HANDLE_GRAB_FINE }
/** Movement before a grab becomes a drag. See SLOP_COARSE. */
export function dragSlop() { return isCoarsePointer() ? SLOP_COARSE : SLOP_FINE }

/**
 * Has this gesture moved far enough to BE a drag?
 *
 * ⛔ A MISSING ORIGIN RETURNS TRUE, deliberately. If no `startPixel` was
 * recorded there is nothing to measure against, and swallowing the drag would
 * make an object unmovable — a silent, permanent failure. Failing OPEN here
 * degrades to the old (pre-slop) behaviour; failing closed would break the
 * feature outright.
 *
 * Strictly greater-than: a gesture that moves EXACTLY the slop distance has not
 * yet crossed it, so the boundary is testable rather than a matter of taste.
 */
export function crossedDragSlop(startPixel, pos, slop = dragSlop()) {
  if (!startPixel || !pos) return true
  return Math.hypot(pos.x - startPixel.x, pos.y - startPixel.y) > slop
}

/**
 * Subscribe to pointer-type changes. Returns an unsubscribe function.
 * The listener on the MediaQueryList itself is installed once and shared — a
 * per-subscriber listener would leak one handler per mounted chart.
 */
export function subscribeCoarsePointer(cb) {
  mql()
  _subs.add(cb)
  return () => { _subs.delete(cb) }
}

/**
 * React binding. Re-renders the component when the primary pointer changes.
 * `useSyncExternalStore` (not useState+useEffect) so the value read during render
 * is never a frame stale — the same idiom `drawingsStore` uses.
 */
export function useCoarsePointer() {
  return useSyncExternalStore(subscribeCoarsePointer, isCoarsePointer, getServerSnapshot)
}

/** SSR/prerender: no pointer to ask about, so fine — matches the fallback above. */
function getServerSnapshot() { return false }

/**
 * TEST SEAM. Drops the cached MediaQueryList so the next read re-reads
 * `window.matchMedia` — which is how a test installs a coarse or fine pointer.
 * Subscribers are intentionally NOT cleared: a component that stays mounted
 * across a seam reset keeps working.
 * ⛔ Never call this from product code.
 */
export function __resetCoarsePointerForTest() {
  _mql = null
  _resolved = false
}
