// app/src/utils/afterPaintSlot.js
//
// ONE waiting run per owner, and the LATEST request is the one that runs. Two timings:
//
//   createAfterPaintSlot()  after the next painted frame (`afterPaint`: an animation frame, then a zero timer).
//   createNextFrameSlot()   IN the next animation frame callback itself: after every DOM write of the task that
//                           asked, and before that frame's layout and paint (`inNextFrame` below).
//
// A watchlist's arrow key asks for the selected row to be kept in view on every press; a held key can press
// several times before a frame comes, and each press scrolling is wasted work (only the last row needs to be in
// view). A slot keeps at most one run waiting: a new request while one waits REPLACES what it will do and does
// not add a second run, so a held key scrolls once per frame, to the newest row, and never stops scrolling (each
// frame that comes runs it, and a timer backs the frame up).
//
// Where no frame is coming (a hidden document) both run `fn` at once, every time.

import { afterPaint, MAX_WAIT_MS } from './afterPaint'

/**
 * Run `fn` in the next animation frame callback (before that frame's layout and paint), once. A hidden document
 * (or no requestAnimationFrame) runs it at once; on a visible page a timer backs the frame up.
 * ⭐ WHY THE FRAME CALLBACK ITSELF (2026-11-23, review of #2598 F1). A layout read there is the layout the frame
 * needs anyway (every DOM write of the task that asked is already made), so it is paid once, not twice; and what it
 * changes (a scroll) is painted in THAT frame, with everything else the task changed, so nothing leads or lags.
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
 * @param {(fn: () => void) => (() => boolean)} defer when the waiting run runs
 * @returns {{ schedule: (fn: () => void) => void, cancel: () => void, waiting: () => boolean }}
 *   schedule: run `fn` at the slot's time; replaces the one still waiting, if any.
 *   cancel: drop what is waiting (an unmount, or a selection that no longer wants it).
 *   waiting: whether a run is waiting.
 */
function createSlot(defer) {
  let next = null       // what the waiting run will do
  let stop = null       // the deferral's cancel for the waiting run; null when none waits
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
      const cancel = defer(() => { ranNow = true; run() })
      // A hidden document runs it inside the deferral: nothing waits, so nothing is kept.
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

/** One waiting run per owner, after the next painted frame. */
export function createAfterPaintSlot() { return createSlot(afterPaint) }

/** One waiting run per owner, in the next animation frame callback (before that frame's layout and paint). */
export function createNextFrameSlot() { return createSlot(inNextFrame) }
