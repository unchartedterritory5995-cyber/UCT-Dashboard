// app/src/lib/presentation/compactAdoptionBatch2.test.js
//
// ─── TERM-066 · BATCH 2 · SEVEN MORE K/M/B/T LADDERS ONTO formatCompact, BYTE-IDENTICAL ─
//
//     components/research/sections/statementSeries.js   money
//     components/chart/chartScreenshot.js               _fmtVol
//     components/chart/headerFields.js                  fmtVol · fmtDolVol
//     pages/charts/widgets/ownershipModel.js            fmtShares · fmtMoney
//     components/research/QuoteStrip.jsx                fmtVol
//
// ⛔ THE EXPECTED STRINGS ARE COMPUTED BY THE FROZEN PRE-MIGRATION CODE, NEVER
// TYPED. Each `ORACLE_*` is the retired body copied VERBATIM from a4389e3b2a —
// the same idiom as `compactAdoption.test.jsx` (batch 1). Every one of these was
// chosen because its own guard already rejects a non-finite value BEFORE the
// ladder, which is the one input formatCompact answers differently (`absent`
// instead of "InfinityT").
//
// ⛔ NO LADDER WAS MOVED ONTO ANOTHER'S RULE. Each call site passes the tiers it
// already had; where a site's sub-1K branch or its tier gate differs from
// formatCompact's (raw `${+v}`, toFixed on a signed value, a SIGNED gate) that
// branch stays at the site and only the ladder moved.

import { describe, it, expect } from 'vitest'

import { money } from '../../components/research/sections/statementSeries'
import { _fmtVol } from '../../components/chart/chartScreenshot'
import { fmtVol as headerFmtVol, fmtDolVol } from '../../components/chart/headerFields'
import { fmtShares, fmtMoney } from '../../pages/charts/widgets/ownershipModel'
import { fmtVol as quoteFmtVol } from '../../components/research/QuoteStrip'
import { toNum } from '../../components/research-kit'

// ── the frozen oracles (verbatim, a4389e3b2a) ───────────────────────────────

