// Chart-load instrumentation: T0-T4 plus FRESHNESS, recorded together.
//
// ⛔⛔ THE WHOLE REASON THIS EXISTS IS THAT LATENCY ALONE LIES. `T2 = 180 ms` is not
// a success if the newest completed bar is three hours old — that combination is
// precisely the defect this project was opened to fix, and every metric the product
// already had (Server-Timing, SWR duration, the grid's onBarsReady) reports only the
// left-hand number. So this records the two together, per load, or not at all: there
// is deliberately no API that yields a latency without its freshness.
//
// ⭐ DEV/DIAGNOSTIC BY DEFAULT. Inert unless `localStorage['uct.chartTiming'] === '1'`,
// so production carries one boolean read per mark and emits no logging. Turn on with
// `window.__uctChartTiming.enable()`, read with `window.__uctChartTiming.report()`.
//
// ⚠️ NOT A REPLACEMENT FOR Server-Timing. That measures the ORIGIN's share; this
// measures what the member experiences end to end, which is the only number an
// acceptance run can be written against.

import { expectedLatestCompletedBar } from './marketSession'

const KEY = 'uct.chartTiming'
const MAX_LOADS = 200          // bounded — a scanning session must not grow unbounded

/** id -> {sym, tf, session, cache, t0, T1, T2, T3, T4, paint, historyEnd, tailEnd, formingAt}
 *
 * ⭐ PER SWITCH, NOT PER MOUNT. A scanning member never remounts the chart — they
 * change `sym` on a live component — so a metric latched once per mount measures
 * only the first symbol and reports `null` for every switch after it. That is how a
 * 0.5 s black frame between stocks stayed invisible to an instrument that claimed to
 * cover first paint. */
const _loads = new Map()
let _order = []

export function timingEnabled() {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1' }
  catch { return false }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** T0 — a (symbol, timeframe) selection begins. Returns the load id, or null when off. */
export function timingStart(sym, tf, { session = 'rth', cache = 'unknown' } = {}) {
  if (!timingEnabled() || !sym || !tf) return null
  const id = `${sym}_${tf}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  _loads.set(id, { id, sym, tf, session, cache, t0: now() })
  _order.push(id)
  // Bounded: drop oldest whole loads, never trim a load's own fields.
  while (_order.length > MAX_LOADS) _loads.delete(_order.shift())
  return id
}

/**
 * Record one phase.
 *   T1 stable history available · T2 first useful paint
 *   T3 authoritative session tail merged · T4 forming/live bar active
 * First write per phase wins — a later re-render must not restate T2.
 */
export function timingMark(id, phase, extra = {}) {
  if (!id) return
  const L = _loads.get(id)
  if (!L || L[phase] != null) return
  L[phase] = Math.round(now() - L.t0)
  Object.assign(L, extra)
}

/** The number that makes the latency honest. Seconds the newest bar is behind. */
export function freshnessLag(tailUnixSec, tf, nowMs = Date.now()) {
  const expected = expectedLatestCompletedBar(tf, nowMs)
  if (expected == null) return null                       // market shut → no expectation
  if (typeof tailUnixSec !== 'number' || !Number.isFinite(tailUnixSec)) return null
  return Math.max(0, Math.round(expected - tailUnixSec))
}

export function timingReport() {
  const rows = _order.map((id) => _loads.get(id)).filter(Boolean).map((L) => ({
    sym: L.sym,
    tf: L.tf,
    session: L.session,
    cache: L.cache,
    // ⭐ THE HEADLINE NUMBER: select → candles on the canvas. Everything else is
    // diagnosis; this is what a scanning member actually experiences.
    'T0→paint': L.paint ?? null,
    'T0→T1': L.T1 ?? null,
    'T0→T2': L.T2 ?? null,
    'T0→T3': L.T3 ?? null,
    'T0→T4': L.T4 ?? null,
    historyEnd: L.historyEnd ?? null,
    tailEnd: L.tailEnd ?? null,
    formingAt: L.formingAt ?? null,
    expectedLatest: expectedLatestCompletedBar(L.tf) ?? null,
    freshnessLagSec: freshnessLag(L.tailEnd ?? L.historyEnd, L.tf),
  }))
  return rows
}

export function timingClear() { _loads.clear(); _order = [] }

/**
 * p50 / p90 / p95 of one phase across recorded switches.
 * ⛔ One lucky switch is not a measurement; a scan is a DISTRIBUTION, so the
 * harness reports percentiles and never a single best case.
 */
export function timingPercentiles(phase = 'T0→paint') {
  const v = timingReport().map((r) => r[phase]).filter((x) => typeof x === 'number').sort((a, b) => a - b)
  if (!v.length) return null
  const at = (q) => v[Math.min(v.length - 1, Math.floor(q * v.length))]
  return { n: v.length, p50: at(0.5), p90: at(0.9), p95: at(0.95), max: v[v.length - 1] }
}

if (typeof window !== 'undefined') {
  window.__uctChartTiming = {
    enable() { try { localStorage.setItem(KEY, '1') } catch { /* ignore */ } },
    disable() { try { localStorage.removeItem(KEY) } catch { /* ignore */ } },
    report: timingReport,
    clear: timingClear,
    percentiles: timingPercentiles,
    // ⭐ The acceptance view: latency AND freshness in one table, never one alone.
    table() {
      try { console.table(timingReport()) } catch { /* ignore */ }
      return timingReport().length
    },
  }
}
