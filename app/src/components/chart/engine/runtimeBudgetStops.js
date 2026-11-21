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

const stops = new Map()       // the lane's key -> { defId, err }
let generation = 0            // bumped by every Retry (and reset): a remembered stop of an older generation is dropped
const listeners = new Set()

const tell = (retried) => {
  for (const fn of [...listeners]) { try { fn(retried) } catch { /* a bad listener must not break the strip */ } }
}

/** Remember a time-budget stop under the lane's key, for a document id. */
export function rememberRuntimeBudgetStop(key, defId, err) {
  stops.set(key, { defId: typeof defId === 'string' ? defId : null, err })
  tell(false)
}

/** The stop remembered under this key, or null. */
export function runtimeBudgetStopAt(key) {
  return stops.has(key) ? stops.get(key) : null
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

/** Test seam (and the lane's session reset): forget every stop. */
export function resetRuntimeBudgetStops() {
  stops.clear()
  generation += 1
}
