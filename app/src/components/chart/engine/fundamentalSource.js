// app/src/components/chart/engine/fundamentalSource.js
//
// ─── `fund:` — A HISTORICAL FUNDAMENTAL AS A CHART SOURCE ───────────────────
//
// ⭐⭐ A FOURTH SOURCE FAMILY, BESIDE bar / symbol / instance, AND NOTHING ELSE
// CHANGES. `parseSource` answers `{kind:'fundamental', symbol, metric}`; the
// binder resolves it into an ordinary numeric column; `dataSeries`, panes,
// legends, styles, Moving Average and persistence never learn it exists.
//
//   fund:<metric>            the metric OF THE CHARTED SYMBOL — it follows the
//                            chart like a bar field does (Net Margin on AAPL,
//                            then NVDA after a symbol change)
//   fund:<SYMBOL>:<metric>   pinned to one symbol (a comparison)
//
// ⛔⛔ THE JOIN IS AS-OF, NEVER EXACT-t. A fundamental is a DISCLOSURE that holds
// from the moment it became public until the next one (`fundamentalAsOf.js`).
// `sym:` keeps its exact-t / no-fill rule; nothing here touches it.
//
// ⛔ AND IDENTITY IS (symbol?, metric) ONLY — not a series id, not a unit, not a
// label. The catalogue maps a metric to what it is computed from; renaming a
// label or re-deriving a series can never change what an instance points at.
import { projectAsOf } from './fundamentalAsOf'
import { catalogMetric, seriesIdsFor } from './fundamentalSeries'

export { FUND_MARK, fundamentalSource, parseFundamentalSource } from './fundamentalGrammar'

/**
 * `{SYMBOL: Set(seriesIds)}` this chart's fundamental sources need.
 * A metric the catalogue does not (yet) know contributes nothing — it resolves
 * as unavailable, never as a guess.
 */
export function fundamentalsNeeded(parsedSources, chartSymbol) {
  const out = {}
  for (const p of parsedSources || []) {
    if (!p || p.kind !== 'fundamental') continue
    const sym = (p.symbol || chartSymbol || '').toUpperCase()
    if (!sym) continue
    const ids = seriesIdsFor(catalogMetric(p.metric))
    if (!ids.length) continue
    const set = out[sym] || (out[sym] = new Set())
    for (const id of ids) set.add(id)
  }
  return out
}

// ─── the column ─────────────────────────────────────────────────────────────

/**
 * Fixed, named price composers — NOT a formula language. Each takes the chart's
 * own split-adjusted close and as-of fundamental columns, bar by bar. A value
 * that is not meaningful (non-positive EPS for P/E, non-positive equity for P/B)
 * is NaN: blank, never a sign-flipped ratio.
 */
const COMPOSERS = Object.freeze({
  market_cap: (c, x) => c * x.shares_outstanding,
  pe: (c, x) => (x.eps_diluted_ttm > 0 ? c / x.eps_diluted_ttm : NaN),
  ps: (c, x) => (x.revenue_ttm > 0 ? (c * x.shares_outstanding) / x.revenue_ttm : NaN),
  pb: (c, x) => (x.equity > 0 ? (c * x.shares_outstanding) / x.equity : NaN),
  fcf_yield: (c, x) => (c * x.shares_outstanding > 0 ? x.fcf_ttm / (c * x.shares_outstanding) : NaN),
})

const _memo = new WeakMap()   // bars -> Map(key -> column)

function _memoGet(bars, key, make) {
  let m = _memo.get(bars)
  if (!m) { m = new Map(); _memo.set(bars, m) }
  let col = m.get(key)
  if (!col) { col = make(); m.set(key, col) }
  return col
}

let _serial = 0
const _ids = new WeakMap()
function _idOf(obj) {
  if (!obj || typeof obj !== 'object') return 0
  let id = _ids.get(obj)
  if (!id) { _serial += 1; id = _serial; _ids.set(obj, id) }
  return id
}

/**
 * Resolve a parsed fundamental source into a column the length of `bars`, or
 * null when it cannot be computed YET (catalogue/series loading, denied, no
 * data, unknown metric). null is "not computable" -- the binder's contract --
 * never zero and never the chart's own price.
 *
 * @param {object} parsed   parseFundamentalSource(...)
 * @param {object} ctx      { bars, tf, sym, fundamentals: Map(sym -> entry),
 *                            closeOf: (sym) => number[]|null }
 */
export function fundamentalColumn(parsed, ctx) {
  const bars = Array.isArray(ctx && ctx.bars) ? ctx.bars : null
  if (!parsed || parsed.kind !== 'fundamental' || !bars || !bars.length) return null
  const metric = catalogMetric(parsed.metric)
  if (!metric) return null
  const sym = (parsed.symbol || ctx.sym || '').toUpperCase()
  const entry = ctx.fundamentals && typeof ctx.fundamentals.get === 'function' ? ctx.fundamentals.get(sym) : null
  if (!entry || !entry.series) return null
  const ids = seriesIdsFor(metric)
  const pts = ids.map((id) => entry.series[id])
  if (!pts.length || pts.some((p) => !p || !p.length)) return null
  const tf = ctx.tf
  const asOf = (p) => _memoGet(bars, `asof|${tf}|${_idOf(p)}`, () => projectAsOf(p, bars, tf))

  if (!metric.compose) return asOf(pts[0])

  const fn = COMPOSERS[metric.compose]
  if (!fn) return null
  const close = typeof ctx.closeOf === 'function' ? ctx.closeOf(sym) : null
  if (!close || close.length !== bars.length) return null
  const cols = Object.fromEntries(ids.map((id, i) => [id, asOf(pts[i])]))
  const key = `compose|${metric.compose}|${tf}|${_idOf(close)}|${ids.map((id) => _idOf(entry.series[id])).join(',')}`
  return _memoGet(bars, key, () => {
    const out = new Array(bars.length).fill(NaN)
    const x = {}
    for (let i = 0; i < bars.length; i++) {
      const c = close[i]
      if (!Number.isFinite(c)) continue
      let ok = true
      for (const id of ids) {
        const v = cols[id][i]
        if (!Number.isFinite(v)) { ok = false; break }
        x[id] = v
      }
      if (!ok) continue
      const v = fn(c, x)
      out[i] = Number.isFinite(v) ? v : NaN
    }
    return out
  })
}