function ORACLE_money(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  const n = Number(v)
  const a = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`
  return `${sign}$${a.toFixed(0)}`
}

function ORACLE_screenshotFmtVol(v) {
  if (v == null || !Number.isFinite(+v)) return '—';
  const n = Math.abs(+v);
  if (n >= 1e9) return `${(+v / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(+v / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(+v / 1e3).toFixed(1)}K`;
  return `${+v}`;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v))
function ORACLE_headerFmtVol(v) {
  if (!num(v)) return null
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return String(Math.round(v))
}
function ORACLE_fmtDolVol(v) {
  if (!num(v)) return null
  const a = Math.abs(v)
  if (a >= 1e12) return `$${(v / 1e12).toFixed(1)}T`
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

const ownNum = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
function ORACLE_fmtShares(v) {
  const n = ownNum(v)
  if (n == null) return '—'
  const a = Math.abs(n)
  const s = n < 0 ? '−' : ''
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(0)}K`
  return `${s}${a.toFixed(0)}`
}
function ORACLE_fmtMoney(v) {
  const n = ownNum(v)
  if (n == null) return '—'
  const a = Math.abs(n)
  const s = n < 0 ? '−' : ''
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`
  return `${s}$${a.toFixed(0)}`
}

function ORACLE_quoteFmtVol(v) {
  const x = toNum(v)
  if (x == null) return '—'
  if (x >= 1e9) return `${(x / 1e9).toFixed(2)}B`
  if (x >= 1e6) return `${(x / 1e6).toFixed(2)}M`
  if (x >= 1e3) return `${(x / 1e3).toFixed(1)}K`
  return String(Math.round(x))
}

// ── the fixture (same classes as batch 1: edges, a tier grid, a seeded sweep) ─

const EDGE = [
  undefined, null, '', ' ', 'abc', '12', '1e6', '-2500', '2.5e9', true, false, [], [5], [2e9], {},
  NaN, Infinity, -Infinity, 0, -0,
  0.4, -0.4, 0.5, -0.5, 1, -1, 999, -999, 999.4, 999.5, -999.5, 999.6, 999.95,
  1000, -1000, 1049, 1050, 1449, 1450, 1499, 1500, -1500, 2500, -2500, 9999.5, 10560,
  99_949, 99_950, 999_499, 999_500, 999_949, 999_950, 999_999, -999_999,
  1e6, -1e6, 1_004_999, 1_005_000, 1_234_567, 1_235_000, 1_245_000, 2_072_358,
  9_999_500, 99_995_000, 999_949_999, 999_950_000, 999_995_000, -999_995_000,
  1e9, -1e9, 1_005_000_000, 12_345_678_901, 23.5e9, 25e9, 999_999_999_999,
  1e12, -1e12, 1e15, 1e21, 1.5e21, -1e21,
  Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, Number.MAX_VALUE, Number.MIN_VALUE,
  1e-7, -1e-7, 5e-324,
]

const MANTISSAE = [1, 1.0049, 1.005, 1.0449, 1.045, 1.2345, 1.5, 2.5, 4.995, 9.9949,
  9.995, 9.9995, 9.99949, 9.99995, 9.999999]
const GRID = []
for (let e = 0; e <= 13; e++) {
  for (const m of MANTISSAE) { GRID.push(m * 10 ** e); GRID.push(-m * 10 ** e) }
}

const SWEEP = (() => {
  let s = 0x2066b
  const next = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 2 ** 32 }
  const out = []
  for (let i = 0; i < 4000; i++) {
    const mag = 10 ** Math.floor(next() * 14)
    const v = next() * mag * (next() < 0.25 ? -1 : 1)
    out.push(i % 3 === 0 ? Math.round(v) : v)
  }
  return out
})()

const EXOTIC = [10n, Symbol('x')]
const FIXTURE = [...EDGE, ...GRID, ...SWEEP, ...EXOTIC]

function outcome(fn, v) {
  try { return { value: fn(v) } } catch (e) { return { threw: e?.constructor?.name ?? 'thrown' } }
}

function diff(live, oracle) {
  const out = []
  for (const v of FIXTURE) {
    const got = outcome(live, v)
    const want = outcome(oracle, v)
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      out.push({ v: typeof v === 'symbol' ? 'Symbol' : typeof v === 'bigint' ? `${v}n` : v, got, want })
    }
    if (out.length > 12) break
  }
  return out
}

const PAIRS = [
  ['statementSeries.money', money, ORACLE_money],
  ['chartScreenshot._fmtVol', _fmtVol, ORACLE_screenshotFmtVol],
  ['headerFields.fmtVol', headerFmtVol, ORACLE_headerFmtVol],
  ['headerFields.fmtDolVol', fmtDolVol, ORACLE_fmtDolVol],
  ['ownershipModel.fmtShares', fmtShares, ORACLE_fmtShares],
  ['ownershipModel.fmtMoney', fmtMoney, ORACLE_fmtMoney],
  ['QuoteStrip.fmtVol', quoteFmtVol, ORACLE_quoteFmtVol],
]

describe('TERM-066 batch 2 is byte-identical to the frozen oracles on every input', () => {
  for (const [name, live, oracle] of PAIRS) {
    it(name, () => {
      expect(diff(live, oracle)).toEqual([])
    })
  }

  it('the fixture reaches every tier of every ladder (a sweep that never hit "T" proves nothing about it)', () => {
    const suffixes = (fn) => new Set(FIXTURE.map((v) => outcome(fn, v).value)
      .filter((s) => typeof s === 'string').map((s) => s.slice(-1)))
    expect([...suffixes(money)]).toEqual(expect.arrayContaining(['T', 'B', 'M', 'K']))
    expect([...suffixes(fmtDolVol)]).toEqual(expect.arrayContaining(['T', 'B', 'M', 'K']))
    expect([...suffixes(fmtShares)]).toEqual(expect.arrayContaining(['B', 'M', 'K']))
    expect([...suffixes(quoteFmtVol)]).toEqual(expect.arrayContaining(['B', 'M', 'K']))
  })

  it('pins the rendered strings a member reads (anchor values, typed once)', () => {
    expect(money(-450e6)).toBe('-$450.0M')
    expect(fmtMoney(-1.5e9)).toBe('−$1.50B')
    expect(fmtShares(-2500)).toBe('−3K')
    expect(fmtDolVol(-1.5e9)).toBe('$-1.5B')
    expect(quoteFmtVol(-5000)).toBe('-5000')
    expect(_fmtVol(512.5)).toBe('512.5')
  })
})
