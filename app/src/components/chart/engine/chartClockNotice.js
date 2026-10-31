// app/src/components/chart/engine/chartClockNotice.js
//
// ─── ⭐ C36 — "THIS INDICATOR'S `time(<timeframe>)` IS WITHHELD ON THIS CHART" ──
//
// `interpret.js::periodAnchorMask` withholds every bar of a tree that reads
// `time("W" / "M" / "3M" / "12M")` on a chart that is not daily (or whose daily
// bars include a weekend), and of `time(timeframe.period)` / `time("60")` on a
// chart timeframe no capture measured. Until this file that was SILENT: a member
// who switched a chart to 60 minutes saw the indicator's lines vanish and nothing
// said why.
//
// The decision is a BIND-TIME fact — a property of (document, chart timeframe,
// the bars in hand), not of the saved document — so it cannot ride on
// `meta.disclosures`. The binder computes the columns and the objects; the
// disclosure strip (`AttachedPineDisclosures`) is a different React subtree. So,
// exactly like `paneFitNotice.js`, this is a small store between the two.
//
// ⛔ NOT A SECOND AUTHORITY OVER THE SENTENCE. What is published here is the list
// `periodAnchorMask` itself wrote (`nativeRegistry.chartClockReport`, the object
// reader's `chartClock`); the words are `interpret.js::CHART_CLOCK_WITHHELD`'s.
//
// ⛔ SESSION STATE, NOT PERSISTED — a chart's timeframe is not a document property.
//
// ⚠️ KEYED BY INSTANCE, and the strip reads only the instances ITS OWN settings
// list — so one pane's sentence does not appear on another's.
// ⚰️ This said two panes sharing an instance id (a layout copied from one seed) on
// different timeframes "share the entry: the last binder to sync wins. Stated, not
// solved." Solved now, by the scope below.
//
// ⭐⭐ SCOPED BY BINDER, THEN BY INSTANCE. One instance id can be drawn by several
// binders at once — a multi-chart grid cell, a seeded workspace widget, a popup —
// on different symbols and timeframes, so an instance-only key let chart A's note
// show in chart B's strip, and B's prune clear A's note. Every entry now lives
// under its binder's `scope` (`createBinder({scope})`, which `StockChart` gives a
// stable per-chart id and `ChartPane` hands the same id to its strip), and every
// read names the scope it reads. An absent scope is `''`, its own scope, so a
// binder and a strip that name none still meet, and nothing else.

/** scope → `${instanceId}\u0000${lane}` → `[{code, reason}]` (non-empty lists only). */
const notes = new Map()
const scoped = (scope) => notes.get(scope || '') || null
const listeners = new Set()

const emit = () => { for (const fn of [...listeners]) { try { fn() } catch { /* a bad listener is not the store's problem */ } } }
const keyOf = (instanceId, lane) => `${instanceId}\u0000${lane}`
const sigOf = (list) => list.map((n) => `${n.code}\u0001${n.reason}`).join('\u0002')

/** Record what ONE lane (`'plots'` | `'objects'`) of one instance withholds, and
 *  why. An empty or absent list clears it. Emits only on a real change. */
export function setChartClockNotes(instanceId, lane, list, scope = '') {
  if (!instanceId) return
  const key = keyOf(instanceId, lane)
  const next = (Array.isArray(list) ? list : [])
    .filter((n) => n && typeof n.code === 'string' && typeof n.reason === 'string')
    .map((n) => ({ code: n.code, reason: n.reason }))
  const own = scoped(scope)
  const had = own ? own.get(key) : undefined
  if (!next.length) {
    if (had) {
      own.delete(key)
      if (!own.size) notes.delete(scope || '')
      emit()
    }
    return
  }
  if (had && sigOf(had) === sigOf(next)) return
  if (own) own.set(key, next)
  else notes.set(scope || '', new Map([[key, next]]))
  emit()
}

/** Every reason the given instances carry IN ONE BINDER'S SCOPE, deduped by code +
 *  sentence, in the order the instances were given. */
export function chartClockNotesFor(instanceIds, scope = '') {
  const out = []
  const seen = new Set()
  const own = scoped(scope)
  if (!own) return out
  for (const id of instanceIds || []) {
    for (const lane of ['plots', 'objects']) {
      for (const n of own.get(keyOf(id, lane)) || []) {
        const k = `${n.code}\u0001${n.reason}`
        if (seen.has(k)) continue
        seen.add(k)
        out.push(n)
      }
    }
  }
  return out
}

/** ⭐ Subscribe; returns the unsubscribe. */
export function onChartClockChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** ⛔ TEST SEAM — module state that survives between cases is a test that passes
 *  because of the one before it. */
export function resetChartClockNotes() { notes.clear(); listeners.clear() }
