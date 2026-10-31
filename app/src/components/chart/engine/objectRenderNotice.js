// app/src/components/chart/engine/objectRenderNotice.js
//
// ─── ⭐⭐ P2b — DRAWINGS THE PROGRAM HOLDS AND THIS CHART COULD NOT PLACE ────────
//
// The member's partial-drawing note (`ast/objectLoss.js::objectLossNote`) counts
// what the TRANSLATION lost. A second stage can lose a drawing after it: the render
// state (`objectRenderState.js::toRenderState`) drops an object whose coordinate
// names no bar on this chart, or whose text the run withheld, and counts it in
// `state.dropped`. ⚰️ That count went only to the object layer's DOM attributes
// (`binder.js`, `meta.stats.dropped`), which no member reads — so a translation
// could report "clean" while the chart drew less than the program held, and the
// member saw nothing at all where the script draws (poor-man's volume profile's two
// lines, before `timeAtInstant` placed an instant inside a bar).
//
// The count is a BIND-TIME fact — it depends on this chart's bars and timeframe —
// so, like `chartClockNotice.js` and `runtimeErrorNotice.js`, it is a small store
// between the binder (which renders) and the disclosure strip
// (`AttachedPineDisclosures`), which folds it into the drawing note
// (`objectLoss.js::withRenderDrops`): one note, one count.
//
// ⛔ SESSION STATE, NOT PERSISTED. Keyed by instance; a zero count clears.
//
// ⭐⭐ SCOPED BY BINDER, THEN BY INSTANCE. One instance id can be drawn by several
// binders at once — a multi-chart grid cell, a seeded workspace widget, a popup —
// on different symbols and timeframes, so an instance-only key let chart A's note
// show in chart B's strip, and B's prune clear A's note. Every entry now lives
// under its binder's `scope` (`createBinder({scope})`, which `StockChart` gives a
// stable per-chart id and `ChartPane` hands the same id to its strip), and every
// read names the scope it reads. An absent scope is `''`, its own scope, so a
// binder and a strip that name none still meet, and nothing else.

/** scope → instanceId → `{dropped, held}` (only `dropped > 0` is kept). */
const drops = new Map()
const scoped = (scope) => drops.get(scope || '') || null
const listeners = new Set()

const emit = () => { for (const fn of [...listeners]) { try { fn() } catch { /* a bad listener is not the store's problem */ } } }

/** Record (or clear, with a zero count) what ONE instance's render state dropped
 *  out of the objects its program held on the last bar. Emits only on a change. */
export function setObjectRenderDrops(instanceId, dropped, held, scope = '') {
  if (!instanceId) return
  const d = Number.isInteger(dropped) && dropped > 0 ? dropped : 0
  const h = Number.isInteger(held) && held >= d ? held : d
  const own = scoped(scope)
  const had = own ? own.get(instanceId) : undefined
  if (!d) {
    if (had) {
      own.delete(instanceId)
      if (!own.size) drops.delete(scope || '')
      emit()
    }
    return
  }
  if (had && had.dropped === d && had.held === h) return
  if (own) own.set(instanceId, { dropped: d, held: h })
  else drops.set(scope || '', new Map([[instanceId, { dropped: d, held: h }]]))
  emit()
}

/** `{dropped, held}` for one instance in one binder's scope, or null. */
export function objectRenderDropsFor(instanceId, scope = '') {
  const own = scoped(scope)
  return own && own.has(instanceId) ? { ...own.get(instanceId) } : null
}

/** ⭐ Subscribe; returns the unsubscribe. */
export function onObjectRenderDropsChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** What a render state dropped that TradingView draws (`state.unplaced`: a finite
 *  coordinate no bar here can place, or a text the run withheld), over every family.
 *  ⛔ NOT `state.dropped`, which also counts an object whose coordinate is `na` —
 *  TradingView draws nothing there either, so saying "not drawn" would be untrue. */
export function renderDroppedCount(state) {
  const d = (state && state.unplaced) || {}
  return Object.values(d).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)
}

/** ⛔ TEST SEAM — module state that survives between cases is a test that passes
 *  because of the one before it. */
export function resetObjectRenderDrops() { drops.clear(); listeners.clear() }

/** What a render state was handed: everything it drew plus everything it dropped
 *  (lines, labels, boxes, fills, table cells). The denominator of the sentence. */
export function renderHeldCount(state) {
  if (!state) return 0
  const cells = (state.tables || []).reduce((a, t) => a + ((t && t.cells) || []).length, 0)
  return (state.lines || []).length + (state.labels || []).length + (state.boxes || []).length
    + (state.fills || []).length + cells + renderDroppedCount(state)
}
