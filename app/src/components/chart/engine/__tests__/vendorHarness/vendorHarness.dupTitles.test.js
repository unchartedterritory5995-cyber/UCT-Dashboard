// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.dupTitles.test.js
//
// ⭐⭐ e98 — M1b: A TITLE PRESENT MORE THAN ONCE IS PAIRED BY DECLARATION ORDER WITHIN THE TITLE, ON EQUAL COUNTS.
// ⚰️ opening-range-initial-balance-opening-price (4 committed captures): `OR Low` x2, `IB Low` x2 and seven untitled
// `Shapes` left 11 of 14 plots UNMAPPED, so the capture was INCONCLUSIVE. M2's evidence rule (equal counts, order on
// both sides) pairs a duplicated, named title by order; then the untitled leftovers meet M2 as before.
// ⛔ ORDER, NEVER BEST FIT: two same-titled plots whose values are SWAPPED in order DIVERGE (the control below).
import { describe, it, expect } from 'vitest'
import { mapPlots, compareCapture } from '../../../../../../../tools/vendor_harness/compare.mjs'

const T = [1, 2, 3]
const A = [10, 11, 12]
const B = [20, 21, 22]
/** A capture of `plots` ({title, values}), each a line. */
const capture = (plots) => ({
  symbol: { pricescale: 100 },
  history: { startsAtBar0: true },
  bars: { rows: T.map((t) => [t, 1, 1, 1, 1, 1]) },
  plotValues: { rows: T.map((t, b) => [t, ...plots.map((p) => p.values[b])]) },
  study: { plots: plots.map((p, i) => ({ id: `plot_${i}`, type: 'line', title: p.title })), styles: {}, styleState: {} },
})
const ours = (plots) => ({ ok: true, plots: plots.map((p, i) => ({ title: p.title, kind: 'plot', key: `k${i}`, lookback: 0, column: p.values })) })

describe('e98 — M1b, a duplicated title paired by declaration order', () => {
  it('equal counts: the N-th vendor plot so titled is paired with our N-th, and grades MATCH', () => {
    const plots = [{ title: 'OR Low', values: A }, { title: 'mid', values: A }, { title: 'OR Low', values: B }]
    const m = mapPlots(capture(plots).study.plots.map((p) => ({ ...p })), ours(plots).plots)
    expect(m.pairs.filter((p) => p.rule === 'M1b-title-order').map((p) => [p.vendor.id, p.ours.key])).toEqual([['plot_0', 'k0'], ['plot_2', 'k2']])
    const r = compareCapture(capture(plots), ours(plots))
    expect(r.plots.map((p) => [p.id, p.rule, p.verdict])).toEqual(expect.arrayContaining([
      ['plot_0', 'M1b-title-order', 'MATCH'], ['plot_2', 'M1b-title-order', 'MATCH']]))
  })

  it('⛔ CONTROL: the two same-titled plots SWAPPED in order on our side DIVERGE: order, never best fit', () => {
    const vendor = [{ title: 'OR Low', values: A }, { title: 'OR Low', values: B }]
    const swapped = [{ title: 'OR Low', values: B }, { title: 'OR Low', values: A }]
    const r = compareCapture(capture(vendor), ours(swapped))
    expect(r.plots.map((p) => [p.id, p.ours, p.verdict])).toEqual([['plot_0', 'k0', 'DIVERGE'], ['plot_1', 'k1', 'DIVERGE']])
  })

  it('⛔ counts that differ stay UNMAPPED, by name', () => {
    const vendor = [{ title: 'OR Low', values: A }, { title: 'OR Low', values: B }]
    const m1 = mapPlots(capture(vendor).study.plots, ours([{ title: 'OR Low', values: A }]).plots)
    expect(m1.pairs).toEqual([])
    expect(m1.unmappedVendor.map((u) => u.reason)).toEqual([
      'vendor title "OR Low" is not unique in the study', 'vendor title "OR Low" is not unique in the study'])
    const m3 = mapPlots(capture(vendor).study.plots, ours([...vendor, { title: 'OR Low', values: A }]).plots)
    expect(m3.pairs).toEqual([])
  })

  it('a default title is left to M2: the named duplicates pair by order, then the untitled leftovers by position', () => {
    const plots = [{ title: 'Shapes', values: A }, { title: 'OR Low', values: A }, { title: 'Shapes', values: B },
      { title: 'OR Low', values: B }]
    const oursPlots = [{ title: null, values: A }, { title: 'OR Low', values: A }, { title: null, values: B },
      { title: 'OR Low', values: B }]
    const r = compareCapture(capture(plots), ours(oursPlots))
    expect(r.plots.map((p) => [p.id, p.rule, p.verdict])).toEqual([
      ['plot_1', 'M1b-title-order', 'MATCH'], ['plot_3', 'M1b-title-order', 'MATCH'],
      ['plot_0', 'M2-position-untitled', 'MATCH'], ['plot_2', 'M2-position-untitled', 'MATCH']])
  })
})
