// The W10.8 walk fix: the Formula box and its suggestions with a phone keyboard open.
//
// At 390 px with the keyboard up the visible area is roughly 390 x 400: the builder's body scrolls between its title
// and the sticky Undo / Redo / Save footer, and the visual viewport ends above the keyboard. The box sat under the
// footer and its suggestions opened below the visible area. These pure helpers decide, from measured rectangles,
// (1) how far to scroll the body so the focused box is inside what is visible, and (2) whether the list fits under the
// box or must open above it, and how tall it may be. FormulaSection measures; nothing here touches the DOM except
// `scrollParentOf` and `bandOf`, which only read it.

/** The list's tallest (its stylesheet's max-height) and the gap between it and the box, in px. */
export const LIST_MAX = 264
export const LIST_GAP = 4
/** The least a list may be squeezed to: one 44 px option and the list's padding. */
export const LIST_MIN = 52
/** Room kept between the box and the edge of what is visible when it is scrolled into view. */
export const REVEAL_MARGIN = 8

/**
 * The visible band `{top, bottom}` (layout-viewport px, as getBoundingClientRect reports) for something inside the
 * scroll container `rect`: the container's own box, cut to the visual viewport `vv` when there is one (the soft
 * keyboard shrinks `vv`, not the layout viewport, on iOS). A missing container is the whole visual viewport.
 */
export function visibleBand(rect, vv, innerHeight = 0) {
  let top = rect ? rect.top : 0
  let bottom = rect ? rect.bottom : innerHeight
  if (vv && Number.isFinite(vv.height) && vv.height > 0) {
    const vTop = Number.isFinite(vv.offsetTop) ? vv.offsetTop : 0
    top = Math.max(top, vTop)
    bottom = Math.min(bottom, vTop + vv.height)
  }
  return { top, bottom: Math.max(top, bottom) }
}

/**
 * How far to scroll (positive: down) so a box `{top, bottom}` sits inside `band` with `margin` to spare. A box below
 * the band is brought up to its bottom edge; if that would push its top out (a box taller than the band), its top is
 * aligned instead. 0 when it is already inside.
 */
export function revealDelta(box, band, margin = REVEAL_MARGIN) {
  let d = 0
  if (box.bottom + margin > band.bottom) d = box.bottom + margin - band.bottom
  if (box.top - d - margin < band.top) d = box.top - margin - band.top
  return Math.round(d)
}

/**
 * Where the suggestions open for a box `{top, bottom}` inside `band`, wanting `want` px: `{side, maxHeight}`.
 * Under the box when the list fits there; above it when it does not and there is more room above; else under it,
 * squeezed to the room there (never below LIST_MIN). maxHeight never exceeds LIST_MAX.
 */
export function placeList(box, band, want = LIST_MAX) {
  const need = Math.max(LIST_MIN, Math.min(LIST_MAX, want))
  const below = band.bottom - box.bottom - LIST_GAP
  const above = box.top - band.top - LIST_GAP
  const fit = (room) => Math.max(LIST_MIN, Math.min(LIST_MAX, Math.floor(room)))
  if (below >= need) return { side: 'below', maxHeight: fit(below) }
  if (above > below) return { side: 'above', maxHeight: fit(above) }
  return { side: 'below', maxHeight: fit(below) }
}

/** The nearest ancestor of `el` that scrolls vertically (overflow-y auto or scroll), or null. */
export function scrollParentOf(el) {
  for (let p = el?.parentElement || null; p; p = p.parentElement) {
    let oy = ''
    try { oy = window.getComputedStyle(p).overflowY } catch { oy = '' }
    if (oy === 'auto' || oy === 'scroll') return p
  }
  return null
}

/** The visible band for an element inside scroll container `sc` (null: the page), read now. */
export function bandOf(sc) {
  const vv = typeof window !== 'undefined' ? window.visualViewport || null : null
  return visibleBand(sc ? sc.getBoundingClientRect() : null, vv, typeof window !== 'undefined' ? window.innerHeight : 0)
}
