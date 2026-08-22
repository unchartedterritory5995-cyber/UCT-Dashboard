// app/src/pages/cot/cotDivergence.js
//
// Price-vs-positioning tells — pure, no React.
//
// Five deterministic rules compare where price sits (its 52-week range, its
// 13-week trend) against what the trader groups and open interest have been
// doing over the same stretch. A rule whose inputs are missing is skipped; at
// most two tells are returned, highest priority first. Numbers are rounded only
// when they are written into the text.
//
// Inputs:
//   rows          — `/api/cot/{symbol}` records, ascending, weekly
//   priceAligned  — one close per row (see cotAnalogs.alignPrice), null where unknown
//   idx           — the week being analysed

import { INDEX_WINDOW, computeSnapshot } from './cotRead'

/** "Near" a 52-week high/low: within this % of it. */
export const NEAR_PCT = 2
/** Lookback for the trend rules (price, positioning, OI), in weeks. */
export const TREND_WEEKS = 13
/** A meaningful shift on the 0..100 index over INDEX_LOOKBACK_WEEKS. */
export const INDEX_DROP = 15
/** Range the high/low rules look over, in weeks. */
export const RANGE_WEEKS = 52
/** How far back the index-shift rules compare, in weeks. */
export const INDEX_LOOKBACK_WEEKS = 8
/** A 13-week price move smaller than this is not a trend. */
export const TREND_PCT = 3
/** Tells returned per week, highest priority first. */
export const MAX_TELLS = 2

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const delta = (from, to) => (num(from) != null && num(to) != null ? to - from : null)
const pctChange = (from, to) => (num(from) != null && num(to) != null && from !== 0 ? ((to - from) / from) * 100 : null)

const fmtPct = x => `${Math.abs(x).toFixed(1)}%`
const fmtN = x => Math.abs(Math.round(x)).toLocaleString('en-US')
const fmtPts = x => { const p = Math.round(Math.abs(x)); return `${p} point${p === 1 ? '' : 's'}` }

// Highest and lowest known close over the trailing RANGE_WEEKS, nulls skipped.
// Null when the lookback is not yet full — "52-week high" means nothing on
// twenty weeks of history.
function rangeOf(price, idx) {
  const start = idx - RANGE_WEEKS + 1
  if (start < 0) return null
  let hi = -Infinity, lo = Infinity
  for (let i = start; i <= idx; i++) {
    const p = num(price[i])
    if (p == null) continue
    if (p > hi) hi = p
    if (p < lo) lo = p
  }
  return hi === -Infinity ? null : { hi, lo }
}

/**
 * Detect price-vs-positioning divergences at week `idx`.
 * @param {Array} rows
 * @param {Array<number|null>} priceAligned
 * @param {number} idx
 * @param {{ window?: number }} [opts]  index window for the 3Y COT index
 * @returns {Array<{ key: string, tone: 'bull'|'bear'|'caution'|'info', label: string, text: string }>}
 *   at most MAX_TELLS entries, in priority order:
 *   price-high-specs-fading · price-low-hedgers-buying · rally-on-shrinking-participation ·
 *   selloff-hedgers-absorbing · trend-confirmed
 */
export function detectDivergences(rows, priceAligned, idx, { window = INDEX_WINDOW } = {}) {
  if (!rows || !priceAligned || idx == null || idx < 0 || idx >= rows.length) return []
  const p = num(priceAligned[idx])
  if (p == null) return []
  const row = rows[idx]

  // Where price sits in its 52-week range.
  const range = rangeOf(priceAligned, idx)
  const nearHigh = range != null && p >= range.hi * (1 - NEAR_PCT / 100)
  const nearLow  = range != null && p <= range.lo * (1 + NEAR_PCT / 100)

  // How each group's index has shifted over the last eight weeks.
  let specDrop = null, commRise = null
  if (idx >= INDEX_LOOKBACK_WEEKS) {
    const now  = computeSnapshot(rows, idx, window).groups
    const then = computeSnapshot(rows, idx - INDEX_LOOKBACK_WEEKS, window).groups
    specDrop = delta(now.largeSpecs.index, then.largeSpecs.index)     // then − now
    commRise = delta(then.commercials.index, now.commercials.index)   // now − then
  }

  // Thirteen-week trend in price, positioning and open interest.
  let t = null
  if (idx >= TREND_WEEKS) {
    const past = rows[idx - TREND_WEEKS]
    t = {
      pricePct: pctChange(num(priceAligned[idx - TREND_WEEKS]), p),
      specs:    delta(past.large_spec_net, row.large_spec_net),
      comm:     delta(past.commercial_net, row.commercial_net),
      oi:       delta(past.open_interest, row.open_interest),
      oiPct:    pctChange(past.open_interest, row.open_interest),
    }
  }
  const trendKnown = t != null && t.pricePct != null && t.specs != null && t.oi != null
  const oiText = () => (t.oiPct != null ? fmtPct(t.oiPct) : `${fmtN(t.oi)} contracts`)

  const tells = []

  if (nearHigh && specDrop != null && specDrop >= INDEX_DROP) {
    tells.push({
      key: 'price-high-specs-fading', tone: 'bear', label: 'Price high, specs fading',
      text: `Price is at a 52-week high but the trend money is backing away — large speculators have cut their index by ${fmtPts(specDrop)} in eight weeks. Rallies without the crowd behind them are the ones that fail.`,
    })
  }

  if (nearLow && commRise != null && commRise >= INDEX_DROP) {
    tells.push({
      key: 'price-low-hedgers-buying', tone: 'bull', label: 'Price low, hedgers buying',
      text: `Price is at a 52-week low but the hedgers are buying into it — commercials have lifted their index by ${fmtPts(commRise)} in eight weeks. That is accumulation into weakness, and it is how bottoms usually get built.`,
    })
  }

  if (trendKnown && t.pricePct > TREND_PCT && t.specs < 0 && t.oi < 0) {
    tells.push({
      key: 'rally-on-shrinking-participation', tone: 'caution', label: 'Rally on thin participation',
      text: `Price is up ${fmtPct(t.pricePct)} over thirteen weeks, but large speculators have cut ${fmtN(t.specs)} contracts and open interest is down ${oiText()}. A rally fewer traders are taking part in is running on fumes — respect it, but don't chase it.`,
    })
  }

  if (trendKnown && t.comm != null && t.pricePct < -TREND_PCT && t.specs < 0 && t.comm > 0) {
    tells.push({
      key: 'selloff-hedgers-absorbing', tone: 'bull', label: 'Selloff being absorbed',
      text: `Price is down ${fmtPct(t.pricePct)} over thirteen weeks while the trend money keeps selling — large speculators have cut ${fmtN(t.specs)} contracts and commercials have added ${fmtN(t.comm)}. The hedgers are absorbing what the speculators are dumping, and that is how declines get exhausted.`,
    })
  }

  if (trendKnown && t.pricePct > TREND_PCT && t.specs > 0 && t.oi > 0) {
    tells.push({
      key: 'trend-confirmed', tone: 'info', label: 'Trend confirmed',
      text: `Price, the trend money and open interest are all rising together — a healthy trend, not a divergence. Price is up ${fmtPct(t.pricePct)} over thirteen weeks, large speculators have added ${fmtN(t.specs)} contracts and open interest is up ${oiText()}.`,
    })
  }

  return tells.slice(0, MAX_TELLS)
}
