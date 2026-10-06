// app/src/lib/presentation/compactAdoption.test.jsx
//
// ─── TERM-066 · THE MAGNITUDE-SUFFIX BATCH RENDERS BYTE-IDENTICAL BEFORE AND AFTER ─
//
// The batch: the K/M/B suffix formatters in the two shared domain grammars —
//
//     utils/profileFormat.js   fmtVol · fmtRevenue · fmtShares
//     pages/cot/cotFormat.js   fmtCompact (and fmtSignedCompact, which calls it)
//
// move onto `formatCompact` in `lib/presentation/presentationPrimitives.js`.
//
// ⛔ THE EXPECTED STRINGS ARE COMPUTED BY THE FROZEN PRE-TERM-066 CODE, NEVER
// TYPED. Each `ORACLE_*` below is the retired body copied VERBATIM from the tree
// at 73040c87f. Same idiom as `s10Adoption.test.jsx`. A typed expectation can
// only check the cases somebody thought of; an oracle answers for every input
// the sweep throws at it, including the ones nobody would have typed.
//
// ⛔ THE FORMATTERS DISAGREE WITH EACH OTHER, AND THIS BATCH DOES NOT PICK A
// WINNER. fmtVol rounds K to one decimal, fmtShares to none, fmtCompact by
// `Math.round` (which is NOT `toFixed(0)`: -2500 is "-2K" one way and "-3K" the
// other); fmtRevenue carries two decimals on B/M and puts the dollar sign OUTSIDE
// the minus ("$-1.50B"); fmtCompact has no B tier at all, so a billion reads
// "1000.00M". Every one of those is preserved per call site and pinned here.
//
// ⭐ AND THE ASSERTIONS ARE ON RENDERED TEXT TOO (anti-pattern PROD-2): the unit
// sweep proves the functions agree; the render tests prove what a member SEES on
// the two surfaces that call them did not move.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import { fmtVol, fmtRevenue, fmtShares } from '../../utils/profileFormat'
import { fmtCompact, fmtSignedCompact } from '../../pages/cot/cotFormat'
import ProfileSection from '../../components/research/sections/ProfileSection'
import PositioningRail from '../../pages/cot/PositioningRail'

// ── the frozen oracles (verbatim, 73040c87f) ────────────────────────────────

function ORACLE_fmtVol(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${Math.round(n)}`
}

function ORACLE_fmtRevenue(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n === 0) return '—'
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${Math.round(n)}`
}

function ORACLE_fmtShares(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return String(Math.round(n))
}

