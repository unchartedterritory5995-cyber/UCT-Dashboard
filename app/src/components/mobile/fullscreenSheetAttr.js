// A fullscreen Sheet announces itself on <html> so chrome that floats OVER the
// page — the joystick hub above all — can get out of its way (Study spec
// 2026-10-17 §13.2 T16: the drill is a fullscreen Sheet, and the hub mounts on
// every page at ≤1023px coarse pointer, sitting over a full-width chart).
//
// ⭐ A DOCUMENT ATTRIBUTE, NOT A CONTEXT. Sheet portals to <body> and the hub is
// mounted once from Layout.jsx; they share no ancestor a context could hang
// from, and the hub already watches `html[data-mobile-chart-shell]` through a
// MutationObserver (hub/hubViewport.js) for exactly this shape of question.
//
// ⛔ REF-COUNTED. Sheets nest (a chart pop-out inside a fullscreen report), so
// the attribute is held while ANY fullscreen sheet is open and removed only
// when the last one releases — a plain set/remove would drop it the moment an
// inner sheet closed, with the outer one still covering the screen.
//
// Kept in its own module rather than exported from Sheet.jsx: a file that
// exports both a component and a constant breaks React Fast Refresh.
export const FULLSCREEN_SHEET_ATTR = 'data-fullscreen-sheet'

let holders = 0

const root = () => (typeof document !== 'undefined' ? document.documentElement : null)

/** Hold the attribute for one open fullscreen sheet. Returns the release. */
export function acquireFullscreenSheet() {
  const el = root()
  if (!el) return () => {}
  holders += 1
  el.setAttribute(FULLSCREEN_SHEET_ATTR, '')
  let released = false
  return () => {
    if (released) return
    released = true
    holders = Math.max(0, holders - 1)
    if (holders === 0) el.removeAttribute(FULLSCREEN_SHEET_ATTR)
  }
}

/** Whether a fullscreen sheet is currently announced on <html>. */
export function fullscreenSheetPresent() {
  const el = root()
  return !!el && el.hasAttribute(FULLSCREEN_SHEET_ATTR)
}
