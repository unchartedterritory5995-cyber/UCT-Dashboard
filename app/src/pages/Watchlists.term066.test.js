// TERM-066 -- the watchlist's volume and dollar-volume columns moved their K/M/B/T decision
// onto lib/presentation's formatCompact. FROZEN ORACLES: the pre-migration bodies, copied
// verbatim, run in process against the exported formatters over a sampled range.
import { describe, it, expect } from 'vitest'
import { fmtVol, fmtDolVol } from './Watchlists'

// ── the pre-migration bodies (verbatim) ──────────────────────────────────
function oldFmtDolVol(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1e12) return `$${(v / 1e12).toFixed(1)}T`
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}
function oldFmtVol(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e5 ? 0 : 1) + 'K'
  return String(v)
}

const positives = (() => {
  const out = [0, 1, 7, 999, 1000, 99_949, 99_950, 99_999, 100_000, 999_499, 999_500, 999_999, 1_000_000]
  for (let e = 0; e <= 13.6; e += 0.091) {
    const b = 10 ** e
    out.push(Math.round(b), Math.round(b * 1.0049), Math.round(b * 0.9951), Math.round(b * 9.995), b * 3.33, b * 1.2345)
  }
  return out
})()
const negatives = positives.filter((v) => v > 0).map((v) => -v)
const junk = [null, undefined, NaN, Infinity, -Infinity, '2500']

describe('watchlist volume columns: byte-identical where they must be (TERM-066)', () => {
  it('fmtVol, every value', () => {
    for (const v of [...positives, ...negatives, ...junk]) expect([v, fmtVol(v)]).toEqual([v, oldFmtVol(v)])
  })
  it('fmtDolVol, every non-negative value and the sub-$1K negatives', () => {
    const values = [...positives, ...negatives.filter((v) => v > -1e3), ...junk]
    for (const v of values) expect([v, fmtDolVol(v)]).toEqual([v, oldFmtDolVol(v)])
  })
})

describe('pinned edge decision (TERM-066)', () => {
  it('a negative dollar volume at K and above puts the "$" inside the minus', () => {
    expect(oldFmtDolVol(-1.5e9)).toBe('$-1.5B')
    expect(fmtDolVol(-1.5e9)).toBe('-$1.5B')
    expect(fmtDolVol(-25e3)).toBe('-$25K')
  })
})
