// app/src/components/chart/legend/legendPointerHold.js
//
// ─── THE HOVER-ONLY LEGEND HOLDS WHILE THE POINTER IS ON IT ─────────────────
//
// Owner, 2026-11-16: the legend "flickers when I hold my mouse over it".
//
// ⚰️ MEASURED on production in a real browser, the pointer RESTING on a legend row:
// the legend mounted and unmounted 132 times in 181 frames. A hover-only legend (a
// stack expanded past its pane collapses to one; a grid cell always is one) exists
// only while the chart has a crosshair, and its rows take the pointer. So on a row
// the pointer is OFF the chart: the crosshair clears, the legend unmounts, the
// pointer is on the chart again, the crosshair returns, the legend mounts under the
// pointer, and round it goes.
//
// THE RULE: a crosshair-clear that happens only because the pointer moved onto the
// hover-only legend is not "the member left the chart". The readout on screen is
// KEPT until the pointer goes somewhere else:
//   - back onto the chart: the next crosshair event takes the readout (`settle`);
//   - anywhere that is neither legend nor chart: nothing else would ever clear a
//     kept readout, so `leave` clears it after one beat.
//
// ⛔ NEVER FOR A PERSISTENT LEGEND. There the off-cursor readout is the latest bar,
// the legend stays mounted either way, and holding would freeze stale numbers.
// ⛔ A MOUSE (OR PEN) ONLY. A touch has no resting pointer: its enter and leave both
// fire inside one tap, so a hold armed by one could outlive the finger.
//
// No React and no DOM, so the whole decision runs in a plain unit test. The chart
// supplies what it knows through `env` and calls in at four moments.

/** One beat for the chart's own crosshair event to arrive (it is coalesced to an
 *  animation frame) before deciding the pointer went somewhere else. */
export const LEGEND_RELEASE_MS = 90

/**
 * @param {object} env
 * @param {() => boolean} env.isHoverOnly      is the legend hover-only right now?
 * @param {() => void}    env.clearReadout     give the readout back (off-cursor state)
 * @param {() => boolean} [env.crosshairPending] is a crosshair frame already queued?
 * @param {() => boolean} [env.legendHovered] is the pointer on the legend element right
 *   now, as the browser sees it? The enter/leave flag alone goes stale when the legend
 *   unmounts under the pointer (no leave is ever delivered), so this is the second witness.
 * @param {Function} [env.setTimer]  `setTimeout`, injectable for a test
 * @param {Function} [env.clearTimer] `clearTimeout`
 */
export function createLegendPointerHold(env) {
  const setTimer = env.setTimer || ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = env.clearTimer || ((id) => clearTimeout(id))
  let inside = false   // a mouse is inside the legend right now
  let holding = false  // a crosshair-clear was swallowed: the readout is being kept
  let timer = null

  const cancelTimer = () => { if (timer != null) { clearTimer(timer); timer = null } }

  return {
    /** The pointer entered the legend (`onPointerEnter`). */
    enter(e) {
      if (e && e.pointerType === 'touch') return
      inside = true
      cancelTimer()
    },
    /** The pointer left the legend (`onPointerLeave`). */
    leave() {
      inside = false
      if (!holding) return
      cancelTimer()
      timer = setTimer(() => {
        timer = null
        if (inside || !holding) return
        // A crosshair frame is already queued: its flush settles the readout either way.
        if (typeof env.crosshairPending === 'function' && env.crosshairPending()) return
        holding = false
        env.clearReadout()
      }, LEGEND_RELEASE_MS)
    },
    /** The crosshair just cleared. True = keep the readout; the caller must not clear it. */
    keepsReadout() {
      if (!inside || !env.isHoverOnly()) return false
      // ⛔ The flag says "inside"; the browser says the pointer is not on the legend. The
      // legend was unmounted under the pointer and no leave arrived: the flag is stale.
      if (typeof env.legendHovered === 'function' && !env.legendHovered()) { inside = false; return false }
      holding = true
      return true
    },
    /** The crosshair took the readout (a real hover on the chart): nothing is kept now. */
    settle() {
      holding = false
      cancelTimer()
    },
    /** Is the readout on screen being kept for the legend? Off-cursor refreshers stand down. */
    isHolding() { return holding },
    dispose() { cancelTimer() },
  }
}
