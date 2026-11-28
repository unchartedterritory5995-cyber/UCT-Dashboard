// The keep-alive's LAYER primitive (2026-11-27): what a hidden layer carries, one definition for a kept board's slot
// (ChartsWorkspace) and a chart slot (the double-buffered row). Spread it on the layer's wrapper element.
import styles from './boardLayer.module.css'

/** The wrapper props of a layer: hidden, it is the absolutely positioned, invisible, inert, aria-hidden layer;
 *  shown, it carries `shownClassName` (if any) and nothing else.
 *  `keepLayout` (the double-buffered chart slot, 2026-11-28): the hidden layer KEEPS `shownClassName` too, so a flip
 *  changes only visibility and hit-testing, never the layer's `display`. ⛔ Without it the chart slot's hidden layer
 *  was `display: block` and the shown one `display: flex`: every flip changed `display` on BOTH layers, and Blink
 *  rebuilds the layout tree of an element whose `display` changes, so each zoomed-out flip relaid out both panes
 *  (~50 ms of style, layout and paint in the frame that showed the press, the cloud rig's profiles of 2026-11-28).
 *  Not for a kept board: its shown slot is `display: contents`, which a hidden layer cannot keep. */
export function boardLayerProps(hidden, shownClassName, { keepLayout = false } = {}) {
  if (!hidden) return { className: shownClassName, inert: false, 'aria-hidden': undefined }
  const className = keepLayout && shownClassName ? `${shownClassName} ${styles.boardSlotLayer}` : styles.boardSlotLayer
  return { className, inert: true, 'aria-hidden': true }
}

export const BOARD_LAYER_CLASS = styles.boardSlotLayer
