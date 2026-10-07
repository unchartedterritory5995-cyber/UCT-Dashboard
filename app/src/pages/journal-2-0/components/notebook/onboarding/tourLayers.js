// Which layer a tour card belongs to, and whether it is on top (wave 14, lane W14-C1).
// Imported only by GenericTourEngine.jsx (a lazy chunk). Kept out of the component file so
// that file exports components only.

/** The sheet or dialog an element sits in, or null. */
export function dialogHost(el) {
  return el?.closest?.('[data-sheet-panel],[role="dialog"],[aria-modal="true"]') || null
}

/** Whether `card` is the topmost layer: no sheet or modal dialog that does not contain it
 *  comes after it in document order (portals append to <body> in mount order, the same
 *  rule Sheet.jsx's own `isTopmost` applies). */
export function cardIsTopmost(card) {
  if (!card) return false
  const layers = document.querySelectorAll('[data-sheet-panel],[aria-modal="true"]')
  for (const layer of layers) {
    if (layer === card || layer.contains(card) || card.contains(layer)) continue
    if (card.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING) return false
  }
  return true
}
