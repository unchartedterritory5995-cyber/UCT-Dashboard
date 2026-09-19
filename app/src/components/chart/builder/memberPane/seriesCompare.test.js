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
import {
  compareSeries, compareAll, renderTable, MAX_REL, quantise, depthVerdict,
} from './seriesCompare.js'

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

// ─── ⭐⭐ R-L — "EXACT" AFTER THE COARSER SIDE'S GRANULARITY ─────────────────
//
// Owner ruling, 2026-09-12: *"Integer series compare exactly AFTER the vendor's
// stated granularity is applied — tolerance = the rounding unit (100 shares
// here). Anything beyond that unit is a real divergence."*
//
// ⚠️ THE ROUNDING IS ON OUR SIDE, NOT THE VENDOR'S, AND THAT IS MEASURED:
// 5,000 of 5,000 SPY daily bars in our store are multiples of 100, in every year
// from 2002; the vendor's are not multiples of anything. The unit is the same
// number either way — it is the resolution the COARSER side can answer at — but
// the fixture records whose it is, because the day a provider changes it is the
// day this stops being true.
describe('R-L — an integer series at the coarser side\'s resolution', () => {
  // The four SPY bars T5 actually measured, vendor values verbatim from
  // `uncharted-volume-v2-spy-1d-2026-09-12.json`.
  const OURS = [45477300, 42740400, 32812400, 43494000]
  const VENDOR = [45512741, 42740375, 32812411, 43531581]

  it('⛔ at full resolution ALL FOUR differ — the reading that started this', () => {
    const r = compareSeries('Volume', OURS, VENDOR, 'int')
    expect(r.ok).toBe(false)
    expect(r.mismatches).toBe(4)
    expect(r.roundedEqual).toBe(0)
  })

  it('⭐⭐ at 100 shares the two ROUNDING bars agree and the two REAL ones do not', () => {
    const r = compareSeries('Volume', OURS, VENDOR, 'int', 100)
    // 2026-09-10 (−25) and 2026-09-09 (+11) are what rounding to 100 produces.
    expect(r.roundedEqual).toBe(2)
    // 2026-09-11 (+35,441) and 2026-09-03 (+37,581) are not.
    expect(r.mismatches).toBe(2)
    expect(r.ok).toBe(false)
    expect(r.unit).toBe(100)
  })

  it('⛔⛔ IT IS NOT A TOLERANCE — 101 shares still fails at unit 100', () => {
    // The whole reason this is `quantise(x) === quantise(y)` and not
    // `abs(x - y) <= unit`. A tolerance would swallow anything up to the unit;
    // this only swallows what the unit EXPLAINS.
    expect(compareSeries('v', [1000000], [1000101], 'int', 100).mismatches).toBe(1)
    // …and a pair the unit does explain agrees, at the same distance from a
    // boundary, so the previous line is not passing for a rounding-direction
    // accident.
    expect(compareSeries('v', [1000000], [1000049], 'int', 100).mismatches).toBe(0)
  })

  it('⭐ CONTROL: the unit does not manufacture agreement where there is none', () => {
    // Two stores that genuinely differ by a share still differ at unit 1, and a
    // unit of 1 is the identity — so an unset unit cannot quietly relax anything.
    expect(compareSeries('v', [45510000], [45510001], 'int', 1).mismatches).toBe(1)
    expect(compareSeries('v', [45510000], [45510001], 'int').mismatches).toBe(1)
    expect(quantise(45510001, 1)).toBe(45510001)
    expect(quantise(45510001, 100)).toBe(45510000)
  })

  it('⛔ IDENTICAL IS NOT THE SAME FACT AS EXPLAINED, and the row keeps them apart', () => {
    // A run where every bar needed the granularity and one where none did are
    // different states of the world; collapsing them would let a provider change
    // widen "exact" without anything going red.
    const same = compareSeries('v', [100, 200], [100, 200], 'int', 100)
    expect(same.ok).toBe(true)
    expect(same.roundedEqual).toBe(0)
    const rounded = compareSeries('v', [100, 200], [88, 214], 'int', 100)
    expect(rounded.ok).toBe(true)
    expect(rounded.roundedEqual).toBe(2)
  })

  it('⭐ the table names the unit, because AGREES without it says nothing', () => {
    const text = renderTable([compareSeries('Volume', OURS, VENDOR, 'int', 100)])
    expect(text).toContain('unit 100')
    expect(text).toContain('rounded 2')
    const plain = renderTable([compareSeries('Volume', [1], [1], 'int')])
    expect(plain).toContain('exact')
    expect(plain).toContain('no rounding')
  })
})

