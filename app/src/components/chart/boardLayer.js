// The keep-alive's LAYER primitive (2026-11-27): what a hidden layer carries, one definition for a kept board's slot
// (ChartsWorkspace) and a chart slot (the double-buffered row). Spread it on the layer's wrapper element.
import styles from './boardLayer.module.css'

/** The wrapper props of a layer: hidden, it is the absolutely positioned, invisible, inert, aria-hidden layer;
 *  shown, it carries `shownClassName` (if any) and nothing else. */
export function boardLayerProps(hidden, shownClassName) {
  return hidden
    ? { className: styles.boardSlotLayer, inert: true, 'aria-hidden': true }
    : { className: shownClassName, inert: false, 'aria-hidden': undefined }
}

export const BOARD_LAYER_CLASS = styles.boardSlotLayer
