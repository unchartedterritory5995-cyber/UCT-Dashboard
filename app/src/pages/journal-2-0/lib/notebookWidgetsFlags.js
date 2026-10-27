import { notebookFlag } from './offline/notebookFlags'

/** Notebook widgets release gates, one per wave (plan docs/superpowers/plans/2026-10-20-notebook-widgets.md).
 *  The server flag is `NOTEBOOK_WIDGETS_W<n>_ENABLED`; the payload key is its lowercase form, latched per
 *  tab by `notebookFlags.js`. Absent => OFF. A wave flag gates menu entries and server reads only: a
 *  widget already stored in a note always renders, whatever this answers. */
const WAVES = Object.freeze([1, 2, 3, 4, 5, 6, 8, 9, 10, 11])

/** F2 cleanup: a widget door whose lazy chunk cannot load says so, never silent. ONE sentence for every door (the /
 *  menu's widget inserts and doors, and the Notebook header's My tools), so it lives here, beside the gates every door
 *  already imports. Offline is offline, not a reload. */
export const WIDGET_CHUNK_LOST = "This widget couldn't load. Reload the page to try again."
export const DOOR_OFFLINE = "You're offline, so this could not open."
export const doorLostSentence = () => (typeof navigator !== 'undefined' && navigator.onLine === false
  ? DOOR_OFFLINE : WIDGET_CHUNK_LOST)

export const widgetsWaveFlag = (wave) => `notebook_widgets_w${wave}_enabled`

export const widgetsWaveOn = (wave) => WAVES.includes(wave) && notebookFlag(widgetsWaveFlag(wave)) === true
