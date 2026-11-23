// app/src/utils/afterPaintSlot.js
//
// ONE waiting next-frame run per owner, and the LATEST request is the one that runs (`createNextFrameSlot`): the run
// happens IN the next animation frame callback itself, after every DOM write of the task that asked and before that
// frame's layout and paint (`inNextFrame` below).
//
// A watchlist's arrow key asks for the selected row to be kept in view on every press; a held key can press
// several times before a frame comes, and each press scrolling is wasted work (only the last row needs to be in
// view). A slot keeps at most one run waiting: a new request while one waits REPLACES what it will do and does
// not add a second run, so a held key scrolls once per frame, to the newest row, and never stops scrolling (each
// frame that comes runs it, and a timer backs the frame up).
//
// Where no frame is coming (a hidden document) it runs `fn` at once, every time.
// ⚰️ An after-paint slot (`afterPaint`, then a zero timer) lived here for #2598's first design; the review of
// 7ed9ae57b1/e1fdb99975 chose the frame callback (a scroll after the paint led the highlight by a frame on a held key,
// F1), and the after-paint slot, with no caller left, was deleted. `afterPaint` itself (./afterPaint.js) stays.

import { MAX_WAIT_MS } from './afterPaint'

/**
 * Run `fn` in the next animation frame callback (before that frame's layout and paint), once. A hidden document
 * (or no requestAnimationFrame) runs it at once; on a visible page a timer backs the frame up.
 * ⭐ WHY THE FRAME CALLBACK ITSELF (2026-11-23, review of #2598 F1). A layout read there is the layout the frame
 * needs anyway (every DOM write of the task that asked is already made), so it is paid once, not twice; and what it
 * changes (a scroll) is painted in THAT frame, with everything the asking task changed.
 * @param {() => void} fn
 * @returns {() => boolean} cancel: stops `fn` if it has not run, and says whether it was still waiting
 */
export function inNextFrame(fn) {
  const hidden = typeof document !== 'undefined' && document.hidden === true
  if (hidden || typeof requestAnimationFrame !== 'function') {
    fn()
    return () => false
  }
  let waiting = true
  let frame = 0
  let backstop = 0
  const run = () => {
    if (!waiting) return
    waiting = false
    if (frame) cancelAnimationFrame(frame)
    clearTimeout(backstop)
    fn()
  }
  frame = requestAnimationFrame(() => { frame = 0; run() })
  backstop = setTimeout(run, MAX_WAIT_MS)
  return () => {
    if (!waiting) return false
    waiting = false
    if (frame) cancelAnimationFrame(frame)
    clearTimeout(backstop)
    return true
  }
}

/**
 * One waiting run per owner, in the next animation frame callback (before that frame's layout and paint).
 * @returns {{ schedule: (fn: () => void) => void, cancel: () => void, waiting: () => boolean }}
 *   schedule: run `fn` in the next frame callback; replaces the one still waiting, if any.
 *   cancel: drop what is waiting (an unmount, or a selection that no longer wants it).
 *   waiting: whether a run is waiting.
 */
export function createNextFrameSlot() {
  let next = null       // what the waiting run will do
  let stop = null       // inNextFrame's cancel for the waiting run; null when none waits
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
      const cancel = inNextFrame(() => { ranNow = true; run() })
      // A hidden document runs it at once: nothing waits, so nothing is kept.
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
