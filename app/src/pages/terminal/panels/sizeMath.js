// SIZE: the position-size and R arithmetic, pure (wave 7, lane D). No reads, no state.
//
// One rule: risk a fixed share of the account between entry and stop.
//   risk budget  = account x risk%
//   per-share R  = |entry - stop|
//   shares       = floor(risk budget / per-share R)        (never rounds UP past the budget)
//   $ at risk    = shares x per-share R                    (<= the budget)
//   position     = shares x entry, and its % of the account
//   targets      = entry +/- k x per-share R for k = 1, 2, 3 (+ for a long, - for a short)
//
// A long needs its stop BELOW the entry and a short needs it ABOVE; anything else is refused with
// a sentence, never sized.

import { formatCurrency } from '../../../lib/presentation/presentationPrimitives'

export const R_MULTIPLES = Object.freeze([1, 2, 3])
export const DEFAULT_RISK_PCT = 1

/** A typed field as a number, or null when it is blank or not a number. */
export function parseNum(v) {
  if (v === null || v === undefined) return null
  const t = String(v).replace(/[$,%\s]/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * The entry / stop half of the validation, on its own: `{ ok: true, entry, stop }` or
 * `{ ok: false, error }`. A long needs the stop below the entry, a short above. SIZE and CHK both
 * read it, so a stop on the wrong side is refused with the same sentence everywhere.
 */
export function checkLevels({ entry, stop, side = 'long' }) {
  const E = parseNum(entry)
  const S = parseNum(stop)
  if (E === null || E <= 0) return { ok: false, error: 'Enter an entry price above zero.' }
  if (S === null || S <= 0) return { ok: false, error: 'Enter a stop price above zero.' }
  if (side === 'short') {
    if (S <= E) return { ok: false, error: 'For a short, the stop must be above the entry. Pick Long if the stop is below.' }
  } else if (S >= E) {
    return { ok: false, error: 'For a long, the stop must be below the entry. Pick Short if the stop is above.' }
  }
  return { ok: true, entry: E, stop: S }
}

/**
 * `{ ok: true, ... }` with every output, or `{ ok: false, error }` with the one sentence that says
 * what to fix. `side` is 'long' or 'short'.
 */
export function computeSize({ account, riskPct, entry, stop, side = 'long' }) {
  const A = parseNum(account)
  const r = parseNum(riskPct)
  const E = parseNum(entry)
  const S = parseNum(stop)
  if (A === null || A <= 0) return { ok: false, error: 'Enter an account size above zero.' }
  if (r === null || r <= 0 || r > 100) return { ok: false, error: 'Enter a risk percent above 0 and at most 100.' }
  const levels = checkLevels({ entry: E, stop: S, side })
  if (!levels.ok) return levels
  const perShare = Math.abs(E - S)
  const budget = (A * r) / 100
  const shares = Math.floor(budget / perShare + 1e-9)
  if (shares < 1) {
    return { ok: false, error: `The risk budget (${formatCurrency(budget)}) is smaller than one share's risk (${formatCurrency(perShare)}). Widen the risk or tighten the stop.` }
  }
  const dollarRisk = shares * perShare
  const position = shares * E
  const dir = side === 'short' ? -1 : 1
  const targets = R_MULTIPLES.map((k) => {
    const price = E + dir * k * perShare
    return { r: k, price: price > 0 ? price : null, profit: price > 0 ? shares * k * perShare : null }
  })
  return {
    ok: true,
    side: side === 'short' ? 'short' : 'long',
    shares,
    perShare,
    budget,
    dollarRisk,
    riskPctActual: (dollarRisk / A) * 100,
    position,
    positionPct: (position / A) * 100,
    stopPct: (perShare / E) * 100,
    overAccount: position > A,
    targets,
  }
}
