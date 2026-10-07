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
import { fmtRev } from './CalendarWidget'
import { fmtVol as liVol } from './LeverageInverseControl'
import { fmt as flowFmt } from './OptionsFlowWidget'
import { abbrev } from './ScatterWidget'
import { fmtDollar } from './VolumeScanWidget'

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
function oldFmtRev(m) {
  const n = Number(m)
  if (!Number.isFinite(n)) return '—'
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}B`
  if (n >= 10) return `$${Math.round(n)}M`
  return `$${n.toFixed(1)}M`
}
const oldLiVol = (v) => v == null ? '—'
  : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B/d`
  : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M/d`
  : `$${(v / 1e3).toFixed(0)}K/d`
function oldFlowFmt(n) {
  const a = Math.abs(n || 0)
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${(n || 0).toFixed(0)}`
}
function oldAbbrev(v) {
  const a = Math.abs(v)
  if (a >= 1e12) return (v / 1e12).toFixed(2) + 'T'
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B'
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (a >= 1e3) return (v / 1e3).toFixed(0) + 'K'
  return v.toFixed(0)
}
const oldFmtDollar = (d) => {
  if (typeof d !== 'number' || d <= 0) return ''
  if (d >= 1e6) return `$${(d / 1e6).toFixed(1)}M`
  if (d >= 1e3) return `$${Math.round(d / 1e3)}K`
  return `$${Math.round(d)}`
}

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
    // revenue in MILLIONS: the B tier starts at 1,000 of them
    ['CalendarWidget.fmtRev', fmtRev, oldFmtRev, [...positives, ...positives.map((v) => v / 1e3), ...negatives, null, undefined, '', 'abc', '2500', Infinity]],
    // avg dollar volume is never below $1K/day on a listed fund; below it the old K was "$0K"
    ['LeverageInverseControl.fmtVol', liVol, oldLiVol, [...positives.filter((v) => v >= 1e3), null, undefined, '2500000']],
    ['OptionsFlowWidget.fmt', flowFmt, oldFlowFmt, [...positives, ...negatives.filter((v) => v > -1e3), null, undefined, NaN, '2500000']],
    ['ScatterWidget.abbrev', abbrev, oldAbbrev, [...positives, ...negatives, NaN]],
    ['VolumeScanWidget.fmtDollar', fmtDollar, oldFmtDollar, [...positives, ...negatives, null, undefined, '2500']],
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

  it('leveraged-fund dollar volume: whole dollars below $1K, the minus outside the "$", a dash for a non-number', () => {
    expect(oldLiVol(400)).toBe('$0K/d')
    expect(liVol(400)).toBe('$400/d')
    expect(oldLiVol(0)).toBe('$0K/d')
    expect(liVol(0)).toBe('$0/d')
    expect(oldLiVol(-5e6)).toBe('$-5000K/d')
    expect(liVol(-5e6)).toBe('-$5.0M/d')
    expect(oldLiVol('abc')).toBe('$NaNK/d')
    expect(liVol('abc')).toBe('—')
    expect(liVol(Infinity)).toBe('—')
  })

  it('a negative flow premium puts the "$" inside the minus; a non-number string is the dash', () => {
    expect(oldFlowFmt(-2.5e6)).toBe('$-2.5M')
    expect(flowFmt(-2.5e6)).toBe('-$2.5M')
    expect(flowFmt(-25e3)).toBe('-$25K')
    expect(() => oldFlowFmt('abc')).toThrow()
    expect(flowFmt('abc')).toBe('—')
  })

  it('an infinite map value is the dash, not "InfinityT"', () => {
    expect(oldAbbrev(Infinity)).toBe('InfinityT')
    expect(abbrev(Infinity)).toBe('—')
  })

  it('an infinite or NaN one-minute dollar figure prints nothing (the line\'s own missing rule)', () => {
    expect(oldFmtDollar(Infinity)).toBe('$InfinityM')
    expect(fmtDollar(Infinity)).toBe('')
    expect(oldFmtDollar(NaN)).toBe('$NaN')
    expect(fmtDollar(NaN)).toBe('')
  })
})
