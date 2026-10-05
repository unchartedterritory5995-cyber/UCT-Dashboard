// The option chain's own arithmetic, kept pure so every rule here has a test (chainMath.test.js).
// Inputs are the rows api/services/polygon_options.py::_normalize_contract returns.

// A contract's OCC root: `O:AAPL261120C00100000` -> 'AAPL', `O:AAPL1261120C00100000` -> 'AAPL1' (an
// adjusted root carries a digit). Lazy, so the six date digits are never swallowed into the root.
// Null when the ticker is not that shape.
export function occRoot(contract) {
  const m = /^O:([A-Z][A-Z0-9.]*?)\d{6}[CP]\d{8}$/.exec(String(contract || ''))
  return m ? m[1] : null
}

/** 0 for a standard contract (100 shares, root = the underlying), 1 for an adjusted one (a split,
 *  merger or special dividend leaves e.g. `O:AAPL1...` delivering a non-100 basket). */
export function adjustedRank(c, underlying) {
  const spc = c?.shares_per_contract == null ? 100 : Number(c.shares_per_contract)
  if (spc !== 100) return 1
  const root = occRoot(c?.contract)
  const und = (c?.underlying_ticker || underlying || '').toUpperCase()
  if (root && und && root !== und) return 1
  return 0
}

/**
 * calls | strike | puts, one row per strike. A strike can carry TWO contracts per side -- the
 * standard one and an adjusted one -- and a plain strike-keyed Map let whichever came last overwrite
 * the other, so an adjusted contract's quote and greeks could silently stand in for the standard
 * contract's. The standard contract wins; a tie keeps the first; every contract left out is counted
 * (`dropped`) so the chain can say so.
 */
export function mergeChain(calls = [], puts = [], underlying = '') {
  const byStrike = new Map()
  let dropped = 0
  const place = (c, side) => {
    if (!c || c.strike == null) return
    const row = byStrike.get(c.strike) || { strike: c.strike }
    const held = row[side]
    if (!held) row[side] = c
    else {
      dropped += 1
      if (adjustedRank(c, underlying) < adjustedRank(held, underlying)) row[side] = c
    }
    byStrike.set(c.strike, row)
  }
  for (const c of calls) place(c, 'call')
  for (const p of puts) place(p, 'put')
  return { rows: [...byStrike.values()].sort((a, b) => a.strike - b.strike), dropped }
}

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))

/**
 * The header's ATM IV, computed the way the backend's probability model does
 * (api/services/options_analytics/chain_tools.py::_atm): the strike closest to spot AMONG strikes that
 * carry an IV, and the MEAN of the call and put IV there. It used to be the call's IV alone, so the
 * header, the payoff panel's probability of profit and the strategy finder all disagreed with the
 * probability panel beside them. One-sided strikes average what they have.
 */
export function atmIvOf(rows, spot) {
  const s = num(spot)
  if (s == null) return null
  let best = null
  for (const r of rows || []) {
    const ivs = [num(r.call?.iv), num(r.put?.iv)].filter((v) => v != null)
    if (r.strike == null || !ivs.length) continue
    if (best == null || Math.abs(r.strike - s) < Math.abs(best.strike - s)) best = { strike: r.strike, ivs }
  }
  return best ? best.ivs.reduce((a, b) => a + b, 0) / best.ivs.length : null
}

/** Quote mid: both sides present, positive and not crossed; else null (never a one-sided guess). */
export function midOf(q) {
  const b = num(q?.bid)
  const a = num(q?.ask)
  if (b == null || a == null || b <= 0 || a <= 0 || a < b) return null
  return (a + b) / 2
}

/** Today's volume over open interest. OI is the prior close's figure, so this is "how much of
 *  yesterday's open interest traded today". Null when OI is 0 or missing (a ratio over nothing). */
export function volOiOf(q) {
  const v = num(q?.day_volume)
  const oi = num(q?.open_interest)
  if (v == null || oi == null || oi <= 0) return null
  return v / oi
}

/** In the money at today's spot: a call below spot, a put above it. At-the-strike is not ITM. */
export function isItm(side, strike, spot) {
  const k = num(strike)
  const s = num(spot)
  if (k == null || s == null) return false
  return side === 'call' ? k < s : k > s
}

/**
 * The market's expected move to the selected expiration: the at-the-money straddle's mid (call mid +
 * put mid at the strike closest to spot), as dollars and as a share of spot. A rule of thumb, not a
 * forecast; null when either leg has no two-sided quote.
 */
export function expectedMove(rows, spot) {
  const s = num(spot)
  if (s == null || s <= 0) return null
  let row = null
  for (const r of rows || []) {
    if (r.strike == null) continue
    if (row == null || Math.abs(r.strike - s) < Math.abs(row.strike - s)) row = r
  }
  const c = midOf(row?.call)
  const p = midOf(row?.put)
  if (c == null || p == null) return null
  const dollars = c + p
  return { strike: row.strike, dollars, pct: (dollars / s) * 100 }
}
