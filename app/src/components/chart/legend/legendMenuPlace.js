/* Where a legend row's menu opens, and where it goes when there is no room under the row.
 *
 * A row's menu hangs under the row's own left edge (`rowMenuAnchor`), and the popover clamps
 * itself into the viewport from there. On a short chart the clamp slides the menu UP, over
 * the very row it belongs to: measured on a 243px chart in a 560px window, a 418px menu
 * opened 20px above its own row and hid it. `menuAnchorWithRoom` moves the menu BESIDE the
 * row in that one case, so the row (its colour, its name, its value) stays readable next to
 * the commands that act on it.
 *
 * The popover primitive (`mobile/ContextPopover`) is not changed for this: it ships in the
 * Notebook's first-open JavaScript, which is a byte budget. The chart measures the mounted
 * menu and hands the popover a moved anchor instead.
 */

/** Pixels between a row and its menu, on either side. */
export const MENU_ROW_GAP = 3
export const MENU_SIDE_GAP = 6
/** The popover keeps this much clear of every viewport edge (`ContextPopover`'s clamp). */
export const MENU_EDGE = 8

/** The anchor for a row's menu, from the row's own box.
 *
 *  `x`/`y` are where the popover opens: the row's left edge, just under it. `besideX` and
 *  `rowTop` are what `menuAnchorWithRoom` needs to move it beside the row; the popover
 *  itself never reads them. */
export function rowMenuAnchor(rect) {
  return {
    x: rect.left,
    y: rect.bottom + MENU_ROW_GAP,
    besideX: rect.right + MENU_SIDE_GAP,
    rowTop: rect.top,
  }
}

/** The anchor to use once the menu's size is known.
 *
 *  Returns the SAME object when nothing changes, so a caller can compare by identity:
 *   - the menu fits under the row: unchanged;
 *   - the anchor does not say where "beside" is (a pointer anchor, an older caller): unchanged;
 *   - there is no room beside the row either: unchanged, and the popover's clamp covers the
 *     row as it always did (a menu must stay on screen before anything else).
 *  Otherwise a new `{ x, y }` beside the row, level with the row's top. The result carries no
 *  `besideX`, so a second pass over it is a no-op. */
export function menuAnchorWithRoom(anchor, menuH, menuW, viewportW, viewportH) {
  if (!anchor || !Number.isFinite(anchor.besideX)) return anchor
  if (!(menuH > 0) || !(menuW > 0)) return anchor
  if (anchor.y + menuH <= viewportH - MENU_EDGE) return anchor
  if (anchor.besideX + menuW > viewportW - MENU_EDGE) return anchor
  return { x: anchor.besideX, y: Number.isFinite(anchor.rowTop) ? anchor.rowTop : anchor.y }
}
