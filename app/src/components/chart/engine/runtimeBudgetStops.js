// app/src/components/chart/engine/runtimeBudgetStops.js
//
// ⭐⭐ (engine 86) — THE TIME-BUDGET STOPS THIS PAGE REMEMBERS, and the strip's Retry.
//
// The runtime lane (`runtime/runtimeColumns.js::runtimeColumnsFor`) remembers a run stopped by the time budget per
// document, symbol, timeframe, settings and history fact, so a live chart's next bars are not run cold again only
// to be stopped again (each update burned the whole budget and drew nothing). The strip
// (`pane/AttachedPineDisclosures.jsx`) offers Retry, which forgets a document's stops and repaints.
// ⛔ A SMALL STORE OF ITS OWN, so the strip (main bundle) never imports the runtime lane (its own chunk).
// ⛔ NEVER PERSISTED: page memory only. A reload, another setting or symbol (another key), or Retry runs it again,
// so a stop that came from a busy machine is never permanent.
//
// ⭐⭐ (e102, coordinator ruling 2026-11-27, option B) — A REMEMBERED STOP IS NOT FINAL. A stop is a wall-clock
// answer: the same picture asked a little later, on a quieter machine, may well fit. So the lane's ask
// (`askRuntimeBudgetStop`) honours a remembered stop only
//   * for `RUNTIME_BUDGET_STOP_HOLD_MS` (20 s) after it was made: within that, the live chart's next bars of the same
//     picture are not run again (the engine 86 behaviour, which it keeps);
//   * and while the pane keeps asking for THAT picture: a pane that asked the same document for another picture (1W ->
//     1D) and comes back (-> 1W) has the stop asked again at once;
// and after either, the stop is forgotten and the picture is run again, at most `RUNTIME_BUDGET_STOP_REASKS` (2) times
// per key per page: past that cap the stop is honoured until Retry or a reload, so a script that is simply too heavy
// for this device never costs the page more than 2 more budgets. Retry is the member's own and is never capped.
// Wall-clock policy only: what a run computes is unchanged.

/** How long a remembered stop is honoured before the same picture is asked again (ms). */
export const RUNTIME_BUDGET_STOP_HOLD_MS = 20000
/** How many times this page asks a stopped picture again by itself (after the hold, or on a return). */
export const RUNTIME_BUDGET_STOP_REASKS = 2

const stops = new Map()       // the lane's key -> { defId, err, at }
const reasks = new Map()      // the lane's key -> the re-asks this page has spent on it (kept past a release)
const lastAsked = new Map()   // a document id -> the key the lane last asked for it (a different one, then this: a return)
let generation = 0            // bumped by every Retry (and reset): a remembered stop of an older generation is dropped
const listeners = new Set()
const now = () => Date.now()

const tell = (retried) => {
  for (const fn of [...listeners]) { try { fn(retried) } catch { /* a bad listener must not break the strip */ } }
}

/** Remember a time-budget stop under the lane's key, for a document id. */
export function rememberRuntimeBudgetStop(key, defId, err) {
  stops.set(key, { defId: typeof defId === 'string' ? defId : null, err, at: now() })
  tell(false)
}

/** The stop remembered under this key, or null. A read: it neither releases nor counts (the strip, the tests). */
export function runtimeBudgetStopAt(key) {
  return stops.has(key) ? stops.get(key) : null
}

/** ⭐⭐ (e102, option B) THE LANE'S ASK, once per `runtimeColumnsFor` call: the stop to answer for `key`, or null when
 *  there is none or it is released now (its hold passed, or the pane returned to this picture from another one, and
 *  the page has re-asked it fewer than `RUNTIME_BUDGET_STOP_REASKS` times). A release forgets the stop and counts. */
export function askRuntimeBudgetStop(key, defId) {
  const id = typeof defId === 'string' && defId ? defId : null
  const returned = id !== null && lastAsked.has(id) && lastAsked.get(id) !== key
  if (id !== null) lastAsked.set(id, key)
  const s = stops.get(key)
  if (!s) return null
  const spent = reasks.get(key) || 0
  if (spent >= RUNTIME_BUDGET_STOP_REASKS) return s
  if (!returned && now() - s.at < RUNTIME_BUDGET_STOP_HOLD_MS) return s
  stops.delete(key)
  reasks.set(key, spent + 1)
  tell(false)
  return null
}

/** Is a stop remembered for this document, or for its run half (`<id>~run`)? */
export function runtimeBudgetStoppedFor(defId) {
  if (typeof defId !== 'string' || !defId) return false
  for (const v of stops.values()) if (v.defId === defId || v.defId === `${defId}~run`) return true
  return false
}

/** Retry: forget this document's stops (its run half's too; every stop with no id) and tell the lane to repaint. */
export function retryRuntimeBudgetStops(defId) {
  let any = false
  for (const [k, v] of [...stops]) {
    if (defId === undefined || v.defId === defId || v.defId === `${defId}~run`) { stops.delete(k); any = true }
  }
  if (!any) return false
  generation += 1
  tell(true)
  return true
}

/** The Retry generation: a stop the lane memoised under an older one is not answered again. */
export function runtimeBudgetGeneration() { return generation }

/** Told on every change; `retried` is true when a Retry forgot stops (the lane repaints then). */
export function onRuntimeBudgetStopsChange(fn) {
  if (typeof fn !== 'function') return () => {}
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Test seam (and the lane's session reset): forget every stop, every re-ask spent and every last ask. */
export function resetRuntimeBudgetStops() {
  stops.clear()
  reasks.clear()
  lastAsked.clear()
  generation += 1
}
