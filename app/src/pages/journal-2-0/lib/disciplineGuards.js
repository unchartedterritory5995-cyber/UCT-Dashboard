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

/**
 * Compute a default stop from the member's chosen stop-placement mode.
 *
 * ⛔ MOVED HERE FROM `AddPositionModal.jsx` (D-33), BODY UNCHANGED. It was module-private
 * with three call sites inside that one file, so the joystick hub's Plan-trade sheet — which
 * needs exactly this number — could not reach it. The alternative was re-implementing it in
 * the hub, i.e. a second opinion about where a member's stop goes, living in a gesture
 * handler. A wrong default stop is a number the member would act on.
 *
 * ⭐ Returns `''` (not a number) whenever it cannot compute one — mode `custom`, a missing
 * bar anchor, no shares for `fixed_dollar_risk`. Callers render that as blank and MUST NOT
 * substitute a level of their own.
 *
 * @param {{side: string, sharesVal: *, entryVal: *, defaultStop: object,
 *   barLow?: *, barHigh?: *}} args
 * @returns {number|''}
 */
export function prefillStop({ side, sharesVal, entryVal, defaultStop, barLow, barHigh }) {
  const shares = Number(sharesVal)
  const entry = Number(entryVal)
  if (!defaultStop || defaultStop.mode === 'custom') return ''
  if (!Number.isFinite(entry) || entry <= 0) return ''

  // Chart-right-click path: bar low/high available → compute immediately
  // for bar_low_high mode. No shares needed.
  if (defaultStop.mode === 'bar_low_high') {
    const anchor = side === 'Long' ? Number(barLow) : Number(barHigh)
    if (!Number.isFinite(anchor)) return ''  // manual entry — no bar context
    const buffer = Number(defaultStop.buffer) || 0
    const offset = defaultStop.bufferUnit === '%'
      ? anchor * (buffer / 100)
      : buffer
    const raw = side === 'Long' ? anchor - offset : anchor + offset
    return raw < 0 ? 0 : Math.round(raw * 100) / 100
  }

  if (defaultStop.mode === 'fixed_percent_distance') {
    const p = Number(defaultStop.percent) || 0
    if (p <= 0 || p >= 100) return ''
    const raw = side === 'Long' ? entry * (1 - p / 100) : entry * (1 + p / 100)
    return raw < 0 ? 0 : Math.round(raw * 100) / 100
  }

  // fixed_dollar_risk needs shares to distribute the $ risk across
  if (defaultStop.mode === 'fixed_dollar_risk') {
    if (!Number.isFinite(shares) || shares <= 0) return ''
    const amt = Number(defaultStop.amount) || 0
    if (amt <= 0) return ''
    const raw = side === 'Long' ? entry - amt / shares : entry + amt / shares
    return raw < 0 ? 0 : Math.round(raw * 100) / 100
  }

  return ''
}
