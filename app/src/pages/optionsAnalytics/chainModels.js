// lane/o-options-remainders — the chain-side models that COMPUTE IN THE BROWSER over the chain the
// Research > Options tab already holds. Their words live server-side
// (api/services/options_analytics/chain_models.py: PAYOFF_MODEL, FINDER_MODEL, GREEKS_MODEL) and the
// panels print those words; the arithmetic is here.
//
//   FT-001  todayPnl / popAtExpiry / probBelow / priceSlices   (the payoff panel's "today at IV")
//   FT-014  findStrategies                                       (the per-underlying strategy finder)
//   FT-015  extraGreeks                                          (rho / lambda / epsilon)
//
// ⛔ Every number is computed: Black-Scholes, European exercise, zero rate, no dividends. Inputs that
//    are the vendor's (quote, IV) are the vendor's.
// ⛔ A leg without a two-sided quote, or without a vendor IV where one is needed, has no value:
//    the model returns null and says so, never a stand-in.
// ⛔ Read-only: nothing here places, stages or sends an order. A candidate is arithmetic.
// Pure; no React.

import { price, cdf } from './blackScholes'
import { mid, pnlAt, summary, MULTIPLIER } from '../research/tabs/optionPayoff'

// ── FT-001 ──────────────────────────────────────────────────────────────────────

/** P/L in dollars TODAY at underlying price s: every leg valued by Black-Scholes at its own vendor IV
 * with `days` to expiry, minus the mid it was priced at. null when any leg has no IV. */
export function todayPnl(legs, s, days) {
  let v = 0
  for (const l of legs) {
    if (!(Number(l.iv) > 0)) return null
    const p = price({ type: l.type, S: s, K: l.strike, iv: Number(l.iv), days })
    if (!p) return null
    v += l.side * (p.price - l.premium)
  }
  return v * MULTIPLIER
}

/** P(S_T < k) under a driftless (zero-rate) lognormal at `iv` over `days`. */
export function probBelow(k, spot, iv, days) {
  if (!(k > 0) || !(spot > 0) || !(iv > 0) || !(days > 0)) return null
  const st = iv * Math.sqrt(days / 365)
  return cdf((Math.log(k / spot) + 0.5 * st * st) / st)
}

/** Probability the position finishes in profit at expiration (lognormal at `iv`, no drift). The P/L at
 * expiry is piecewise linear, so the sign is constant between breakevens: the mass of each profitable
 * interval is summed exactly, never sampled. */
export function popAtExpiry(legs, spot, iv, days) {
  if (!(iv > 0) || !(days > 0) || !(spot > 0)) return null
  const bes = summary(legs).breakevens.filter((b) => b > 0).sort((a, b) => a - b)
  const edges = [0, ...bes, Infinity]
  let p = 0
  for (let i = 0; i < edges.length - 1; i += 1) {
    const lo = edges[i]
    const hi = edges[i + 1]
    const probe = hi === Infinity ? Math.max(lo * 2, lo + 1, spot * 3) : (lo + hi) / 2
    if (pnlAt(legs, probe) > 0) {
      const cHi = hi === Infinity ? 1 : probBelow(hi, spot, iv, days)
      const cLo = lo === 0 ? 0 : probBelow(lo, spot, iv, days)
      p += cHi - cLo
    }
  }
  return Math.min(1, Math.max(0, p))
}

/** The price-slice table: n prices evenly across [lo, hi], each with P/L today, P/L at expiry and the
 * modelled chance of finishing below it. */
export function priceSlices(legs, { lo, hi, days, spot, iv, n = 7 }) {
  const out = []
  for (let i = 0; i < n; i += 1) {
    const s = lo + ((hi - lo) * i) / (n - 1)
    out.push({ price: s, today: todayPnl(legs, s, days), expiry: pnlAt(legs, s), below: probBelow(s, spot, iv, days) })
  }
  return out
}

// ── FT-015 ──────────────────────────────────────────────────────────────────────

/** {rho, lambda, epsilon} for one quote, or nulls with the vendor IV / mid absent.
 * rho and epsilon are per 1-point (1 percentage point) move in the rate / dividend yield. */
export function extraGreeks(q, spot, days) {
  const none = { rho: null, lambda: null, epsilon: null }
  const iv = Number(q?.iv)
  const K = Number(q?.strike)
  if (!(iv > 0) || !(K > 0) || !(spot > 0) || !(days > 0)) return none
  const t = days / 365
  const st = iv * Math.sqrt(t)
  const d1 = (Math.log(spot / K) + 0.5 * iv * iv * t) / st
  const d2 = d1 - st
  const call = q.type === 'call'
  const rho = (call ? K * t * cdf(d2) : -K * t * cdf(-d2)) / 100
  const epsilon = (call ? -spot * t * cdf(d1) : spot * t * cdf(-d1)) / 100
  const m = mid(q)
  const delta = call ? cdf(d1) : cdf(d1) - 1
  const lambda = m == null ? null : (delta * spot) / m
  return { rho, lambda, epsilon }
}

