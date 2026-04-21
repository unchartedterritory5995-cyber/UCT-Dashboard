/**
 * Options — client-side mirror of `api/services/journal_two/options.py`
 * calc helpers. Used by the Add Strategy modal's live-calc footer and
 * for any read-side derivations (unrealized P&L, DTE display).
 *
 * Keep in sync with the Python module. Formulas:
 *   net_entry = Σ (sideSign × qty × entry_price × 100)
 *   net_exit  = Σ (sideSign × qty × exit_price  × 100)
 *   pnl       = net_exit - net_entry - fees - exit_fees
 *
 * sideSign = +1 if side === 'buy', -1 if side === 'sell'.
 * Positive net_entry = net debit (paid). Negative = net credit (received).
 */

export function sideSign(side) {
  return side === 'buy' ? 1 : -1
}

export function computeNetEntry(legs) {
  if (!Array.isArray(legs) || legs.length === 0) return 0
  let total = 0
  for (const leg of legs) {
    const qty = Number(leg.qty) || 0
    const price = Number(leg.entryPrice ?? leg.entry_price) || 0
    total += sideSign(leg.side) * qty * price * 100
  }
  return Math.round(total * 100) / 100
}

export function computeNetExit(legs) {
  if (!Array.isArray(legs) || legs.length === 0) return null
  let total = 0
  for (const leg of legs) {
    const ep = leg.exitPrice ?? leg.exit_price
    if (ep === null || ep === undefined) return null
    const qty = Number(leg.qty) || 0
    total += sideSign(leg.side) * qty * Number(ep) * 100
  }
  return Math.round(total * 100) / 100
}

export function computePnl(netEntry, netExit, fees = 0, exitFees = 0) {
  if (netExit === null || netExit === undefined) return null
  return Math.round((netExit - netEntry - (fees || 0) - (exitFees || 0)) * 100) / 100
}

/** Classification for the Credit-vs-Debit analytics chart. */
export function classifyDebitCredit(netEntry) {
  if (netEntry > 0) return 'debit'
  if (netEntry < 0) return 'credit'
  return 'even'
}

/**
 * Per-strategy max-loss. Mirrors the Python version — returns null when
 * undefined (naked shorts) so the caller renders "—" instead of a number.
 */
export function computeMaxRisk(strategyType, legs, netEntry) {
  if (strategyType === 'long_call' || strategyType === 'long_put') {
    return Math.max(netEntry, 0)
  }
  if (strategyType === 'short_call' || strategyType === 'short_put') {
    return null
  }
  if (strategyType === 'vertical_debit_call' || strategyType === 'vertical_debit_put') {
    return Math.max(netEntry, 0)
  }
  if (strategyType === 'vertical_credit_call' || strategyType === 'vertical_credit_put') {
    if (!legs || legs.length < 2) return null
    const width = Math.abs(Number(legs[0].strike) - Number(legs[1].strike))
    const qty = Number(legs[0].qty) || 0
    return Math.round((width * 100 * qty + netEntry) * 100) / 100
  }
  if (strategyType === 'iron_condor' || strategyType === 'iron_butterfly') {
    if (!legs || legs.length < 4) return null
    const strikes = legs.map(l => Number(l.strike)).sort((a, b) => a - b)
    const maxWing = Math.max(strikes[1] - strikes[0], strikes[3] - strikes[2])
    const qty = Math.min(...legs.map(l => Number(l.qty) || 0))
    return Math.round((maxWing * 100 * qty + netEntry) * 100) / 100
  }
  if (strategyType === 'call_butterfly' || strategyType === 'put_butterfly') {
    return Math.max(netEntry, 0)
  }
  if (strategyType === 'straddle' || strategyType === 'strangle') {
    return Math.max(netEntry, 0)
  }
  if (strategyType === 'calendar' || strategyType === 'diagonal') {
    return netEntry > 0 ? netEntry : null
  }
  return null
}

/**
 * Minimum days-to-expiration across all legs. null if any leg's
 * expiration is malformed.
 */
export function computeDaysToExpiration(legs, asOf = new Date()) {
  if (!Array.isArray(legs) || legs.length === 0) return null
  let min = Infinity
  for (const leg of legs) {
    if (!leg.expiration || typeof leg.expiration !== 'string') return null
    const exp = new Date(`${leg.expiration}T00:00:00Z`)
    if (Number.isNaN(exp.getTime())) return null
    const days = Math.round((exp - asOf) / 86_400_000)
    if (days < min) min = days
  }
  return min === Infinity ? null : min
}

/**
 * Build a compact human label for a strategy. Examples:
 *   "NVDA 550/560 Call Credit Spread Jun 20"
 *   "SPY 420/415/440/445 Iron Condor May 16"
 *   "AMD 140C Jun 20"
 */
export function buildStrategyLabel(strategy) {
  const legs = strategy.legs || []
  const underlying = strategy.underlying || ''
  const type = strategy.strategyType || ''

  const expCode = legs.length
    ? formatExpShort(
        legs.reduce((min, l) => (min && min < l.expiration ? min : l.expiration), null),
      )
    : ''

  // Single-leg: "AMD 140C Jun 20"
  if (legs.length === 1) {
    const l = legs[0]
    const cp = l.contractType === 'call' ? 'C' : 'P'
    const sideWord = l.side === 'buy' ? 'Long' : 'Short'
    return `${underlying} ${l.strike}${cp} ${sideWord} ${expCode}`.trim()
  }

  // Verticals: "NVDA 550/560 Call Credit Spread Jun 20"
  if (type.startsWith('vertical_')) {
    const cp = type.endsWith('_call') ? 'Call' : 'Put'
    const kind = type.includes('debit') ? 'Debit Spread' : 'Credit Spread'
    const strikes = legs
      .map(l => Number(l.strike))
      .sort((a, b) => a - b)
      .join('/')
    return `${underlying} ${strikes} ${cp} ${kind} ${expCode}`.trim()
  }

  // Iron Condor/Butterfly: list all strikes
  if (type === 'iron_condor' || type === 'iron_butterfly') {
    const strikes = legs
      .map(l => Number(l.strike))
      .sort((a, b) => a - b)
      .join('/')
    const kind = type === 'iron_condor' ? 'Iron Condor' : 'Iron Butterfly'
    return `${underlying} ${strikes} ${kind} ${expCode}`.trim()
  }

  // Generic fallback
  const pretty = type.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase())
  return `${underlying} ${pretty} ${expCode}`.trim()
}

function formatExpShort(exp) {
  if (!exp) return ''
  // "2026-06-20" → "Jun 20"
  const d = new Date(`${exp}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return exp
  return d.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Pretty strategy-type name for display: "vertical_credit_call" →
 * "Call Credit Spread"; "iron_condor" → "Iron Condor"; etc.
 */
export function prettyStrategyType(type) {
  const map = {
    long_call: 'Long Call',
    long_put: 'Long Put',
    short_call: 'Short Call',
    short_put: 'Short Put',
    vertical_debit_call: 'Call Debit Spread',
    vertical_credit_call: 'Call Credit Spread',
    vertical_debit_put: 'Put Debit Spread',
    vertical_credit_put: 'Put Credit Spread',
    calendar: 'Calendar',
    diagonal: 'Diagonal',
    straddle: 'Straddle',
    strangle: 'Strangle',
    iron_condor: 'Iron Condor',
    iron_butterfly: 'Iron Butterfly',
    call_butterfly: 'Call Butterfly',
    put_butterfly: 'Put Butterfly',
    custom: 'Custom',
  }
  return map[type] || type
}
