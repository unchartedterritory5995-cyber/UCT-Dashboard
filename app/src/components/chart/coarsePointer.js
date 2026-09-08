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
/** Selection-handle PAINT radius in px (the halo is drawn from the hit radius). */
export const HANDLE_COARSE = 7
export const HANDLE_FINE = 4

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
