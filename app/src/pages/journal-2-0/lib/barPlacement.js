// app/src/pages/journal-2-0/lib/barPlacement.js
/**
 * Tier 2 part A, item 10 (fix round 1) -- where a `position: fixed` bar floated under an element goes. Pure (numbers in, numbers
 * out), so the clamp is read without a layout engine. Used by components/notebook/ScreenshotTagOffer.
 */
const EDGE = 8 // px kept clear of every window edge

/**
 * Where the bar goes: under the image (6 px below its bottom, its left edge), then kept INSIDE the window on both axes.
 * The bar is `position: fixed`, so an image whose bottom is below the window (a tall screenshot at a desktop height; the
 * walk read the chip at y 991-1018 in an 800 px window) would otherwise put it where no one can reach it. Pure, so the
 * clamp is read without a layout engine: `bar` is the bar's own size, `view` the window's.
 */
export function barPlacement(rect, bar, view) {
  const maxTop = view.height - bar.height - EDGE
  const maxLeft = view.width - bar.width - EDGE
  return {
    // Lower bound last: a bar taller or wider than the window starts at the edge instead of running off the other side.
    top: Math.round(Math.max(EDGE, Math.min(rect.bottom + 6, maxTop))),
    left: Math.round(Math.max(EDGE, Math.min(rect.left, maxLeft))),
  }
}
