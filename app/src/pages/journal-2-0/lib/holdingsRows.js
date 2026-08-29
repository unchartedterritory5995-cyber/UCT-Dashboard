/**
 * Robinhood-style holdings list row models (Phase 2).
 * Pure functions — no React, no fetch. Semantics per the RH spec:
 *   today$ = signedShares × (price − ref); ref = fill price for same-day
 *   entries, else prev close (derived from change_pct when the feed lacks it).
 */
import { currentPriceFor, openedTodayFill, positionPnlDollar } from '../../../lib/journal-2-0'

const fin = (v) => (Number.isFinite(v) ? v : null)

function prevCloseOf(snap) {
  if (!snap) return null
  // The feed emits prev_close 0.0 for "missing" — a real close is never 0.
  if (Number.isFinite(snap.prev_close) && snap.prev_close > 0) return snap.prev_close
  if (Number.isFinite(snap.price) && Number.isFinite(snap.change_pct)) {
    const pc = snap.price / (1 + snap.change_pct / 100)
    return Number.isFinite(pc) ? pc : null
  }
  return null
}

// `preferBroker` must be the SAME flag the hero composed with (brokerLiveSummary):
// if the rows priced off our live feed while the hero priced off the broker's
// marks, the visible rows would stop summing to the number above them.
export function buildEquityRows(positions, prices, todayIso, preferBroker = false) {
  return (positions || []).map((p) => {
    const snap = prices?.[p.symbol]
    const price = fin(currentPriceFor(p, prices, preferBroker))
    const signed = (p.side === 'Short' ? -1 : 1) * (p.shares || 0)
    // Same-day-fill rule shared with brokerLiveSummary: real fills only —
    // broker imports with a placeholder (estimated) entry date use prev close.
    const ref = openedTodayFill(p, todayIso) ? fin(p.entryPrice) : prevCloseOf(snap)
    const livePrice = fin(snap?.price)
    const priced = livePrice != null || preferBroker
    const todayDollar = priced && price != null && ref != null ? signed * (price - ref) : null
    const totalReturnDollar = price == null ? null : positionPnlDollar(p, price)
    const basis = (p.entryPrice || 0) * (p.shares || 0)
    return {
      kind: 'equity',
      key: `e-${p.id}`,
      symbol: p.symbol,
      side: p.side,
      shares: p.shares,
      price,
      // Under broker marks the feed's own change_pct describes a DIFFERENT
      // price than the one shown — derive it from the pair actually rendered.
      changePct: preferBroker && price != null && ref != null && ref !== 0
        ? ((price - ref) / ref) * 100
        : fin(snap?.change_pct),
      todayDollar,
      marketValue: price == null ? null : Math.abs(p.shares || 0) * price,
      totalReturnDollar,
      totalReturnPct: totalReturnDollar != null && basis ? totalReturnDollar / basis : null,
      sparkKey: p.symbol,
    }
  })
}

export const SORT_OPTIONS = [
  { key: 'symbol', label: 'Symbol' },
  { key: 'price', label: 'Price' },
  { key: 'changePct', label: 'Today %' },
  { key: 'marketValue', label: 'Equity' },
  { key: 'todayDollar', label: 'Today $' },
  { key: 'totalReturnDollar', label: 'Total return' },
]

export function sortRows(rows, key, dir) {
  const mult = dir === 'desc' ? -1 : 1
  return [...(rows || [])].sort((a, b) => {
    const av = a?.[key]
    const bv = b?.[key]
    const aNull = av == null
    const bNull = bv == null
    if (aNull && bNull) return 0
    if (aNull) return 1                       // nulls sink last, both directions
    if (bNull) return -1
    if (typeof av === 'string') return mult * av.localeCompare(bv)
    return mult * (av - bv)
  })
}
