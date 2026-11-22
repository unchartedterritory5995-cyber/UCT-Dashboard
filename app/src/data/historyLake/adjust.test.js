// @vitest-environment node
import { describe, it, expect } from 'vitest'
import fixture from './__fixtures__/adjust.json'
import { etMidnightEpoch, cleanSplitTable, segmentFactors, factorAt, adjustColumns } from './adjust'

// The fixture is built by the PYTHON reference (tools/history_lake/make_js_adjust_fixture.py) from
// synthetic bars: `adjusted` is what factors.adjust_bars returns for `raw` and `table`.
const CASES = fixture.cases
const f64 = (xs) => Float64Array.from(xs)
const colsOf = (c) => ({ t: f64(c.t), o: f64(c.raw.o), h: f64(c.raw.h), l: f64(c.raw.l), c: f64(c.raw.c), v: f64(c.raw.v) })

describe('history-lake split adjustment', () => {
  it('has the fixture it claims to test against', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(9)
    // at least one case moves values, at least one moves none, at least one moves only some
    const moved = CASES.map((c) => c.raw.c.filter((x, i) => x !== c.adjusted.c[i]).length)
    expect(moved.some((m) => m === 0)).toBe(true)
    expect(CASES.some((c, i) => moved[i] === c.raw.c.length && c.raw.c.length > 0)).toBe(true)
    expect(CASES.some((c, i) => moved[i] > 0 && moved[i] < c.raw.c.length)).toBe(true)
  })

  for (const c of CASES) {
    it(`agrees with the Python reference: ${c.name}`, () => {
      const cols = colsOf(c)
      const out = adjustColumns(cols, c.table)
      expect(out).toBe(cols)                                    // in place
      for (const k of ['o', 'h', 'l', 'c', 'v']) expect(Array.from(cols[k])).toEqual(c.adjusted[k])
      expect(Array.from(cols.t)).toEqual(c.t)
      // and bar by bar through the lookup form
      const segs = segmentFactors(c.table)
      c.t.forEach((t, i) => {
        const f = factorAt(segs, t)
        expect(f === 1 ? c.raw.c[i] : c.raw.c[i] / f).toBe(c.adjusted.c[i])
      })
    })
  }

  it('finds midnight in New York in both halves of the year', () => {
    expect(etMidnightEpoch('2026-01-15')).toBe(Date.UTC(2026, 0, 15, 5) / 1000)     // EST
    expect(etMidnightEpoch('2026-07-15')).toBe(Date.UTC(2026, 6, 15, 4) / 1000)     // EDT
    expect(etMidnightEpoch('2026-03-08')).toBe(Date.UTC(2026, 2, 8, 5) / 1000)      // the change day starts in EST
    expect(etMidnightEpoch('2026-03-09')).toBe(Date.UTC(2026, 2, 9, 4) / 1000)
    expect(etMidnightEpoch('2026-11-01')).toBe(Date.UTC(2026, 10, 1, 4) / 1000)     // the change day starts in EDT
    expect(etMidnightEpoch('2026-11-02')).toBe(Date.UTC(2026, 10, 2, 5) / 1000)
    for (const bad of ['', null, '2026-1-5', '20260105', 'tomorrow']) expect(() => etMidnightEpoch(bad)).toThrow(/ISO date/)
  })

  it('a bar ON the execution date is already on the new basis; the bar before it is not', () => {
    const at = etMidnightEpoch('2026-06-08')
    const cols = { t: f64([at - 1, at, at + 1]), o: f64([400, 100, 100]), h: f64([400, 100, 100]), l: f64([400, 100, 100]), c: f64([400, 100, 100]), v: f64([10, 40, 40]) }
    adjustColumns(cols, [['2026-06-08', 4]])
    expect(Array.from(cols.c)).toEqual([100, 100, 100])
    expect(Array.from(cols.v)).toEqual([40, 40, 40])
  })

  it('a stretch whose later splits cancel out (factor 1) does not end the walk', () => {
    const d1 = etMidnightEpoch('2026-06-08'), d2 = etMidnightEpoch('2026-06-15')
    const mk = () => f64([100, 100, 100, 100])
    const cols = { t: f64([d1 - 10, d1 + 10, d2 - 10, d2 + 10]), o: mk(), h: mk(), l: mk(), c: mk(), v: mk() }
    adjustColumns(cols, [['2026-06-08', 2], ['2026-06-15', 0.5]])      // before both: 2 * 0.5 = 1
    expect(Array.from(cols.c)).toEqual([100, 200, 200, 100])
    expect(Array.from(cols.v)).toEqual([100, 50, 50, 100])
  })

  it('keeps only usable rows of a split table, in date order', () => {
    expect(cleanSplitTable([['2026-06-08', 4], ['2020-01-02', 2]])).toEqual([['2020-01-02', 2], ['2026-06-08', 4]])
    expect(cleanSplitTable([['2026-06-08', 1], ['2026-06-09', 0], ['2026-06-10', -2], ['2026-06-11', NaN],
      ['2026-06-12', Infinity], ['2026-6-13', 2], [20260614, 2], ['2026-06-15', '2'], ['2026-06-16'], null, 'x'])).toEqual([])
    for (const junk of [null, undefined, 'x', 7, {}]) expect(cleanSplitTable(junk)).toEqual([])
    expect(segmentFactors(null)).toEqual([{ before: Infinity, factor: 1 }])
    // an unusable table changes nothing
    const cols = { t: f64([1, 2]), o: f64([5, 6]), h: f64([5, 6]), l: f64([5, 6]), c: f64([5, 6]), v: f64([1, 1]) }
    adjustColumns(cols, [['2026-06-08', 1]])
    expect(Array.from(cols.c)).toEqual([5, 6])
  })

  it('multiplies the ratios of every later split, never an earlier one', () => {
    const segs = segmentFactors([['2026-01-14', 2], ['2026-01-30', 1.5], ['2026-02-11', 0.05]])
    expect(segs.map((s) => s.factor)).toEqual([2 * 1.5 * 0.05, 1.5 * 0.05, 0.05, 1])
    expect(segs[0].before).toBe(etMidnightEpoch('2026-01-14'))
    expect(factorAt(segs, etMidnightEpoch('2026-01-30') - 1)).toBe(1.5 * 0.05)
    expect(factorAt(segs, etMidnightEpoch('2026-01-30'))).toBe(0.05)
    expect(factorAt(segs, etMidnightEpoch('2026-02-11'))).toBe(1)
  })
})
