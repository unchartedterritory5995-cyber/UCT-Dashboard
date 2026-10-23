// Which open layer a key press belongs to. A "layer" is an open Sheet or a modal dialog:
// `[data-sheet-panel]` or `[aria-modal="true"]`. Portals append to <body> in mount order, so
// the layer that comes LAST in document order is the one on top -- the same rule Sheet.jsx's
// own `isTopmost` applies. The Notebook tour (onboarding/tourLayers.js) and the page-level
// shortcut bindings (archive lightbox, screener layout menu, study review card) all ask here,
// so one key press is answered by the topmost surface only.

const LAYERS = '[data-sheet-panel],[aria-modal="true"]'

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

/** Whether any layer is open above the page (for a page-level surface, which is not a layer
 *  itself). `within` (optional) is the surface's own root: a layer inside it is its own. */
export function modalLayerOpen(within = null) {
  for (const layer of document.querySelectorAll(LAYERS)) {
    if (within && within.contains(layer)) continue
    return true
  }
  return false
}
