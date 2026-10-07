// TERM-066 -- the Screener's K/M/B/T columns moved onto lib/presentation's formatCompact, each on
// the ladder it already had. FROZEN ORACLES: the pre-migration bodies, copied verbatim, run in
// process against the new formatters over the domain a real row carries. The handful of values
// no row carries (sub-tier amounts, a negative enterprise value, NaN) are pinned separately so a
// change there is a decision, not drift.
import { describe, it, expect } from 'vitest'
import { COLUMN_DEFS } from './columnDefs'

// ── the pre-migration bodies (verbatim) ──────────────────────────────────
const oldCap = v => v == null ? '—'
  : v >= 1e12 ? `$${(v / 1e12).toFixed(1)}T`
  : v >= 1e9 ? `$${(v / 1e9).toFixed(0)}B`
  : `$${(v / 1e6).toFixed(0)}M`
const oldDollarVol = v => v == null ? '—'
  : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B`
  : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M`
  : `$${(v / 1e3).toFixed(0)}K`
const oldShares = v => v == null ? '—'
  : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M`
  : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K`
  : `${v}`
const oldNetUsd = v => {
  if (v == null) return '—'
  const a = Math.abs(v)
  const s = a >= 1e9 ? `$${(a / 1e9).toFixed(1)}B`
    : a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M`
    : `$${(a / 1e3).toFixed(0)}K`
  return `${v < 0 ? '-' : '+'}${s}`
}

const sample = (lo, hi) => {
  const out = [lo, hi]
  for (let e = Math.log10(lo); e <= Math.log10(hi); e += 0.137) {
    const b = 10 ** e
    out.push(Math.round(b), Math.round(b * 1.0049), Math.round(b * 0.9951), Math.round(b * 4.5), Math.round(b * 9.995))
  }
  return out.filter((v) => v >= lo && v <= hi)
}

describe('Screener compact columns: byte-identical on every value a row carries', () => {
  it.each([
    ['market_cap', oldCap, sample(1e6, 5e13)],
    ['enterprise_value', oldCap, sample(1e6, 5e13)],
    ['dollar_vol_30d', oldDollarVol, sample(1e3, 5e12)],
    ['dp_notional_1d', oldDollarVol, sample(1e3, 5e12)],
    ['avg_volume_30d', oldShares, [0, 1, 7, 999, ...sample(1e3, 5e10)]],
    ['shares_outstanding', oldShares, sample(1e3, 5e10)],
    ['opt_net_premium_1d', oldNetUsd, [...sample(1e3, 5e11), ...sample(1e3, 5e11).map((v) => -v)]],
    ['working_capital', oldNetUsd, [...sample(1e3, 5e11), ...sample(1e3, 5e11).map((v) => -v)]],
  ])('%s', (key, oracle, values) => {
    const fmt = COLUMN_DEFS[key].fmt
    for (const v of [null, ...values]) expect([v, fmt(v)]).toEqual([v, oracle(v)])
  })
})

describe('the values no row carries, pinned (a change here is a decision)', () => {
  it('a negative enterprise value keeps its magnitude and puts the sign outside the "$"', () => {
    expect(oldCap(-5e9)).toBe('$-5000M')
    expect(COLUMN_DEFS.enterprise_value.fmt(-5e9)).toBe('-$5B')
  })
  it('a non-number is an em dash, never "$NaNM"', () => {
    expect(COLUMN_DEFS.market_cap.fmt(NaN)).toBe('—')
    expect(COLUMN_DEFS.dollar_vol_30d.fmt(NaN)).toBe('—')
  })
  it('below the smallest tier the amount is whole units, not "0K" / "0M"', () => {
    expect(COLUMN_DEFS.market_cap.fmt(450000)).toBe('$450000')
    expect(COLUMN_DEFS.dollar_vol_30d.fmt(400)).toBe('$400')
    expect(COLUMN_DEFS.opt_net_premium_1d.fmt(-400)).toBe('-$400')
  })
})
