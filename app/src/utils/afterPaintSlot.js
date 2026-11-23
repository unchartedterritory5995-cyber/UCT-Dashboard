// app/src/utils/afterPaintSlot.js
//
// ONE waiting after-paint run per owner, and the LATEST request is the one that runs.
//
// `afterPaint(fn)` (./afterPaint.js) moves work out of the frame now being built. A watchlist's arrow key asks
// for the selected row to be kept in view on every press; a held key can press several times before a frame
// comes, and each press scrolling is wasted work (only the last row needs to be in view). A slot keeps at most
// one run waiting: a new request while one waits REPLACES what it will do and does not add a second run, so a
// held key scrolls once per frame, to the newest row, and never stops scrolling (each frame that comes runs it,
// and afterPaint's own timer backs the frame up).
//
// Where no frame is coming (a hidden document) afterPaint runs `fn` at once, and so does the slot, every time.

import { afterPaint } from './afterPaint'

/**
 * @returns {{ schedule: (fn: () => void) => void, cancel: () => void, waiting: () => boolean }}
 *   schedule: run `fn` after the next painted frame; replaces the one still waiting, if any.
 *   cancel: drop what is waiting (an unmount, or a selection that no longer wants it).
 *   waiting: whether a run is waiting.
 */
export function createAfterPaintSlot() {
  let next = null       // what the waiting run will do
  let stop = null       // afterPaint's cancel for the waiting run; null when none waits
  const run = () => {
    stop = null
    const fn = next
    next = null
    if (fn) fn()
  }
  return {
    schedule(fn) {
      next = fn
      if (stop) return                       // one run already waits: it will do `fn`
      let ranNow = false
      const cancel = afterPaint(() => { ranNow = true; run() })
      // A hidden document runs it inside afterPaint: nothing waits, so nothing is kept.
      if (!ranNow) stop = cancel
    },
    cancel() {
      if (stop) stop()
      stop = null
      next = null
    },
    waiting() { return stop != null },
  }
}
