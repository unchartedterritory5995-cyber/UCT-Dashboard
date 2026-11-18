// app/src/components/chart/engine/strategyReportNotice.js
//
// ─── W9-T13b — THE RUN'S STRATEGY RECORD, FROM THE BINDER TO THE REPORT PANEL ──
//
// The binder computes a runtime document's columns; a strategy's run carries its `strategy`
// record beside them (`runtime/strategyRecord.js::runtimeStrategyOf`, non-enumerable). The
// report panel (`pane/AttachedStrategyReports.jsx`) is a different React subtree, so, exactly
// like `runtimeErrorNotice.js`, this is a small session store between the two.
//
// ⛔ NOT A SECOND AUTHORITY. What is held is the record object the run produced, untouched;
// the report is computed from it by `runtime/brokerReport.js::strategyReportOf` at render.
// ⛔ SESSION STATE, NOT PERSISTED: a record is a property of (document, chart, bars).
// ⭐ SCOPED BY BINDER, THEN BY INSTANCE, for the reason `chartClockNotice.js` records: one
// instance id can be drawn by several binders on different symbols and timeframes.
//
// ⛔ DARK. Nothing reads this while `VITE_PINE_STRATEGY_BROKER_ENABLED` is off: the panel
// returns null before it reads, and with the flag off no strategy is drawn bar by bar, so no
// run carries a record to publish (`memberPaneDefinition.js`, W9-T11).

/** scope → instanceId → record. */
const records = new Map()
const scoped = (scope) => records.get(scope || '') || null
const listeners = new Set()

const emit = () => { for (const fn of [...listeners]) { try { fn() } catch { /* a bad listener is not the store's problem */ } } }

/** Record (or clear, with a falsy record) THIS instance's strategy record. Emits only on change. */
export function setStrategyRecord(instanceId, record, scope = '') {
  if (!instanceId) return
  const next = record && typeof record === 'object' ? record : null
  const own = scoped(scope)
  const had = own && own.has(instanceId) ? own.get(instanceId) : null
  if (had === next) return
  if (next === null) {
    own.delete(instanceId)
    if (!own.size) records.delete(scope || '')
  } else if (own) own.set(instanceId, next)
  else records.set(scope || '', new Map([[instanceId, next]]))
  emit()
}

/** The record for one instance in one binder's scope, or null. */
export function strategyRecordFor(instanceId, scope = '') {
  const own = scoped(scope)
  return own && own.has(instanceId) ? own.get(instanceId) : null
}

/** ⭐ Subscribe; returns the unsubscribe. */
export function onStrategyRecordChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** ⛔ TEST SEAM. */
export function resetStrategyRecords() { records.clear(); listeners.clear() }
