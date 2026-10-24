import { notebookFlag } from './offline/notebookFlags'

/** Notebook widgets release gates, one per wave (plan docs/superpowers/plans/2026-10-20-notebook-widgets.md).
 *  The server flag is `NOTEBOOK_WIDGETS_W<n>_ENABLED`; the payload key is its lowercase form, latched per
 *  tab by `notebookFlags.js`. Absent => OFF. A wave flag gates menu entries and server reads only: a
 *  widget already stored in a note always renders, whatever this answers. */
const WAVES = Object.freeze([1, 2, 3, 4, 5, 6, 8, 9])

export const widgetsWaveFlag = (wave) => `notebook_widgets_w${wave}_enabled`

export const widgetsWaveOn = (wave) => WAVES.includes(wave) && notebookFlag(widgetsWaveFlag(wave)) === true