function ORACLE_fmtCompact(v) {
  if (v == null) return ''
  const abs = Math.abs(v)
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${Math.round(v / 1e3)}K`
  return String(Math.round(v))
}

function ORACLE_fmtSignedCompact(v) {
  if (v == null || v === 0) return '—'
  return `${v > 0 ? '▲' : '▼'} ${ORACLE_fmtCompact(Math.abs(v))}`
}

// ── the fixture: the value classes that bite, plus a boundary grid and a sweep ─

const EDGE = [
  undefined, null, '', ' ', 'abc', '12', '1e6', '-2500', true, false, [], [5], {},
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

// Every tier edge, from both sides, at every magnitude the formatters branch on.
const MANTISSAE = [1, 1.0049, 1.005, 1.0449, 1.045, 1.2345, 1.5, 2.5, 4.995, 9.9949,
  9.995, 9.9995, 9.99949, 9.99995, 9.999999]
const GRID = []
for (let e = 0; e <= 13; e++) {
  for (const m of MANTISSAE) { GRID.push(m * 10 ** e); GRID.push(-m * 10 ** e) }
}

// A deterministic sweep across magnitudes (seeded LCG — the same values every run).
const SWEEP = (() => {
  let s = 0x2066
  const next = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 2 ** 32 }
  const out = []
  for (let i = 0; i < 4000; i++) {
    const mag = 10 ** Math.floor(next() * 14)
    const v = next() * mag * (next() < 0.25 ? -1 : 1)
    out.push(i % 3 === 0 ? Math.round(v) : v)
  }
  return out
})()

// BigInt and Symbol THROW in some of these and not others — the outcome, throw or
// value, is what is compared, so a new formatter that swallows a throw the old
// one raised (or raises one it did not) is a difference too.
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

describe('the batch is byte-identical to the frozen oracles on every input', () => {
  it('fixture is non-trivial', () => {
    expect(FIXTURE.length).toBeGreaterThan(4000)
  })

  it('profileFormat.fmtVol', () => { expect(diff(fmtVol, ORACLE_fmtVol)).toEqual([]) })
  // fmtRevenue's ONE deliberate move: the minus now goes before the "$"
  // ("-$1.50B", not "$-1.50B" -- presentationPrimitives.formatCompact).
  it('profileFormat.fmtRevenue (minus before the "$")', () => {
    const signMoved = (v) => { const s = ORACLE_fmtRevenue(v); return typeof s === 'string' ? (s.startsWith('$-') ? `-$${s.slice(2)}` : s) : s }
    expect(diff(fmtRevenue, signMoved)).toEqual([])
    expect(fmtRevenue(-1_500_000_000)).toBe('-$1.50B')
  })
  it('profileFormat.fmtShares', () => { expect(diff(fmtShares, ORACLE_fmtShares)).toEqual([]) })
  it('cotFormat.fmtCompact', () => { expect(diff(fmtCompact, ORACLE_fmtCompact)).toEqual([]) })
  it('cotFormat.fmtSignedCompact', () => {
    expect(diff(fmtSignedCompact, ORACLE_fmtSignedCompact)).toEqual([])
  })
})

describe('the oracle can actually fail — non-vacuity', () => {
  it('the oracles return real strings, not blanks', () => {
    expect(ORACLE_fmtVol(11_800_000)).toBe('$11.8M')
    expect(ORACLE_fmtRevenue(-1_500_000_000)).toBe('$-1.50B')
    expect(ORACLE_fmtShares(23_500)).toBe('24K')
    expect(ORACLE_fmtCompact(2_072_358)).toBe('2.07M')
    expect(ORACLE_fmtSignedCompact(-5210)).toBe('▼ 5K')
  })

  it('the recorded disagreements are real, so preserving them is not a no-op', () => {
    // K tier: toFixed(1) vs toFixed(0) vs Math.round
    expect(ORACLE_fmtVol(2500)).toBe('$2.5K')
    expect(ORACLE_fmtShares(2500)).toBe('3K')
    expect(ORACLE_fmtCompact(-2500)).toBe('-2K')            // Math.round(-2.5) === -2
    expect((-2.5).toFixed(0)).toBe('-3')                    // …and toFixed would say -3
    // no B tier in the COT grammar
    expect(ORACLE_fmtCompact(1e9)).toBe('1000.00M')
    // the tier is picked BEFORE rounding, so a value can round up past its tier
    expect(ORACLE_fmtVol(999_950)).toBe('$1000.0K')
  })

  it('a deliberately wrong implementation is caught', () => {
    const wrong = (v) => ORACLE_fmtCompact(v).replace('K', 'k')
    expect(diff(wrong, ORACLE_fmtCompact).length).toBeGreaterThan(0)
  })
})

// ── rendered text ───────────────────────────────────────────────────────────

const ok = (body) => ({ ok: true, status: 200, json: async () => body })

describe('rendered: ProfileSection shows the same Float and Avg $ vol text', () => {
  afterEach(() => vi.restoreAllMocks())

  // Values chosen at the tier edges: a K-tier float that rounds up (toFixed(0)),
  // a dollar volume that rounds past its tier, and ordinary large ones.
  const CASES = [
    { float: 23_500, vol: 999_950 },
    { float: 1_049_999, vol: 25e9 },
    { float: 999_500, vol: 1_234_567 },
    { float: 23.5e9, vol: 1500 },
  ]

  for (const { float, vol } of CASES) {
    it(`float ${float} · avg $ vol ${vol}`, async () => {
      globalThis.fetch = vi.fn((url) => {
        const u = String(url)
        if (u.includes('/api/stock-brief/')) return Promise.resolve(ok({
          symbol: 'ZZZ', company: 'Z', status: 'ready',
          stats: { ytd_gain_pct: 1, range_pct: 1, range_dir: 'up', avg_dollar_vol: vol },
          profile: { company_desc: 'Desc.', generated_at: 1755800000 },
        }))
        if (u.includes('/api/fundamentals/')) return Promise.resolve(ok({ float_shares: float }))
        if (u.includes('/api/groups/peers')) return Promise.resolve(ok({ peers: [] }))
        return Promise.resolve({ ok: false, status: 404, json: async () => null })
      })
      render(<ProfileSection sym="ZZZ" />)
      await screen.findByText('Desc.')
      const facts = await screen.findByTestId('profile-facts')
      expect(await within(facts).findByText(ORACLE_fmtShares(float))).toBeTruthy()
      const ytd = screen.getByTestId('profile-ytd')
      expect(within(ytd).getByText(ORACLE_fmtVol(vol))).toBeTruthy()
    })
  }
})

describe('rendered: the COT positioning rail shows the same WoW text', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn((url, init) => {
      const u = String(url)
      if (u.includes('/narratives')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ rows: [] }) })
      if (u.endsWith('/narrative') && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'disabled', text: null }) })
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
    })
  })
  afterEach(() => vi.restoreAllMocks())

  function mkRows(deltas) {
    const out = []
    for (let i = 0; i < 200; i++) {
      const d = new Date(Date.UTC(2022, 0, 4 + i * 7))
      out.push({
        date: d.toISOString().slice(0, 10),
        commercial_net: -200_000 + i * 1_000,
        large_spec_net: 150_000 - i * 800,
        small_spec_net: 20_000 + (i % 7) * 1_000,
        open_interest: 1_800_000 + i * 1_500,
      })
    }
    // The last week moves by exactly the chosen deltas.
    const prev = out[198]
    out[199] = {
      ...out[199],
      commercial_net: prev.commercial_net + deltas.commercials,
      large_spec_net: prev.large_spec_net + deltas.largeSpecs,
      small_spec_net: prev.small_spec_net + deltas.smallSpecs,
      open_interest: prev.open_interest + deltas.oi,
    }
    return out
  }

  const CASES = [
    { commercials: 2500, largeSpecs: -2500, smallSpecs: 999, oi: 1_500 },
    { commercials: 2_072_358, largeSpecs: -1_000_000_000, smallSpecs: 0, oi: -10_560 },
  ]

  for (const deltas of CASES) {
    it(`WoW ${JSON.stringify(deltas)}`, () => {
      render(<PositioningRail rows={mkRows(deltas)} symbol="ES" name="S&P 500 E-Mini" />)
      const table = screen.getByRole('table', { name: 'Net positioning by trader group' })
      const byLabel = {}
      for (const row of within(table).getAllByRole('row').slice(1)) {
        const cells = within(row).getAllByRole('cell')
        byLabel[cells[0].textContent] = cells[2].textContent
      }
      expect(byLabel['Commercials']).toBe(ORACLE_fmtSignedCompact(deltas.commercials))
      expect(byLabel['Large Specs']).toBe(ORACLE_fmtSignedCompact(deltas.largeSpecs))
      expect(byLabel['Small Specs']).toBe(ORACLE_fmtSignedCompact(deltas.smallSpecs))
      expect(byLabel['Open Interest']).toBe(ORACLE_fmtSignedCompact(deltas.oi))
    })
  }
})