// ─── ⭐⭐ T6's DEPTH PRECONDITION, CARRIED IN BEFORE T6 ──────────────────────
//
// Owner ruling, 2026-09-13: "the 25 HVE firings at 4,633 bars are the vendor side
// of T6; our side must be compared at >= 2,751 bars loaded or the column is
// excluded and disclosed — carry that into T6's comparison rule now so it is not
// rediscovered."
describe('the depth precondition — a column short of its window is EXCLUDED', () => {
  it('⛔⛔ a short column never reaches the comparison, and says why', () => {
    const [row] = compareAll([{
      name: 'HVE Trigger', ours: [0, 0, 0], theirs: [0, 0, 0], kind: 'float',
      window: 2751, barsLoaded: 640,
    }])
    expect(row.excluded).toBe(true)
    expect(row.ok).toBe(false)
    expect(row.reason).toContain('EXCLUDED')
    expect(row.reason).toContain('2751')
    expect(row.reason).toContain('640')
    // ⚰️ AND THIS IS THE CASE THAT SETTLED IT. Those three zeros AGREE. Compared
    // rather than excluded, the row would read AGREES and be agreeing about a
    // column the vendor answered over 640 bars of a 2,751-bar window — which is
    // exactly the 2026-09-12 SPY capture, where HVE Trigger read flat 0 and at
    // 4,633 bars fires 25 times.
    expect(row.compared).toBe(0)
  })

  it('⭐ at full depth the same pair is compared normally', () => {
    const [row] = compareAll([{
      name: 'HVE Trigger', ours: [0, 0, 0], theirs: [0, 0, 0], kind: 'float',
      window: 2751, barsLoaded: 4633,
    }])
    expect(row.excluded).toBeUndefined()
    expect(row.ok).toBe(true)
    expect(row.compared).toBe(3)
  })

  it('⛔ PER COLUMN, not all-or-nothing — the shallow-capture measurement', () => {
    // At 640 bars the four drawn series were byte-for-byte correct and only the
    // 2,751-bar column was wrong. A rule that voided the whole comparison would
    // have discarded four good series.
    const rows = compareAll([
      { name: 'Volume', ours: [1], theirs: [1], kind: 'int', window: 0, barsLoaded: 640 },
      { name: 'Avg Vol Line', ours: [2], theirs: [2], kind: 'float', window: 50, barsLoaded: 640 },
      { name: 'HVE Trigger', ours: [0], theirs: [0], kind: 'float', window: 2751, barsLoaded: 640 },
    ])
    expect(rows.map((r) => !!r.excluded)).toEqual([false, false, true])
    expect(rows.filter((r) => r.ok)).toHaveLength(2)
  })

  it('⛔ AN UNDECLARED BAR COUNT IS A REFUSAL, NOT A PASS', () => {
    // The `UNMEASURED` case, one door over from `tools/vendor_window.py`: a
    // capture that never recorded its depth cannot certify a windowed column.
    const [row] = compareAll([{
      name: 'HVE Trigger', ours: [0], theirs: [0], kind: 'float', window: 2751,
    }])
    expect(row.excluded).toBe(true)
    expect(row.reason).toContain('needs a bar count')
  })

  it('⭐ CONTROL: a window-free column is never excluded, at any depth', () => {
    for (const barsLoaded of [0, 1, 640, 4633]) {
      const [row] = compareAll([{
        name: 'Volume', ours: [7], theirs: [7], kind: 'int', window: 0, barsLoaded,
      }])
      expect(row.excluded, `barsLoaded=${barsLoaded}`).toBeUndefined()
      expect(row.ok).toBe(true)
    }
    expect(depthVerdict({ window: 0, barsLoaded: 1 })).toBeNull()
  })
})
