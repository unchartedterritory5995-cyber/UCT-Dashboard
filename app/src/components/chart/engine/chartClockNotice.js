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
// list — so one pane's sentence does not appear on another's. Two panes that
// share an instance id (a layout copied from one seed) and sit on different
// timeframes share the entry: the last binder to sync wins. Stated, not solved.

/** `${instanceId}\u0000${lane}` → `[{code, reason}]` (non-empty lists only). */
const notes = new Map()
const listeners = new Set()

const emit = () => { for (const fn of [...listeners]) { try { fn() } catch { /* a bad listener is not the store's problem */ } } }
const keyOf = (instanceId, lane) => `${instanceId}\u0000${lane}`
const sigOf = (list) => list.map((n) => `${n.code}\u0001${n.reason}`).join('\u0002')

/** Record what ONE lane (`'plots'` | `'objects'`) of one instance withholds, and
 *  why. An empty or absent list clears it. Emits only on a real change. */
export function setChartClockNotes(instanceId, lane, list) {
  if (!instanceId) return
  const key = keyOf(instanceId, lane)
  const next = (Array.isArray(list) ? list : [])
    .filter((n) => n && typeof n.code === 'string' && typeof n.reason === 'string')
    .map((n) => ({ code: n.code, reason: n.reason }))
  const had = notes.get(key)
  if (!next.length) {
    if (had) { notes.delete(key); emit() }
    return
  }
  if (had && sigOf(had) === sigOf(next)) return
  notes.set(key, next)
  emit()
}

/** Every reason the given instances carry, deduped by code + sentence, in the
 *  order the instances were given. */
export function chartClockNotesFor(instanceIds) {
  const out = []
  const seen = new Set()
  for (const id of instanceIds || []) {
    for (const lane of ['plots', 'objects']) {
      for (const n of notes.get(keyOf(id, lane)) || []) {
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
