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
//
// ⭐⭐ SCOPED BY BINDER, THEN BY INSTANCE. One instance id can be drawn by several
// binders at once — a multi-chart grid cell, a seeded workspace widget, a popup —
// on different symbols and timeframes, so an instance-only key let chart A's note
// show in chart B's strip, and B's prune clear A's note. Every entry now lives
// under its binder's `scope` (`createBinder({scope})`, which `StockChart` gives a
// stable per-chart id and `ChartPane` hands the same id to its strip), and every
// read names the scope it reads. An absent scope is `''`, its own scope, so a
// binder and a strip that name none still meet, and nothing else.

/** scope → instanceId → sentence. */
const notices = new Map()
const scoped = (scope) => notices.get(scope || '') || null
const listeners = new Set()

const emit = () => { for (const fn of [...listeners]) { try { fn() } catch { /* a bad listener is not the store's problem */ } } }

/** Record (or clear, with a falsy sentence) THIS instance's stop. */
export function setRuntimeErrorNotice(instanceId, sentence, scope = '') {
  if (!instanceId) return
  const next = typeof sentence === 'string' && sentence ? sentence : null
  const own = scoped(scope)
  const had = own && own.has(instanceId) ? own.get(instanceId) : null
  if (had === next) return
  if (next === null) {
    own.delete(instanceId)
    if (!own.size) notices.delete(scope || '')
  } else if (own) own.set(instanceId, next)
  else notices.set(scope || '', new Map([[instanceId, next]]))
  emit()
}

/** The sentence for one instance in one binder's scope, or null. */
export function runtimeErrorNoticeFor(instanceId, scope = '') {
  const own = scoped(scope)
  return own && own.has(instanceId) ? own.get(instanceId) : null
}

/** Every instance currently stopped in one binder's scope: `[instanceId, sentence]`
 *  pairs, a copy. */
export function runtimeErrorNotices(scope = '') {
  const own = scoped(scope)
  return own ? [...own.entries()] : []
}

/** ⭐ Subscribe; returns the unsubscribe. */
export function onRuntimeErrorNoticeChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** ⛔ TEST SEAM — module state that survives between cases is a test that passes
 *  because of the one before it. */
export function resetRuntimeErrorNotices() { notices.clear(); listeners.clear() }
