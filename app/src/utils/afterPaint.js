// app/src/utils/afterPaint.js
//
// Run work that changes nothing on screen AFTER the frame now being built has been painted.
//
// A passive effect of a render made in a key handler runs inside that same task, before the browser paints
// the result. Work there that draws nothing (asking the network for the next rows, pinning caches) is paid
// for by the pixels the member is waiting on. `afterPaint(fn)` moves it into the first slot after the next
// frame: an animation frame callback, then a zero timer (the same slot StockChart's after-paint placement
// uses), so the frame's own work and the paint come first.
//
// ⛔ NEVER LATER THAN `MAX_WAIT_MS`, AND AT ONCE WHERE NO FRAME IS COMING. A hidden document draws no frames
// (a widget popped out of a window that is now covered still runs in that window), and a hidden page's
// timers are slowed, so there `fn` runs synchronously, exactly as it did before it was deferred. On a
// visible page a timer backs the frame up in case none arrives.

/** The longest `fn` waits for a frame on a visible page. */
export const MAX_WAIT_MS = 250

/**
 * @param {() => void} fn runs once
 * @returns {() => boolean} cancel: stops `fn` if it has not run, and says whether it was still waiting
 */
export function afterPaint(fn) {
  const hidden = typeof document !== 'undefined' && document.hidden === true
  if (hidden || typeof requestAnimationFrame !== 'function') {
    fn()
    return () => false
  }
  let waiting = true
  let frame = 0
  let timer = 0
  let backstop = 0
  const run = () => {
    if (!waiting) return
    waiting = false
    if (frame) cancelAnimationFrame(frame)
    clearTimeout(timer)
    clearTimeout(backstop)
    fn()
  }
  frame = requestAnimationFrame(() => { frame = 0; timer = setTimeout(run, 0) })
  backstop = setTimeout(run, MAX_WAIT_MS)
  return () => {
    if (!waiting) return false
    waiting = false
    if (frame) cancelAnimationFrame(frame)
    clearTimeout(timer)
    clearTimeout(backstop)
    return true
  }
}
