/**
 * flow.worker.js — parses and aggregates the Options Flow CSV off the main thread.
 *
 * On the main thread this measured, on production, ~500ms to parse 96,178 rows
 * and ~1,400ms to aggregate them: ~1.9 SECONDS of completely frozen UI on every
 * visit. None of it needs the DOM, so none of it belongs on the UI thread.
 *
 * ⚠️ THE ROWS STAY IN HERE. Handing 96,178 row objects back to the main thread
 * costs ~1,027ms of structured clone (measured) — which would give most of the
 * win straight back. So the worker OWNS the parsed rows and the main thread only
 * ever receives the aggregate (`D`), the distinct dates, and a row count. Every
 * operation that needs raw rows (date re-filter, per-ticker search, splicing in
 * today's delta) is a message to the worker instead.
 *
 * It imports the SAME flowCompute module the page does, so there is no second
 * copy of the classification logic to drift.
 *
 * Protocol — every message is correlated by `id`, because switching ranges
 * quickly can leave more than one job in flight and a late reply for an
 * abandoned range must be discardable:
 *
 *   { id, type:'load',   csv }                  -> { id, ok, rowCount, availableDates, timing }
 *   { id, type:'process', erSoon, filter, view } -> { id, ok, D, tabCharts, filteredCount, timing }
 *
 * `view` is { dataMode, capFilter, etfExtra[] } and is OPTIONAL. When present the
 * worker also returns `tabCharts` — the Stocks/Indexes + cap-band filtered charts
 * the page otherwise rebuilds on the MAIN THREAD (measured at 989ms per change).
 * `etfExtra` is the page's fetched remoteETFSet, so both sides classify alike.
 *   { id, type:'merge',  csv }                  -> { id, ok, rowCount, availableDates, timing }
 *
 *   { id, type:'ticker', sym, erSoon }          -> { id, ok, D }
 *   { id, type:'compute', csv, erSoon }         -> { id, ok, D, rowCount }   // one-shot, does NOT store
 *   { id, type:'rows' }                         -> { id, ok, rows }   // escape hatch
 *   any failure                                 -> { id, ok:false, error }
 *
 * 'load' and 'merge' deliberately do NOT aggregate — that is 'process's job.
 * Having both aggregate would recreate the duplicate pass this exists to remove.
 *
 * `filter` is { dateFilter, dateFrom, dateTo }.
 */
import {
  parseCSV,
  processFlowData,
  availableDatesFrom,
  filterRowsByDate,
  buildCharts,
  filterByCap,
  isETFSymbol,
} from './flowCompute'

let ROWS = null           // the parsed dataset — never leaves unless asked
let DATES = []
// WHICH dataset ROWS actually is (the range/mode URL). Without this the worker
// will happily aggregate the previous mode's rows for a request that expects the
// new one, and the page paints stocks numbers under the INDEX header.
let DATASET_KEY = null
// Memoised last aggregate. Same rows + same filter + same ER set is the same
// answer, and recomputing it costs ~1.9s — which is what a re-entry was paying
// to arrive at a byte-identical result. Invalidated whenever ROWS changes.
let CACHE = null          // { key, D, filteredCount }

const toSet = (erSoon) => (erSoon && erSoon.length ? new Set(erSoon) : null)

/**
 * The Stocks/Indexes + cap-band charts the page's `FD` memo otherwise rebuilds on
 * the main thread. Mirrors that memo exactly, including the order of operations:
 * tab filter first, then cap band, then buildCharts.
 */
function viewCharts(D, view) {
  if (!view || !D || !D.clean_confirmed) return null
  const { dataMode, capFilter, etfExtra } = view
  const needsTabFilter = dataMode === 'stocks' || dataMode === 'index'
  if (capFilter === 'All' && !needsTabFilter) return null   // page short-circuits to D
  const extra = etfExtra && etfExtra.length ? new Set(etfExtra) : null
  const isEtf = (sym, stocketf) =>
    isETFSymbol(sym, stocketf) || !!(extra && extra.has(String(sym || '').toUpperCase()))
  const t0 = performance.now()
  let cc = D.clean_confirmed
  if (needsTabFilter) {
    cc = cc.filter(t => (dataMode === 'stocks' ? !isEtf(t.S, t.stocketf) : isEtf(t.S, t.stocketf)))
  }
  if (capFilter !== 'All') cc = filterByCap(cc, capFilter)
  return { charts: buildCharts(cc), count: cc.length, ms: performance.now() - t0 }
}

