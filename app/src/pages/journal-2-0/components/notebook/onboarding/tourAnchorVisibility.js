// Anchor visibility (wave 8 final review, fix M-7), moved out of NotebookTour.jsx
// into its own module (wave 14, lane W14-0) so `GenericTourEngine.jsx` -- the
// generic engine for every OTHER registered tour -- can reuse the SAME function
// without a static import of `./NotebookTour` itself. `tourLazy.test.js` holds
// `onboarding/NotebookTour` to exactly one importer (NotebookTourGate.jsx's one
// dynamic `import()`); a second file statically importing it would pull the base
// tour's own chunk (and tourSteps.js/tourCopy.js with it) into whatever imports
// THAT file, which for a lazy-loaded engine file is a correctness risk, not just a
// byte one. `NotebookTour.jsx` re-exports both names from here unchanged, so this
// is pure code motion -- no behaviour anywhere depends on which file declares them.
//
// Whether the member can SEE `el`. Present is not visible: the collapsed sidebar
// keeps its anchors in the DOM, translated out of a 0-width slot that clips them,
// and a `display: none` anchor has no box at all. So an anchor counts only when
//   * it has a box (client rects, and a non-zero area);
//   * that box is not wholly left or right of the window (a page scrolls up and
//     down, never sideways, so nothing can bring a sideways box into view); and
//   * no ancestor that CLIPS (overflow hidden/clip) cuts it to nothing.
// Below the fold is fine: the step scrolls its anchor into view. An ancestor that
// SCROLLS (auto/scroll) can bring the anchor into its own box, so past it what
// must be visible is that scroller's box, not the anchor's.
const CLIPS = new Set(['hidden', 'clip'])
const SCROLLS = new Set(['auto', 'scroll', 'overlay'])
export function isOnScreen(el) {
  if (!el?.getClientRects || el.getClientRects().length === 0) return false
  const r = el.getBoundingClientRect()
  const box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
  const area = (b) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top)
  if (area(box) === 0) return false
  const vw = window.innerWidth || document.documentElement?.clientWidth || 0
  if (vw && (box.right <= 0 || box.left >= vw)) return false
  for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    const cs = window.getComputedStyle(a)
    // A browser always resolves both axes; the shorthand is the fallback for an engine
    // that reports only what it was given (jsdom does).
    const x = cs.overflowX || cs.overflow
    const y = cs.overflowY || cs.overflow
    if (!CLIPS.has(x) && !CLIPS.has(y) && !SCROLLS.has(x) && !SCROLLS.has(y)) continue
    const ar = a.getBoundingClientRect()
    if (SCROLLS.has(x)) { box.left = ar.left; box.right = ar.right }
    else if (CLIPS.has(x)) { box.left = Math.max(box.left, ar.left); box.right = Math.min(box.right, ar.right) }
    if (SCROLLS.has(y)) { box.top = ar.top; box.bottom = ar.bottom }
    else if (CLIPS.has(y)) { box.top = Math.max(box.top, ar.top); box.bottom = Math.min(box.bottom, ar.bottom) }
    if (area(box) === 0) return false
  }
  return true
}

/** Fired on `window` when a tour needs an anchor that is on the page but not on screen
 *  because a region that can be opened hides it -- today the Notebook's folders panel, which
 *  is a closed drawer on a phone. `detail: { region, anchor }`; the region's owner listens
 *  (NotebookTab opens the drawer). Phone pass follow-up (2026-10-10): before the drawer, a
 *  tour that starts in the panel (Search by meaning) could not open on a phone at all. */
export const TOUR_REVEAL_EVENT = 'uct:tour-reveal'

/** Ask the region hiding `anchor` to open. Only for an anchor that EXISTS but is not on
 *  screen, inside an element marked `data-tour-reveal="<region>"`. Returns whether it asked.
 *  Never called from render: the engine calls it from its bounded wait loops. */
export function requestReveal(anchor) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false
  if (anchorFor(anchor)) return false
  const el = document.querySelector(`[data-tour="${anchor}"]`)
  const region = el?.closest('[data-tour-reveal]')
  if (!region) return false
  window.dispatchEvent(new CustomEvent(TOUR_REVEAL_EVENT, {
    detail: { region: region.getAttribute('data-tour-reveal'), anchor },
  }))
  return true
}

/** The on-screen element for an anchor, or null. Explicitly hidden elements do not count,
 *  and nor does one the member cannot see (M-7: a collapsed sidebar's anchors). */
export function anchorFor(anchor) {
  if (typeof document === 'undefined') return null
  const el = document.querySelector(`[data-tour="${anchor}"]`)
  if (!el || el.closest('[hidden],[aria-hidden="true"]')) return null
  if (!isOnScreen(el)) return null
  return el
}
