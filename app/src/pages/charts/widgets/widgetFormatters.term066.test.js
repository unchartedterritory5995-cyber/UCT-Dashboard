// TERM-066 -- the chart-board widgets' K/M/B/T formatters moved their suffix decision onto
// lib/presentation's formatCompact. FROZEN ORACLES: the pre-migration bodies, copied verbatim,
// run in process against the exported formatters over a sampled range. Where the old output
// was wrong at an edge (a sign outside the "$", "$NaN", ...) the new output is PINNED below as
// a decision, and the oracle sweep is limited to the values where the two must agree.
import { describe, it, expect } from 'vitest'
import { fmtMoney as csMoney, fmtShares as csShares } from './CompanySearch'
import { fmtMoney as btMoney } from './BusinessTrend'
import { fmtSales } from './FundamentalsWidget'
import { compactInt } from './DockProfile'

// ── the pre-migration bodies (verbatim) ──────────────────────────────────
function oldCsMoney(v) {
  if (v == null) return '—'
  const a = Math.abs(v), s = v < 0 ? '-' : ''
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`
  return `${s}$${a.toFixed(0)}`
}
const oldCsShares = (v) => (v == null ? '—' : Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${v}`)
const oldBtMoney = (v) => {
  const a = Math.abs(v)
  if (a >= 1e12) return `${v < 0 ? '-' : ''}$${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${v < 0 ? '-' : ''}$${(a / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${v < 0 ? '-' : ''}$${(a / 1e6).toFixed(0)}M`
  return `${v < 0 ? '-' : ''}$${a.toFixed(0)}`
}
function oldFmtSales(v) {
  if (v == null) return '—'
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(0)}M`
  return `$${v}`
}
const oldCompactInt = (v) => (v == null ? '—' : v >= 1000 ? `${Math.round(v / 1000)}K` : String(v))

// 0..~4e13, dense around every tier edge (x.xx49 / x.x95 rounding boundaries included).
const positives = (() => {
  const out = [0, 1, 7, 999, 1000, 999_499, 999_500, 999_949, 999_950, 999_999, 1_000_000]
  for (let e = 0; e <= 13.6; e += 0.091) {
    const b = 10 ** e
    out.push(Math.round(b), Math.round(b * 1.0049), Math.round(b * 0.9951), Math.round(b * 9.995), b * 3.33, b * 1.2345)
  }
  return out
})()
const negatives = positives.filter((v) => v > 0).map((v) => -v)

describe('chart-board widget formatters: byte-identical where they must be (TERM-066)', () => {
  it.each([
    ['CompanySearch.fmtMoney', csMoney, oldCsMoney, [...positives, ...negatives, null, undefined]],
    ['CompanySearch.fmtShares', csShares, oldCsShares, [...positives, ...negatives, null, undefined, 'abc', '2500000000']],
    ['BusinessTrend.fmtMoney', btMoney, oldBtMoney, [...positives, ...negatives, null]],
    // a sales/revenue figure below the M tier keeps its raw "$<v>" body, both signs
    ['FundamentalsWidget.fmtSales', fmtSales, oldFmtSales, [...positives, ...negatives.filter((v) => v > -1e6), null, undefined]],
    ['DockProfile.compactInt', compactInt, oldCompactInt, [...positives, ...negatives, null, undefined, '2500', 'abc']],
  ])('%s', (_name, now, before, values) => {
    for (const v of values) expect([v, now(v)]).toEqual([v, before(v)])
  })
})

describe('pinned edge decisions (TERM-066): the old output here was not a number a member could read', () => {
  it('a non-number is the em dash, never "$NaN"', () => {
    expect(oldCsMoney('abc')).toBe('$NaN')
    expect(csMoney('abc')).toBe('—')
    expect(oldBtMoney(NaN)).toBe('$NaN')
    expect(btMoney(NaN)).toBe('—')
    expect(oldFmtSales(NaN)).toBe('$NaN')
    expect(fmtSales(NaN)).toBe('—')
    expect(oldFmtSales('abc')).toBe('$abc')
    expect(fmtSales('abc')).toBe('—')
  })

  it('a negative sales figure at M and above puts the "$" inside the minus', () => {
    expect(oldFmtSales(-2.5e9)).toBe('$-2.5B')
    expect(fmtSales(-2.5e9)).toBe('-$2.5B')
    expect(fmtSales(-1.25e12)).toBe('-$1.25T')
    expect(fmtSales(-45e6)).toBe('-$45M')
  })

  it('an infinite employee count is the em dash', () => {
    expect(oldCompactInt(Infinity)).toBe('InfinityK')
    expect(compactInt(Infinity)).toBe('—')
  })
})
