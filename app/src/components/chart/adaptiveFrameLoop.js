// A per-frame measuring loop that stops spending frames when nothing is moving.
//
// WHY (measured 2026-11-10, desktop trace, 12 chart widgets): StockChart's chrome-placement loop
// re-armed `requestAnimationFrame` unconditionally, so every chart ran it ~44 times a second forever,
// each run reading pane heights, computed styles and element boxes (forced style and layout) even
// when the chart had not moved for an hour.
//
// HOW: `tick()` measures and returns a SIGNATURE of what it measured (any string), or `null` when the
// layout is still settling (a pending state update, a bar waiting to be revealed). While the
// signature keeps changing, or is null, the loop runs every frame, exactly as before. After
// `idleAfterFrames` identical signatures in a row it drops to one tick every `idleIntervalMs` (a
// safety pass that still catches anything no trigger reported). `wake()` (pointer, wheel, resize,
// crosshair, visible-range or data events) returns it to every-frame mode at once, so a divider drag
// tracks the pointer frame by frame.
//
// Timers are injected so every rule is unit-tested without a browser.

export const IDLE_AFTER_FRAMES = 10
export const IDLE_INTERVAL_MS = 250

export function createAdaptiveFrameLoop({
  tick,
  raf = (fn) => requestAnimationFrame(fn),
  caf = (id) => cancelAnimationFrame(id),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  idleAfterFrames = IDLE_AFTER_FRAMES,
  idleIntervalMs = IDLE_INTERVAL_MS,
}) {
  let frameId = null
  let timerId = null
  let lastSig
  let same = 0
  let idle = false
  let stopped = false

  const clearPending = () => {
    if (frameId !== null) { caf(frameId); frameId = null }
    if (timerId !== null) { clearTimer(timerId); timerId = null }
  }

  const schedule = () => {
    if (stopped) return
    if (idle) timerId = setTimer(run, idleIntervalMs)
    else frameId = raf(run)
  }

  function run() {
    frameId = null
    timerId = null
    if (stopped) return
    let sig = null
    try { sig = tick() } catch { sig = null }
    if (sig !== null && sig === lastSig) {
      same++
      if (!idle && same >= idleAfterFrames) idle = true
    } else {
      same = 0
      // A change seen by the slow safety pass means something moved that no trigger reported:
      // go back to every frame until it settles again.
      idle = false
    }
    lastSig = sig
    schedule()
  }

  return {
    start() {
      stopped = false
      clearPending()
      run()
    },
    /** Something may be moving: measure every frame again, starting with the next frame. */
    wake() {
      if (stopped) return
      same = 0
      if (!idle && frameId !== null) return // already every frame
      idle = false
      clearPending()
      frameId = raf(run)
    },
    stop() {
      stopped = true
      clearPending()
    },
    isIdle: () => idle,
  }
}
