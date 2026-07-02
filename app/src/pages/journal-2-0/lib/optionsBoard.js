/**
 * RH-style options board models (Phase 4). Pure functions.
 * Broker mark only (spec-locked: no greeks / live option quotes).
 * "Net options performance" is reconstructed as the cumulative realized
 * options P&L over closed strategies plus the current open unrealized P&L
 * as the live last point — J2 keeps no per-option mark history.
 */
import { buildStrategyLabel, computeDaysToExpiration } from './optionCalcs'

const fin = (v) => (Number.isFinite(v) ? v : null)

export function buildOptionCards(strategies) {
  const cards = (strategies || []).map((s) => {
    const bcv = fin(s.brokerCurrentValue)
    const pnl = bcv == null || !Number.isFinite(s.netEntry) ? null : bcv - s.netEntry
    return {
      key: `o-${s.id}`,
      label: buildStrategyLabel(s),
      underlying: s.underlying,
      contracts: s.legs?.[0]?.qty ?? null,
      expiration: s.legs?.[0]?.expiration ?? null,
      dte: computeDaysToExpiration(s.legs),
      mark: bcv == null ? null : Math.abs(bcv),
      totalReturnDollar: pnl,
      totalReturnPct: pnl != null && s.netEntry ? pnl / Math.abs(s.netEntry) : null,
    }
  })
  return cards.sort((a, b) => (a.dte ?? Infinity) - (b.dte ?? Infinity))
}

export function netOptionsPerformance(closedStrategies, openCards) {
  const realized = (closedStrategies || [])
    .filter((s) => Number.isFinite(s?.pnlDollar))
    .sort((a, b) => String(a.closedAt || '').localeCompare(String(b.closedAt || '')))
  const points = []
  let sum = 0
  for (const s of realized) {
    sum += s.pnlDollar
    points.push(sum)
  }
  const openPnl = (openCards || []).reduce(
    (s, c) => s + (Number.isFinite(c?.totalReturnDollar) ? c.totalReturnDollar : 0),
    0,
  )
  if ((openCards || []).some((c) => Number.isFinite(c?.totalReturnDollar))) {
    points.push(sum + openPnl)
  }
  return points.length >= 2 ? points : null
}
