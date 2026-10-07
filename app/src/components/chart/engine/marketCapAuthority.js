// app/src/components/chart/engine/marketCapAuthority.js
//
// ─── DARK: the chart as a THIN CONSUMER of the canonical Market Cap authority ──
//
// WIRED (dark): binder.js calls `fundamentalColumnWithAuthority`; the map is
// non-null only while the server authority is ON (marketCapAuthorityStore.js),
// so with MCAP_PIT_ENABLED unset every chart takes the unchanged legacy path.
//
// The server authority (api/services/marketcap/serve.py) returns the DAILY
// COMPANY equity capitalization -- identity-bounded (no ticker-reuse history),
// multi-class summed at each class's own price, ADRs in ADS-equivalent units,
// split-normalized -- with a reason for every missing day. The chart therefore
// NEVER composes close x shares for Market Cap again; it only aligns the series
// onto its bars:
//   D      exact trading-date join (no forward fill: a missing day is a gap)
//   W / M  the last authority value inside the bar's period
//   intraday  not computable here (null) -- a daily authority is not an intraday
//            quantity; the migration decides the intraday rule explicitly.
import { fundamentalColumn } from './fundamentalSource'

const DAY_TFS = new Set(['D', '1D', 'day'])
const PERIOD_TFS = new Set(['W', '1W', 'M', '1M', 'week', 'month'])

/** A bar time (ISO date string, or unix seconds / ms) -> 'YYYY-MM-DD' (UTC). */
export function barDate(t) {
  if (typeof t === 'string') return t.slice(0, 10)
  if (typeof t === 'number' && Number.isFinite(t)) {
    const ms = t < 1e12 ? t * 1000 : t
    return new Date(ms).toISOString().slice(0, 10)
  }
  if (t && typeof t === 'object' && 'year' in t) {
    const p = (n) => String(n).padStart(2, '0')
    return `${t.year}-${p(t.month)}-${p(t.day)}`
  }
  return null
}

/**
 * Align authority points ([[YYYY-MM-DD, usd], ...] ascending) onto bars.
 * Returns an array the length of `bars` (NaN = no value), or null when the
 * timeframe is not one a daily authority can serve.
 */
export function authorityColumn(points, bars, tf) {
  if (!Array.isArray(points) || !Array.isArray(bars)) return null
  const out = new Array(bars.length).fill(NaN)
  if (DAY_TFS.has(tf)) {
    const byDate = new Map(points)
    for (let i = 0; i < bars.length; i++) {
      const v = byDate.get(barDate(bars[i] && bars[i].time !== undefined ? bars[i].time : bars[i] && bars[i].t))
      if (Number.isFinite(v)) out[i] = v
    }
    return out
  }
  if (PERIOD_TFS.has(tf)) {
    const starts = bars.map((b) => barDate(b && b.time !== undefined ? b.time : b && b.t))
    let p = 0
    for (let i = 0; i < bars.length; i++) {
      const lo = starts[i]
      const hi = i + 1 < bars.length ? starts[i + 1] : '9999-12-31'
      while (p < points.length && points[p][0] < lo) p++
      let last = NaN
      let q = p
      while (q < points.length && points[q][0] < hi) { last = points[q][1]; q++ }
      out[i] = Number.isFinite(last) ? last : NaN
      p = q
    }
    return out
  }
  return null
}

/**
 * Drop-in for `fundamentalColumn`: Market Cap comes from the authority when its
 * points for the symbol are supplied (`ctx.marketCapAuthority: Map(sym -> points)`);
 * every other metric -- and Market Cap without authority data -- is unchanged.
 */
export function fundamentalColumnWithAuthority(parsed, ctx) {
  const isMcap = parsed && parsed.kind === 'fundamental' && String(parsed.metric) === 'market_cap'
  const auth = ctx && ctx.marketCapAuthority
  if (isMcap && auth && typeof auth.get === 'function') {
    // ⛔ AUTHORITY ON = AUTHORITY ONLY. A series still loading, a ticker the
    // authority does not carry, or an intraday frame is NOT COMPUTABLE (null) --
    // never a close x shares stand-in, which would flash a second methodology.
    const sym = (parsed.symbol || ctx.sym || '').toUpperCase()
    const pts = auth.get(sym)
    return Array.isArray(pts) ? authorityColumn(pts, ctx.bars, ctx.tf) : null
  }
  return fundamentalColumn(parsed, ctx)
}
