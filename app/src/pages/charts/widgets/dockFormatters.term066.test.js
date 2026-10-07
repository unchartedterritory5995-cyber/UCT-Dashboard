// TERM-066 -- the chart dock's money / share / growth formatters moved their K/M/B/T decision onto
// lib/presentation's formatCompact. FROZEN ORACLES: the pre-migration bodies, copied verbatim,
// run in process against the exported formatters over a sampled range, both signs.
import { describe, it, expect } from 'vitest'
import { fmtSales, fmtPct } from './earningsRows'
import { fmtShares, fmtMoney } from './ownershipModel'
import { stripSales } from './chartEarningsStripModel'

// ── the pre-migration bodies (verbatim) ──────────────────────────────────
function oldFmtSales(v) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  const a = Math.abs(n)
  const s = n < 0 ? '-' : ''
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(0)}M`
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`
  return `${s}$${a.toFixed(0)}`
}
function oldFmtPct(v, decimals = 0) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  const a = Math.abs(n)
  if (a >= 1000) return `${sign}${(a / 1000).toFixed(1)}K%`
  return `${sign}${a.toFixed(decimals)}%`
}
const num = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
function oldFmtShares(v) {
  const n = num(v)
  if (n == null) return '—'
  const a = Math.abs(n)
  const s = n < 0 ? '−' : ''
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(0)}K`
  return `${s}${a.toFixed(0)}`
}
function oldFmtMoney(v) {
  const n = num(v)
  if (n == null) return '—'
  const a = Math.abs(n)
  const s = n < 0 ? '−' : ''
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`
  return `${s}$${a.toFixed(0)}`
}
function oldStripSales(v) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  const a = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(1)}T`
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${sign}$${Math.round(a / 1e6)}M`
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}K`
  return `${sign}$${Math.round(a)}`
}

const values = (() => {
  const out = [null, undefined, '', 'abc', 0, 1, 7, 999, 1000, 999_499, 999_500, 999_999]
  for (let e = 0; e <= 13.6; e += 0.091) {
    const b = 10 ** e
    out.push(Math.round(b), Math.round(b * 1.0049), Math.round(b * 0.9951), Math.round(b * 9.995), b * 3.33)
  }
  return [...out, ...out.filter((v) => typeof v === 'number' && v > 0).map((v) => -v)]
})()

describe('chart dock formatters: byte-identical to the hand-rolled versions (TERM-066)', () => {
  it.each([
    ['earningsRows.fmtSales', fmtSales, oldFmtSales],
    ['earningsRows.fmtPct', fmtPct, oldFmtPct],
    ['ownershipModel.fmtShares', fmtShares, oldFmtShares],
    ['ownershipModel.fmtMoney', fmtMoney, oldFmtMoney],
    ['chartEarningsStripModel.stripSales', stripSales, oldStripSales],
  ])('%s', (_name, now, before) => {
    for (const v of values) expect([v, now(v)]).toEqual([v, before(v)])
  })

  it('fmtPct keeps its decimals argument below the K tier', () => {
    for (const v of [12.345, -0.5, 999.9]) expect(fmtPct(v, 1)).toBe(oldFmtPct(v, 1))
  })
})
