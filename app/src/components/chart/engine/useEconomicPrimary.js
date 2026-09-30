// app/src/components/chart/engine/useEconomicPrimary.js
//
// ─── THE PRIMARY-CHART HALF OF THE ECONOMIC SEAM (StockChart) ───────────────
//
// `sym` is `ECON:<SYMBOL>` -> the series, its host rows for this timeframe, its
// registry metadata, the axis format and the member-facing currentness. Any other
// `sym` (every stock, ETF, index, breadth measure) -> the shared EMPTY answer with
// no request and no subscription, so a stock chart is untouched by construction.
//
// ⛔ NEVER `/api/bars`: the series comes from `/api/econ/series/<SYM>` through
// `economicSeries` (deduped, DENIED terminal, 404 = NO_DATA, backoff otherwise).
import { useEffect, useState } from 'react'
import { isEconomicId } from './econMark'
import { economicSymbolOf } from './economicGrammar'
import { ensureEconomicSeries, economicCatalog, subscribeEconomic, SOURCE_STATUS } from './economicSeries'
import { economicColumn } from './economicSource'
import { primaryEconomicBars } from './economicPrimary'
import { formatKeyOf, fundamentalPriceFormat } from './fundamentalFormat'

const EMPTY = Object.freeze({
  isEcon: false, symbol: null, status: null, entry: null, meta: null, bars: null,
  column: null, tf: null, priceFormat: null, currentnessView: null, pending: false,
})

/** 'W' | 'M' stay; everything else (D, intraday, custom) is the series-native D. */
export const economicPrimaryTf = (tf) => (tf === 'W' || tf === 'M' ? tf : 'D')

export function useEconomicPrimary(sym, tf) {
  const symbol = isEconomicId(sym) ? economicSymbolOf(sym) : null
  const [, setGen] = useState(0)
  useEffect(() => {
    if (!symbol) return undefined
    return subscribeEconomic(() => setGen((g) => g + 1))
  }, [symbol])

  const entry = symbol ? ensureEconomicSeries(symbol) : null
  const cat = symbol ? economicCatalog() : null
  const etf = economicPrimaryTf(tf)
  const available = !!entry && entry.status === SOURCE_STATUS.AVAILABLE
  const meta = available && entry.meta && Object.keys(entry.meta).length
    ? entry.meta : (cat && symbol ? cat.bySymbol.get(symbol) || null : null)

  // ⚠️ NO useMemo: both calls are memoised at the module level on the entry's
  // frozen `points` (and the rows' identity), which is what keeps `bars` stable
  // across renders — the binder's native-timeline registry keys on that identity.
  const bars = available ? primaryEconomicBars(symbol, entry, etf) : null
  // ⭐ THE SAME MEMOISED COLUMN THE BINDER DRAWS (same bars, same entry, same key),
  // so the bar-info strip can never read a different point than the line shows.
  const column = (bars && available)
    ? economicColumn({ kind: 'economic', symbol }, { bars, tf: etf, economics: new Map([[symbol, entry]]) })
    : null

  const fmtKey = formatKeyOf(meta && meta.units)
  const priceFormat = fmtKey ? fundamentalPriceFormat(fmtKey) : null

  if (!symbol) return EMPTY
  return {
    isEcon: true,
    symbol,
    status: entry ? entry.status : SOURCE_STATUS.LOADING,
    entry: available ? entry : null,
    meta,
    bars,
    column,
    tf: etf,
    priceFormat,
    currentnessView: available ? entry.currentnessView : null,
    pending: !entry || entry.status === SOURCE_STATUS.LOADING || entry.status === SOURCE_STATUS.ERROR,
  }
}

/**
 * The observation under row `i` of a primary column, and the previous VALUED
 * observation (for the change figure). null where the row holds no value.
 */
export function primaryObservationAt(column, i) {
  const e = column && column.__econ
  if (!e || !Number.isInteger(i) || i < 0) return null
  const j = e.indices[i]
  if (j === undefined || j < 0) return null
  const point = e.points[j]
  if (!point || !Number.isFinite(point.v)) return null
  let prev = null
  for (let k = j - 1; k >= 0; k--) {
    const q = e.points[k]
    if (q && Number.isFinite(q.v) && q.pe !== point.pe) { prev = q; break }
  }
  return { point, prev }
}

export default useEconomicPrimary
