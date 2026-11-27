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
// PAUSE (2026-11-27, the board keep-alive's layer mode, boardVisibility.js): an optional `gate`
// `{ paused(), subscribe(cb) }`. A run that finds it paused measures nothing and schedules nothing (the loop PARKS);
// the gate's change that un-pauses it runs the loop on the next frame, never synchronously, so the show of a hidden
// board pays no measuring pass in its own task. No gate: exactly as before.
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
  gate = null,
}) {
  let frameId = null
  let timerId = null
  let lastSig
  let same = 0
  let idle = false
  let stopped = false
  let parked = false
  let unGate = null
  // an `inFrame` start whose first measurement has not run yet
  let firstPending = false

  const clearPending = () => {
    if (frameId !== null) { caf(frameId); frameId = null }
    if (timerId !== null) { clearTimer(timerId); timerId = null }
  }
  const dropGate = () => {
    if (unGate) { try { unGate() } catch { /* gone */ } unGate = null }
  }
  // The gate changed: a parked loop that may run again measures on the NEXT frame (every frame until it settles).
  const onGate = () => {
    if (!parked || stopped) return
    let still = true
    try { still = !!gate.paused() } catch { still = false }
    if (still) return
    parked = false
    dropGate()
    same = 0
    idle = false
    clearPending()
    frameId = raf(run)
  }

  const schedule = () => {
    if (stopped) return
    if (idle) timerId = setTimer(run, idleIntervalMs)
    else frameId = raf(run)
  }

  function run() {
    frameId = null
    timerId = null
    firstPending = false
    if (stopped) return
    let paused = false
    try { paused = !!gate?.paused() } catch { paused = false }
    if (paused) {
      // parked: nothing measured, nothing scheduled, until the gate lets it run again (onGate)
      parked = true
      if (!unGate) unGate = gate.subscribe(onGate)
      return
    }
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
    /**
     * Measure now, then keep measuring. `{ inFrame: true }`: the first measurement waits for the next frame
     * (`raf`, which runs before that frame paints) instead of running inside the caller. A caller inside a React
     * commit measured the freshly committed DOM there: its first layout read forced the whole style and layout in
     * the middle of the task, and its writes invalidated it again for the next effect's read. In the frame it reads
     * the layout the frame computes anyway, once.
     */
    start({ inFrame = false } = {}) {
      stopped = false
      clearPending()
      if (inFrame) { firstPending = true; frameId = raf(run) } else run()
    },
    /**
     * An `inFrame` start whose first measurement is still waiting: take it now, and say so (`true`). For a
     * ResizeObserver's delivery, which comes after this frame's layout and before its paint: a start made inside an
     * animation-frame callback (a `flushSync` from one) asked for the NEXT frame, and this keeps the first painted
     * frame placed. `false` (and nothing runs) once the first measurement has run, or after `stop()`.
     */
    runPendingStart() {
      if (stopped || !firstPending) return false
      clearPending()
      run()
      return true
    },
    /** Something may be moving: measure every frame again, starting with the next frame. */
    wake() {
      if (stopped || parked) return
      same = 0
      if (!idle && frameId !== null) return // already every frame
      idle = false
      clearPending()
      frameId = raf(run)
    },
    stop() {
      stopped = true
      parked = false
      firstPending = false
      clearPending()
      dropGate()
    },
    isIdle: () => idle,
  }
}