function aggregate(filter, erSoon) {
  // Key on the ER set's CONTENT, not its length: two different sets of equal
  // size are not the same answer, and a cache key should not rely on erSoonSet
  // happening to be resolved only once per session.
  const key = JSON.stringify([
    filter && filter.dateFilter, filter && filter.dateFrom, filter && filter.dateTo,
    ROWS ? ROWS.length : 0,
    erSoon ? erSoon.slice().sort().join(',') : null,
  ])
  // NOTE: the view (dataMode/capFilter/etfExtra) is deliberately NOT part of this
  // key — this cache holds the AGGREGATE only. viewCharts runs per request off
  // agg.D, so a cap change still gets freshly-filtered charts from a cached D.
  if (CACHE && CACHE.key === key) {
    return { D: CACHE.D, filteredCount: CACHE.filteredCount, ms: 0, cached: true }
  }
  const t0 = performance.now()
  const filtered = filterRowsByDate(ROWS, { ...filter, availableDates: DATES })
  // The page renders an empty state for this; null is the same signal it used
  // when it did the filtering itself.
  const D = filtered.length === 0 ? null : processFlowData(filtered, toSet(erSoon))
  CACHE = { key, D, filteredCount: filtered.length }
  return { D, filteredCount: filtered.length, ms: performance.now() - t0 }
}

self.onmessage = (e) => {
  const msg = e.data || {}
  const { id, type } = msg
  try {
    if (type === 'load' || type === 'merge') {
      const t0 = performance.now()
      const incoming = parseCSV(msg.csv)
      const parseMs = performance.now() - t0

      if (type === 'load') {
        if (!incoming || incoming.length === 0) {
          self.postMessage({ id, ok: false, error: 'CSV parsed but contained 0 valid rows. Check file format.' })
          return
        }
        ROWS = incoming
        CACHE = null
        DATASET_KEY = msg.key ?? null
      } else {
        // Delta merge: replace every row whose date appears in the delta.
        if (!ROWS || !ROWS.length || !incoming || !incoming.length) {
          self.postMessage({ id, ok: false, error: 'no base rows to merge into' })
          return
        }
        // Refuse to splice today's delta into a dataset it does not belong to.
        if (msg.expectKey != null && DATASET_KEY !== msg.expectKey) {
          self.postMessage({ id, ok: false, staleDataset: true, error: 'dataset changed' })
          return
        }
        const days = new Set(incoming.map(r => (r.date || '').trim()).filter(Boolean))
        if (!days.size) { self.postMessage({ id, ok: false, error: 'delta had no dates' }); return }
        ROWS = ROWS.filter(r => !days.has((r.date || '').trim())).concat(incoming)
        CACHE = null
      }

      DATES = availableDatesFrom(ROWS)
      // Deliberately does NOT aggregate. The page's processing effect owns
      // aggregation and reacts to rowCount/filter changes; having 'load'
      // aggregate too would reproduce the exact duplicate pass this whole
      // exercise exists to remove.
      self.postMessage({
        id, ok: true, rowCount: ROWS.length, availableDates: DATES,
        timing: { parse: parseMs },
      })
      return
    }

    if (type === 'process') {
      if (!ROWS) { self.postMessage({ id, ok: false, error: 'no rows loaded' }); return }
      // The caller says which dataset it expects. If we are holding a different
      // one (mode switch mid-flight, abandoned range), say so rather than
      // aggregating the wrong feed under the caller's header.
      if (msg.expectKey != null && DATASET_KEY !== msg.expectKey) {
        self.postMessage({ id, ok: false, staleDataset: true, error: 'dataset changed' })
        return
      }
      const agg = aggregate(msg.filter || {}, msg.erSoon)
      const tab = agg.D ? viewCharts(agg.D, msg.view) : null
      self.postMessage({
        id, ok: true, D: agg.D, tabCharts: tab && tab.charts,
        tabCount: tab && tab.count,
        filteredCount: agg.filteredCount,
        timing: { process: agg.ms, view: tab ? tab.ms : 0 },
      })
      return
    }

    if (type === 'ticker') {
      if (!ROWS) { self.postMessage({ id, ok: false, error: 'no rows loaded' }); return }
      const sym = String(msg.sym || '').toUpperCase().trim()
      const rows = ROWS.filter(r => (r.ticker || '').toUpperCase().trim() === sym)
      self.postMessage({ id, ok: true, D: rows.length ? processFlowData(rows, toSet(msg.erSoon)) : null, rowCount: rows.length })
      return
    }

    if (type === 'compute') {
      // One-shot: parse + aggregate a CSV the page already has, WITHOUT touching
      // the stored dataset. Used by the Search drill-in, whose per-ticker feed
      // deliberately contains history the loaded range does not.
      const rows = parseCSV(msg.csv)
      self.postMessage({
        id, ok: true,
        D: rows && rows.length ? processFlowData(rows, toSet(msg.erSoon)) : null,
        rowCount: rows ? rows.length : 0,
      })
      return
    }

    if (type === 'rows') {
      self.postMessage({ id, ok: true, rows: ROWS || [] })
      return
    }

    self.postMessage({ id, ok: false, error: `unknown message type: ${type}` })
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err && err.message) || String(err) })
  }
}
