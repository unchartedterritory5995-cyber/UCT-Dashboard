// Which open layer a key press belongs to. A "layer" is an open Sheet, a modal dialog, or a
// non-modal popup that closes on Escape: `[data-sheet-panel]`, `[aria-modal="true"]` or
// `[data-escape-layer]`. The last is a plain data attribute ON PURPOSE: the chart's right-click
// menu, earnings popover, IPO tag and the video player's "Next up" card are not modal, so
// aria-modal would tell a screen reader something false about them. Portals append to <body> in mount order, so
// the layer that comes LAST in document order is the one on top -- the same rule Sheet.jsx's
// own `isTopmost` applies. The Notebook tour (onboarding/tourLayers.js) and the page-level
// shortcut bindings (archive lightbox, screener layout menu, study review card) all ask here,
// so one key press is answered by the topmost surface only.

const LAYERS = '[data-sheet-panel],[aria-modal="true"],[data-escape-layer]'

/** Whether `el` is the topmost layer: no other open layer that neither holds it nor sits
 *  inside it comes after it in document order. */
export function isTopmostLayer(el) {
  if (!el) return false
  for (const layer of document.querySelectorAll(LAYERS)) {
    if (layer === el || layer.contains(el) || el.contains(layer)) continue
    if (el.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING) return false
  }
  return true
}

/** The same layers plus a native <dialog> opened with show()/showModal(). */
export const LAYER_SELECTOR = `${LAYERS},dialog[open]`

/** Is `el` actually on screen? A layer that is mounted but hidden -- by itself, by an
 *  ancestor's `display: none` or `hidden`, or by `visibility: hidden` -- is not a layer. */
function isShowing(el) {
  if (el.closest('[aria-hidden="true"], [inert]')) return false
  if (typeof el.checkVisibility === 'function') return el.checkVisibility({ visibilityProperty: true })
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    if (n.hidden || getComputedStyle(n).display === 'none') return false
  }
  return getComputedStyle(el).visibility !== 'hidden'
}

/** Whether a showing layer is open ABOVE `el`: one that follows it in document order,
 *  INCLUDING one inside it (a context menu or popover that `el` itself opened -- a descendant
 *  also follows its ancestor). For a surface deciding whether ITS OWN Escape should close it;
 *  unlike `isTopmostLayer`, a layer inside `el` counts, because it is drawn over `el`. */
export function layerAbove(el) {
  if (!el) return false
  for (const layer of document.querySelectorAll(LAYER_SELECTOR)) {
    if (layer === el || layer.contains(el)) continue
    if (!isShowing(layer)) continue
    if (el.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING) return true
  }
  return false
}

/** Whether any layer is open above the page (for a page-level surface, which is not a layer
 *  itself). `within` (optional) is the surface's own root: a layer inside it is its own. */
export function modalLayerOpen(within = null) {
  for (const layer of document.querySelectorAll(LAYERS)) {
    if (within && within.contains(layer)) continue
    return true
  }
  return false
}
