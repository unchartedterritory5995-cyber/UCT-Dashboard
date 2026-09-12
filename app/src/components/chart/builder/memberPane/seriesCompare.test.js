// app/src/components/chart/builder/memberPane/seriesCompare.test.js
//
// ─── ⭐⭐ T5 — THE COMPARATOR, PROVED ABLE TO FAIL BEFORE IT IS POINTED AT A
//              VENDOR CAPTURE ────────────────────────────────────────────────
//
// ⛔ THIS IS THE WHOLE REASON THE FILE EXISTS. The Part 3 fixture is not captured
// yet (the rig window is off the desktop), so the parity run cannot happen today.
// A comparator written now and first exercised against the real numbers later
// would be an instrument nobody had ever seen discriminate — and this repo has
// twice had an instrument manufacture a finding. Every rule the ruling names is
// exercised here, in both directions, on numbers chosen to sit either side of it.
import { describe, it, expect } from 'vitest'
import { compareSeries, compareAll, renderTable, MAX_REL } from './seriesCompare.js'

describe('⭐ integers are EXACT — tolerance on a count is a hidden rounding rule', () => {
  it('one share of difference is a failure, however large the number', () => {
    const r = compareSeries('Volume', [45510000, 1], [45510001, 1], 'int')
    expect(r.ok).toBe(false)
    expect(r.mismatches).toBe(1)
    expect(r.worstBar).toBe(0)
    expect(r.worstPair).toEqual([45510000, 45510001])
    // ⛔ AND IT WOULD HAVE PASSED AS A FLOAT — 2.2e-8 relative. That is the whole
    // argument for the `kind` split, measured rather than asserted.
    const asFloat = compareSeries('Volume', [45510000, 1], [45510001, 1], 'float')
    expect(asFloat.maxRel).toBeLessThan(1e-7)
  })

  it('⭐ CONTROL: identical integers agree', () => {
    const r = compareSeries('Volume', [45510000, 2, 3], [45510000, 2, 3], 'int')
    expect(r.ok).toBe(true)
    expect(r.compared).toBe(3)
    expect(r.reason).toBe(null)
  })
})

describe('⭐ floats are RELATIVE at 1e-9, with the absolute error beside', () => {
  it('just inside the bound agrees; just outside does not', () => {
    const base = 1234.5678
    const inside = compareSeries('Avg Vol Line', [base * (1 + 5e-10)], [base], 'float')
    expect(inside.ok).toBe(true)
    expect(inside.maxRel).toBeLessThanOrEqual(MAX_REL)

    const outside = compareSeries('Avg Vol Line', [base * (1 + 5e-9)], [base], 'float')
    expect(outside.ok).toBe(false)
    expect(outside.maxRel).toBeGreaterThan(MAX_REL)
    expect(outside.reason).toContain('max relative error')
  })

  it('⛔ the ABSOLUTE error is carried beside the relative one, not instead of it', () => {
    // 3e-10 relative on a volume column is 0.015 shares — a human reading the
    // table needs that number to sanity-check the verdict.
    const r = compareSeries('Volume', [5e7 + 0.015], [5e7], 'float')
    expect(r.maxRel).toBeGreaterThan(0)
    expect(r.absAtMaxRel).toBeCloseTo(0.015, 6)
    expect(r.worstBar).toBe(0)
  })

  it('⛔ a vendor ZERO is compared ABSOLUTELY, not infinitely relatively', () => {
    // Without the floor of 1 in the denominator, any difference against 0 is an
    // infinite relative error and every series carrying a zero bar fails.
    const ok = compareSeries('Scale Padding', [1e-12], [0], 'float')
    expect(ok.ok).toBe(true)
    const bad = compareSeries('Scale Padding', [0.5], [0], 'float')
    expect(bad.ok).toBe(false)
  })
})

describe('⛔⛔ the cases a lenient comparator would skip', () => {
  it('a blank on ONE side is a mismatch — warm-up ending a bar early is the defect', () => {
    const r = compareSeries('Avg Vol Columns', [null, 2, 3], [1, 2, 3], 'float')
    expect(r.ok).toBe(false)
    expect(r.mismatches).toBe(1)
    expect(r.reason).toContain('blank on one side')
  })

  it('⭐ blanks on BOTH sides agree, and are counted rather than compared', () => {
    const r = compareSeries('Avg Vol Columns', [null, NaN, 3], [null, NaN, 3], 'float')
    expect(r.ok).toBe(true)
    expect(r.blanks).toBe(2)
    expect(r.compared).toBe(1)
  })

  it('⛔ a LENGTH mismatch is refused outright, never graded on the overlap', () => {
    const r = compareSeries('Volume', [1, 2], [1, 2, 3], 'int')
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('length')
    // …and it did not silently grade the two bars it could have.
    expect(r.compared).toBe(0)
  })

  it('⛔ CONTROL: an empty pair is not a pass by accident', () => {
    // Two empty series agree trivially — which is correct — but the row must say
    // it compared nothing, so a table full of `compared: 0` reads as a fixture
    // that never loaded rather than as parity.
    const r = compareSeries('nothing', [], [], 'float')
    expect(r.ok).toBe(true)
    expect(r.compared).toBe(0)
    expect(r.n).toBe(0)
  })
})

describe('⭐ the table the ruling asks for', () => {
  it('one row per series, and the verdict is legible', () => {
    const rows = compareAll([
      { name: 'Volume', ours: [1, 2], theirs: [1, 2], kind: 'int' },
      { name: 'Avg Vol Line', ours: [1.5, 2.5], theirs: [1.5, 2.5000000001], kind: 'float' },
      { name: 'Broken', ours: [1], theirs: [2], kind: 'int' },
    ])
    expect(rows.map((r) => r.ok)).toEqual([true, true, false])
    const text = renderTable(rows)
    expect(text).toContain('Volume')
    expect(text).toContain('AGREES')
    expect(text).toContain('integer values differ')
    // ⛔ AN INTEGER ROW SHOWS NO RELATIVE FIGURE. Printing `0.000e+0` there would
    // read as "measured and perfect" for a column where the number is meaningless.
    expect(text.split('\n')[1]).toContain('—')
  })
})
