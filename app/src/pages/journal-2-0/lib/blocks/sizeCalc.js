// The position size calculator's arithmetic (Notebook widgets wave 10, Task 10.20, ruling W10-R8). Pure: no React,
// no network, nothing read from anywhere but the arguments. Distinct from houseSizing.js (the HOUSE formula with its
// grade and regime ceilings): this is the plain risk-per-trade calculator a member drives with their own numbers.
//   shares = floor(accountSize × riskPct / 100 / |entry − stop|)
// A missing or impossible input is a sentence, never a guessed number, and fewer than one share is its own sentence,
// never "0 shares". Lazy: only SizeCalcBlock imports this, inside the block's own chunk.
import { roundPct } from './houseSizing'

/** The most a member may risk on one trade here, as a percent of the account. */
export const RISK_PCT_MAX = 10

/** Every refusal, in the words the block shows. */
export const REASONS = Object.freeze({
  levels: 'Enter an entry and a stop.',
  same: "Entry and stop can't be the same.",
  risk: `Enter the risk per trade, up to ${RISK_PCT_MAX}%.`,
  account: 'Set your account size, or enter one for this note.',
  underOne: 'Your risk is smaller than one share at this stop.',
})

const positive = (x) => {
  if (x === '' || x == null || typeof x === 'boolean') return null
  const n = Number(x)
  return Number.isFinite(n) && n > 0 ? n : null
}
const fail = (reason) => ({ ok: false, reason })
/** Whole shares, rounded down, after snapping float noise off the quotient (1.10 - 1.00 is 0.10000000000000009). */
const wholeShares = (q) => Math.max(0, Math.floor(Math.round(q * 1e6) / 1e6))
const cents = (x) => Math.round(x * 100) / 100

/** `part` as a percent of `whole`, to two places (half up); null when there is no whole to divide by. */
export function pctOf(part, whole) {
  const w = positive(whole)
  const p = Number(part)
  if (w == null || !Number.isFinite(p)) return null
  return roundPct((p / w) * 100)
}

/**
 * One trade's size.
 * @returns {{ok: true, shares: number, riskDollars: number, positionValue: number, positionPct: number,
 *            side: 'long'|'short'} | {ok: false, reason: string}}
 */
export function sizeFor({ entry, stop, riskPct, accountSize } = {}) {
  const e = positive(entry)
  const s = positive(stop)
  if (e == null || s == null) return fail(REASONS.levels)
  if (e === s) return fail(REASONS.same)
  const r = positive(riskPct)
  if (r == null || r > RISK_PCT_MAX) return fail(REASONS.risk)
  const a = positive(accountSize)
  if (a == null) return fail(REASONS.account)
  const perShare = Math.abs(e - s)                       // > 0: entry === stop was refused above
  const shares = wholeShares((a * r) / 100 / perShare)
  if (shares < 1) return fail(REASONS.underOne)
  const positionValue = cents(shares * e)
  return {
    ok: true,
    shares,
    riskDollars: cents(shares * perShare),
    positionValue,
    positionPct: pctOf(positionValue, a),
    side: s < e ? 'long' : 'short',
  }
}
