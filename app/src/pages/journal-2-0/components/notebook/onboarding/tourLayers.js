// Which layer a tour card belongs to, and whether it is on top (wave 14, lane W14-C1).
// Imported only by GenericTourEngine.jsx (a lazy chunk). Kept out of the component file so
// that file exports components only.

import { isTopmostLayer } from '../../../../../lib/topLayer'

/** The sheet or dialog an element sits in, or null. */
export function dialogHost(el) {
  return el?.closest?.('[data-sheet-panel],[role="dialog"],[aria-modal="true"]') || null
}

/** Whether `card` is the topmost layer: no sheet or modal dialog that does not contain it
 *  comes after it in document order. The rule has ONE home, lib/topLayer.js, shared with the
 *  page-level shortcut bindings. */
export const cardIsTopmost = (card) => isTopmostLayer(card)
