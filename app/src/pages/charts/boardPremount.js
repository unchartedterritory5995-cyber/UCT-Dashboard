// ⭐ BOARD PRE-MOUNT (2026-11-28, owner: spend client memory before any slowness). The first show of a board the member
// has not opened on this page is a MOUNT (cloud sweep 46123088210: 147 ms to a one-chart board, 285 ms to a three-widget
// one), while a return to a kept board is a flip (the layer keep-alive, #3052). So once the board in front is quiet, the
// workspace mounts the member's other dock boards HIDDEN, as kept boards (the same record a switch leaves behind), and a
// first show is a kept show.
//
// What this module decides (ChartsWorkspace.jsx does the mounting):
//   * WHICH boards: the dock's pins nearest-first in tab order from the active tab (right, left, then two right ...),
//     never the active one, never one already kept, at most the FREE kept slots (K minus the kept boards: a board the
//     member really visited is never evicted for a pre-mount; boardKeepAlive.js keptBoardLimit).
//   * WHEN: ONE board per step, each step only after QUIET_MS without a key or pointer press, with nothing of the board
//     in front still loading (no bars request in flight), in an idle callback; never while the page is hidden.
//   * BACK-OFF (owner, 500 members at the open): a 429 / 503 from the bars server within PRESSURE_WINDOW_MS defers the
//     next step, exponentially from PRESSURE_BACKOFF_MS up to PRESSURE_BACKOFF_MAX_MS (data/barStore/serverPressure.js).
// Switch: localStorage `uct.boardPremount` = '0' turns it off; on wherever the layer keep-alive is on.
export const BOARD_PREMOUNT_KEY = 'uct.boardPremount'
export const PREMOUNT_QUIET_MS = 1500
export const PREMOUNT_BUSY_RETRY_MS = 500
export const PRESSURE_WINDOW_MS = 60_000
export const PRESSURE_BACKOFF_MS = 10_000
export const PRESSURE_BACKOFF_MAX_MS = 5 * 60_000

export function boardPremountEnabled() {
  try { return globalThis.localStorage?.getItem(BOARD_PREMOUNT_KEY) !== '0' } catch { return true }
}

/** The dock's pins nearest-first from the active one (right, left, two right, two left ...), each id once, without the
 *  active id and without `skip` (already kept, or not a board a switch could open). */
export function premountOrder(pins, activeId, skip = () => false) {
  const ids = (Array.isArray(pins) ? pins : []).map(String)
  const at = activeId == null ? -1 : ids.indexOf(String(activeId))
  const order = []
  const seen = new Set(activeId == null ? [] : [String(activeId)])
  const take = (i) => {
    if (i < 0 || i >= ids.length) return
    const id = ids[i]
    if (seen.has(id)) return
    seen.add(id)
    if (!skip(id)) order.push(id)
  }
  if (at < 0) { for (let i = 0; i < ids.length; i++) take(i); return order }
  for (let d = 1; d < ids.length; d++) { take(at + d); take(at - d) }
  return order
}

/**
 * The pre-mount's clock. `step()` mounts ONE board and returns true, or false when nothing is left to do (the scheduler
 * then waits for `poke()`). `ready()` is false while the board in front is still loading (retried after
 * PREMOUNT_BUSY_RETRY_MS). `inflight()` counts the bars requests out; `pressureAge()` is msSincePressure().
 * Input (`noteInput`) restarts the quiet clock and cancels a pending step. Returns { noteInput, poke, stop, state }.
 */
export function createPremountScheduler({
  step, ready = () => true, inflight = () => 0, pressureAge = () => Infinity, pageHidden = () => false,
  idle = defaultIdle, setT = (fn, ms) => setTimeout(fn, ms), clearT = (t) => clearTimeout(t), now = () => Date.now(),
} = {}) {
  let timer = null
  let cancelIdle = null
  let stopped = false
  let lastInput = -Infinity
  let backoff = 0
  let done = false
  const st = { steps: 0, deferredPressure: 0, deferredBusy: 0, deferredInput: 0 }
  const clear = () => {
    if (timer != null) { clearT(timer); timer = null }
    if (cancelIdle) { cancelIdle(); cancelIdle = null }
  }
  const arm = (ms) => {
    clear()
    if (stopped || done) return
    timer = setT(() => { timer = null; check() }, Math.max(0, ms))
  }
  const check = () => {
    if (stopped || done) return
    const quietLeft = lastInput + PREMOUNT_QUIET_MS - now()
    if (quietLeft > 0) { st.deferredInput++; arm(quietLeft); return }
    if (pageHidden()) { arm(PREMOUNT_QUIET_MS); return }
    if (pressureAge() < PRESSURE_WINDOW_MS) {
      backoff = backoff ? Math.min(backoff * 2, PRESSURE_BACKOFF_MAX_MS) : PRESSURE_BACKOFF_MS
      st.deferredPressure++
      arm(backoff)
      return
    }
    backoff = 0
    if (!ready() || inflight() > 0) { st.deferredBusy++; arm(PREMOUNT_BUSY_RETRY_MS); return }
    cancelIdle = idle(() => {
      cancelIdle = null
      if (stopped || done) return
      // the idle callback can come after a press: the quiet rule is asked again at the moment of the step
      if (lastInput + PREMOUNT_QUIET_MS > now()) { arm(lastInput + PREMOUNT_QUIET_MS - now()); return }
      const did = step()
      if (did) { st.steps++; arm(PREMOUNT_QUIET_MS) } else done = true
    })
  }
  arm(PREMOUNT_QUIET_MS)
  return {
    noteInput() { lastInput = now(); if (!done && !stopped && cancelIdle) { cancelIdle(); cancelIdle = null; arm(PREMOUNT_QUIET_MS) } },
    poke() { if (stopped) return; done = false; if (timer == null && !cancelIdle) arm(PREMOUNT_QUIET_MS) },
    stop() { stopped = true; clear() },
    state() { return { ...st, backoff, done } },
  }
}

function defaultIdle(fn) {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(fn, { timeout: 2000 })
    return () => { try { cancelIdleCallback(id) } catch { /* gone */ } }
  }
  const t = setTimeout(fn, 0)
  return () => clearTimeout(t)
}
