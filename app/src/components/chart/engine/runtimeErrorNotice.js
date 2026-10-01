// app/src/components/chart/engine/runtimeErrorNotice.js
//
// ─── ⭐ C43 — "THIS SCRIPT STOPPED ITSELF" HAS TO CROSS ONE SUBTREE ──────────────
//
// The binder learns, when it computes an instance's columns, that the script's
// own `runtime.error` was reached on this chart (`runtimeErrorStop.js`); the
// disclosure strip (`AttachedPineDisclosures`) is the surface that tells a
// member. They are different React subtrees, and the condition is a property of
// THIS chart's bars and THIS instance's settings — not of the saved document —
// so it cannot ride on `meta.disclosures`. Same shape as `paneFitNotice.js`.
//
// ⛔ A ONE-VALUE STORE, NOT A SECOND AUTHORITY OVER THE SENTENCE. What is held
// here is the sentence `runtimeErrorStop.js` built (TradingView's wording with
// the script's own message); this module never words anything.
//
// ⛔ SESSION STATE, NEVER PERSISTED: another symbol, another timeframe or another
// setting may not reach the error at all.

const notices = new Map()
const listeners = new Set()

const emit = () => { for (const fn of [...listeners]) { try { fn() } catch { /* a bad listener is not the store's problem */ } } }

/** Record (or clear, with a falsy sentence) THIS instance's stop. */
export function setRuntimeErrorNotice(instanceId, sentence) {
  if (!instanceId) return
  const next = typeof sentence === 'string' && sentence ? sentence : null
  const had = notices.has(instanceId) ? notices.get(instanceId) : null
  if (had === next) return
  if (next === null) notices.delete(instanceId)
  else notices.set(instanceId, next)
  emit()
}

/** The sentence for one instance, or null. */
export function runtimeErrorNoticeFor(instanceId) {
  return notices.has(instanceId) ? notices.get(instanceId) : null
}

/** Every instance currently stopped: `[instanceId, sentence]` pairs, a copy. */
export function runtimeErrorNotices() { return [...notices.entries()] }

/** ⭐ Subscribe; returns the unsubscribe. */
export function onRuntimeErrorNoticeChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** ⛔ TEST SEAM — module state that survives between cases is a test that passes
 *  because of the one before it. */
export function resetRuntimeErrorNotices() { notices.clear(); listeners.clear() }
