// BRK-01 increment 2 (roadmap RM-L01): profit and loss AT EXPIRATION for a single
// option or a vertical spread, off the live chain the tab already shows.
//
// ⛔ Read-only by charter, like the chain: this draws what a position WOULD be worth,
//    it never places, stages or sends one.
// ⛔ The fill assumption is stated, never hidden: every leg is priced at the mid of its
//    bid and ask. A leg with no two-sided quote has no price, and the strategy says so
//    instead of inventing one (a last trade can be hours stale).
// Pure; no React. One contract = 100 shares.

export const MULTIPLIER = 100

export const STRATEGIES = {
  long_call: { label: 'Long call', strikes: 1 },
  long_put: { label: 'Long put', strikes: 1 },
  bull_call: { label: 'Bull call spread', strikes: 2 },
  bear_put: { label: 'Bear put spread', strikes: 2 },
}

/** The mid of a two-sided quote, or null. */
export function mid(quote) {
  const b = Number(quote?.bid)
  const a = Number(quote?.ask)
  if (!Number.isFinite(b) || !Number.isFinite(a) || b <= 0 || a <= 0 || a < b) return null
  return (a + b) / 2
}

/**
 * The legs of a strategy from the chain rows ([{strike, call, put}]).
 * `strikes` is [k] or [low, high]. Returns {legs} or {error} (a sentence).
 */
export function buildLegs(kind, strikes, rows) {
  const spec = STRATEGIES[kind]
  if (!spec) return { error: 'Pick a strategy.' }
  const byStrike = new Map(rows.map((r) => [r.strike, r]))
  const ks = (strikes || []).map(Number).filter(Number.isFinite)
  if (ks.length !== spec.strikes) return { error: 'Pick a strike.' }
  const leg = (type, side, k) => {
    const q = byStrike.get(k)?.[type]
    const premium = mid(q)
    // iv: the vendor's, carried for FT-001's "today at IV" curve (chainModels.js); unused at expiry
    return { type, side, strike: k, premium, iv: q?.iv ?? null }
  }
  let legs
  if (kind === 'long_call') legs = [leg('call', 1, ks[0])]
  else if (kind === 'long_put') legs = [leg('put', 1, ks[0])]
  else {
    const [lo, hi] = [...ks].sort((a, b) => a - b)
    if (lo === hi) return { error: 'A spread needs two different strikes.' }
    legs = kind === 'bull_call'
      ? [leg('call', 1, lo), leg('call', -1, hi)]
      : [leg('put', 1, hi), leg('put', -1, lo)]
  }
  const unpriced = legs.filter((l) => l.premium == null)
  if (unpriced.length) {
    const names = unpriced.map((l) => `${l.strike} ${l.type}`).join(' and ')
    return { error: `No two-sided quote for the ${names}, so there is no honest price to draw.` }
  }
  return { legs }
}

const intrinsic = (l, s) => (l.type === 'call' ? Math.max(0, s - l.strike) : Math.max(0, l.strike - s))

/** P/L in dollars for ONE contract of each leg, at expiration, at underlying price s. */
export function pnlAt(legs, s) {
  let v = 0
  for (const l of legs) v += l.side * (intrinsic(l, s) - l.premium)
  return v * MULTIPLIER
}

/** Net cost in dollars (positive = you pay, negative = you collect). */
export function netCost(legs) {
  return legs.reduce((a, l) => a + l.side * l.premium, 0) * MULTIPLIER
}

/**
 * {cost, maxProfit, maxLoss, breakevens}. The curve is piecewise linear with kinks at
 * the strikes, so its extremes are at 0, a strike, or the tail; an unbounded tail is
 * reported as Infinity, never as the edge of whatever range was drawn.
 */
export function summary(legs) {
  const ks = [...new Set(legs.map((l) => l.strike))].sort((a, b) => a - b)
  const pts = [0, ...ks]
  const vals = pts.map((s) => pnlAt(legs, s))
  const top = ks[ks.length - 1]
  const tailSlope = pnlAt(legs, top + 1) - pnlAt(legs, top)
  let maxProfit = Math.max(...vals, pnlAt(legs, top + 1))
  let maxLoss = Math.min(...vals, pnlAt(legs, top + 1))
  if (tailSlope > 1e-9) maxProfit = Infinity
  if (tailSlope < -1e-9) maxLoss = -Infinity
  // breakevens: sign changes between consecutive kink points, plus the tail
  const xs = [...pts, top + Math.max(1, top)]
  const ys = xs.map((s) => pnlAt(legs, s))
  const breakevens = []
  for (let i = 0; i < xs.length - 1; i += 1) {
    const [x0, x1, y0, y1] = [xs[i], xs[i + 1], ys[i], ys[i + 1]]
    if (y0 === 0 && i > 0) breakevens.push(x0)
    else if ((y0 < 0 && y1 > 0) || (y0 > 0 && y1 < 0)) breakevens.push(x0 + (x1 - x0) * (-y0 / (y1 - y0)))
  }
  return {
    cost: netCost(legs),
    maxProfit,
    maxLoss,
    breakevens: [...new Set(breakevens.map((b) => Math.round(b * 100) / 100))],
  }
}

/** Sample the curve for drawing: n points across [lo, hi]. */
export function curve(legs, lo, hi, n = 81) {
  const out = []
  for (let i = 0; i < n; i += 1) {
    const s = lo + ((hi - lo) * i) / (n - 1)
    out.push([s, pnlAt(legs, s)])
  }
  return out
}
