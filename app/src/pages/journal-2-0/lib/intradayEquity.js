/**
 * Pure builder for a Robinhood-style 1D intraday portfolio-value curve.
 *
 * We have no intraday equity snapshots server-side (the broker snapshot table is
 * once-daily), so the 1D curve is reconstructed client-side from each holding's
 * intraday price bars:
 *
 *   value(t) = cash + Σ_option(brokerCurrentValue)          // options flat (no intraday quote)
 *            + Σ_equity( closeAtOrBefore(sym, t) × signedShares )
 *
 * The series is anchored with a leading point at the PREVIOUS CLOSE portfolio
 * value (Robinhood's 1D dotted baseline = prior 4pm ET close), so the line
 * starts flat at yesterday's close and moves with today's session. Missing bars
 * for a symbol forward-fill from its last known close (or its previous close
 * before the first bar).
 *
 * This module is pure and unit-tested; the fetching lives in
 * useIntradayEquityCurve.
 */

/**
 * @param {Record<string, Array<{t:number|string, c:number}>>} barsBySymbol
 *   today's intraday bars per equity symbol (ascending by t)
 * @param {Array<{symbol,shares,side?}>} positions   equity positions
 * @param {Record<string, number>} prevCloseBySymbol  per-symbol previous close
 * @param {number} optionMarketValue  Σ option brokerCurrentValue (flat intraday)
 * @param {number} cash               account cash (can be negative = margin debit)
 * @returns {Array<{t:number, value:number}>|null}  null if no usable bars
 */
export function buildIntradayEquitySeries(
  barsBySymbol,
  positions,
  prevCloseBySymbol,
  optionMarketValue = 0,
  cash = 0,
) {
  const equities = (positions || []).filter(
    (p) => p && !p.isOption && Number.isFinite(p.shares),
  )
  if (!equities.length) return null

  const signed = (p) => (p.side === 'Short' ? -p.shares : p.shares)

  // Union of all bar timestamps (numeric epoch seconds/ms — coerced to Number).
  const tsSet = new Set()
  for (const p of equities) {
    for (const b of barsBySymbol?.[p.symbol] || []) {
      const t = Number(b.t)
      if (Number.isFinite(t)) tsSet.add(t)
    }
  }
  const timestamps = [...tsSet].sort((a, b) => a - b)
  if (!timestamps.length) return null

  // Per-symbol cursor for forward-fill; seed with the symbol's previous close so
  // a symbol that hasn't printed yet contributes its prior close (flat).
  const cursor = {} // symbol -> { i, lastClose }
  for (const p of equities) {
    const pc = prevCloseBySymbol?.[p.symbol]
    cursor[p.symbol] = { i: 0, lastClose: Number.isFinite(pc) ? pc : null }
  }

  // Leading baseline point = previous-close portfolio value.
  let prevCloseValue = cash + optionMarketValue
  let baselineComplete = true
  for (const p of equities) {
    const pc = prevCloseBySymbol?.[p.symbol]
    if (Number.isFinite(pc)) prevCloseValue += pc * signed(p)
    else baselineComplete = false
  }

  const out = []
  for (const t of timestamps) {
    let value = cash + optionMarketValue
    let usable = false
    for (const p of equities) {
      const bars = barsBySymbol?.[p.symbol] || []
      const c = cursor[p.symbol]
      while (c.i < bars.length && Number(bars[c.i].t) <= t) {
        const close = Number(bars[c.i].c)
        if (Number.isFinite(close)) c.lastClose = close
        c.i += 1
      }
      if (Number.isFinite(c.lastClose)) {
        value += c.lastClose * signed(p)
        usable = true
      }
    }
    if (usable) out.push({ t, value })
  }
  if (!out.length) return null

  // Prepend the prev-close baseline (only when we have every symbol's prev close,
  // so the flat start is accurate) with a timestamp just before the first bar.
  if (baselineComplete && Number.isFinite(prevCloseValue)) {
    out.unshift({ t: out[0].t - 1, value: prevCloseValue, baseline: true })
  }
  return out
}