// ── FT-014 ──────────────────────────────────────────────────────────────────────

export const VIEWS = ['bullish', 'bearish', 'neutral', 'volatile']
const NEAR = 3  // strikes either side of the money each structure is built from

function legOf(rows, type, side, strike) {
  const q = rows.find((r) => r.strike === strike)?.[type]
  return { type, side, strike, premium: mid(q), iv: q?.iv ?? null, expiration: q?.expiration ?? null }
}

function structures(view, ks, a) {
  // ks: sorted strikes; a: index of the at-the-money strike
  const at = (i) => ks[i]
  const ok = (...is) => is.every((i) => i >= 0 && i < ks.length)
  const out = []
  const around = []
  for (let d = -NEAR; d <= NEAR; d += 1) if (ok(a + d)) around.push(a + d)
  if (view === 'bullish') {
    for (const i of around) out.push(['Long call', [['call', 1, at(i)]]])
    for (const i of around) if (ok(i + 1)) out.push(['Bull call spread', [['call', 1, at(i)], ['call', -1, at(i + 1)]]])
    for (const i of around) if (ok(i - 1)) out.push(['Bull put spread', [['put', -1, at(i)], ['put', 1, at(i - 1)]]])
  } else if (view === 'bearish') {
    for (const i of around) out.push(['Long put', [['put', 1, at(i)]]])
    for (const i of around) if (ok(i - 1)) out.push(['Bear put spread', [['put', 1, at(i)], ['put', -1, at(i - 1)]]])
    for (const i of around) if (ok(i + 1)) out.push(['Bear call spread', [['call', -1, at(i)], ['call', 1, at(i + 1)]]])
  } else if (view === 'neutral') {
    for (let w = 1; w <= NEAR; w += 1) {
      if (ok(a - w - 1, a + w + 1)) {
        out.push(['Iron condor', [['put', 1, at(a - w - 1)], ['put', -1, at(a - w)], ['call', -1, at(a + w)], ['call', 1, at(a + w + 1)]]])
      }
      if (ok(a - w, a + w)) {
        out.push(['Iron butterfly', [['put', 1, at(a - w)], ['put', -1, at(a)], ['call', -1, at(a)], ['call', 1, at(a + w)]]])
      }
    }
    out.push(['Short straddle', [['put', -1, at(a)], ['call', -1, at(a)]]])
  } else if (view === 'volatile') {
    out.push(['Long straddle', [['put', 1, at(a)], ['call', 1, at(a)]]])
    for (let w = 1; w <= NEAR; w += 1) if (ok(a - w, a + w)) out.push(['Long strangle', [['put', 1, at(a - w)], ['call', 1, at(a + w)]]])
  }
  return out
}

/** Candidates for one view off the chain rows. Returns {candidates, skipped}: a structure with any leg
 * lacking a two-sided quote is left out and COUNTED. sort: 'pop' | 'reward'. */
export function findStrategies(view, rows, { spot, iv, days, sort = 'pop' } = {}) {
  const ks = rows.map((r) => r.strike).filter((k) => k != null).sort((x, y) => x - y)
  if (!ks.length || !(spot > 0)) return { candidates: [], skipped: 0 }
  let a = 0
  ks.forEach((k, i) => { if (Math.abs(k - spot) < Math.abs(ks[a] - spot)) a = i })
  const candidates = []
  let skipped = 0
  for (const [name, spec] of structures(view, ks, a)) {
    const legs = spec.map(([t, s, k]) => legOf(rows, t, s, k))
    if (legs.some((l) => l.premium == null)) { skipped += 1; continue }
    const s = summary(legs)
    const risk = s.maxLoss === -Infinity ? null : -s.maxLoss
    const reward = s.maxProfit === Infinity ? null : s.maxProfit
    candidates.push({
      name, legs, ...s, pop: popAtExpiry(legs, spot, iv, days),
      rewardToRisk: risk && risk > 0 && reward != null ? reward / risk : null,
      undefinedRisk: s.maxLoss === -Infinity,
    })
  }
  const key = sort === 'reward'
    ? (c) => (c.rewardToRisk == null ? (c.maxProfit === Infinity ? Infinity : -1) : c.rewardToRisk)
    : (c) => (c.pop == null ? -1 : c.pop)
  candidates.sort((x, y) => key(y) - key(x) || x.cost - y.cost)
  return { candidates, skipped }
}
