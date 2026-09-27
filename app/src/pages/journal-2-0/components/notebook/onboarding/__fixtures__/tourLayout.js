// A layout for the tour's rails (wave 8 final review, fix M-7).
//
// jsdom performs no layout: every element reports no client rects and a zero box, so a tour
// that asks "can the member SEE this anchor?" (NotebookTour.jsx `isOnScreen`) would find none
// and never open. This hands elements a box, and lets a fixture say where it is:
//   * default                     -- a visible 200x40 box at (100, 100);
//   * data-test-box="none"        -- no box at all (display: none);
//   * data-test-box="l,t,r,b"     -- that box, e.g. a sidebar translated off-screen or a
//                                    0-width clipping slot.
// Clipping is real: `isOnScreen` reads each ancestor's computed `overflow`, and jsdom does
// compute inline styles, so a fixture writes `style="overflow: hidden"` on the slot.
import { vi } from 'vitest'

const DEFAULT = { left: 100, top: 100, right: 300, bottom: 140 }

function boxOf(el) {
  const spec = el.getAttribute?.('data-test-box')
  if (spec === 'none') return null
  if (spec) {
    const [left, top, right, bottom] = spec.split(',').map(Number)
    return { left, top, right, bottom }
  }
  return DEFAULT
}

function rect(b) {
  const r = b || { left: 0, top: 0, right: 0, bottom: 0 }
  return { ...r, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top, toJSON() { return r } }
}

/** Install the stubs; returns a restore function. */
export function installTourLayout() {
  const rects = vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function getClientRects() {
    const b = boxOf(this)
    return b ? [rect(b)] : []
  })
  const box = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function getBoundingClientRect() {
    return rect(boxOf(this))
  })
  return () => { rects.mockRestore(); box.mockRestore() }
}
