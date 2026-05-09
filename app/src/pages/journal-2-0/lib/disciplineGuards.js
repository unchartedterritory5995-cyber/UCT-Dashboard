/**
 * Pure helpers for the J2 entry-guard layer (Phase A).
 * No React, no fetch — just math. Reused by AddPositionModal + AddTradeModal.
 */

const numOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Pre-fill suggested share count from default size %. Floor to whole shares. */
export function computeDefaultShares({ accountSize, defaultSizePct, entryPrice }) {
  const acct = numOrNull(accountSize)
  const pct = numOrNull(defaultSizePct)
  const entry = numOrNull(entryPrice)
  if (!acct || !pct || !entry || entry <= 0) return null
  const positionDollars = acct * (pct / 100)
  return Math.floor(positionDollars / entry)
}

/** Display-only suggested-target price from R-multiple goal. */
export function computeSuggestedTarget({ side, entryPrice, stopPrice, rMultiple }) {
  const entry = numOrNull(entryPrice)
  const stop = numOrNull(stopPrice)
  const r = numOrNull(rMultiple)
  if (!entry || stop === null || !r) return null
  if (side === 'Long') {
    if (stop >= entry) return null
    return entry + r * (entry - stop)
  }
  if (side === 'Short') {
    if (stop <= entry) return null
    return entry - r * (stop - entry)
  }
  return null
}

/** Implied $ risk as % of account, given current form values. Null if not computable. */
export function computeImpliedRiskPct({ accountSize, shares, entryPrice, stopPrice, side }) {
  const acct = numOrNull(accountSize)
  const sh = numOrNull(shares)
  const entry = numOrNull(entryPrice)
  const stop = numOrNull(stopPrice)
  if (!acct || acct <= 0 || !sh || sh <= 0 || !entry || stop === null) return null
  const perShare = side === 'Long' ? entry - stop : stop - entry
  if (perShare <= 0) return null
  const dollarRisk = sh * perShare
  return (dollarRisk / acct) * 100
}
