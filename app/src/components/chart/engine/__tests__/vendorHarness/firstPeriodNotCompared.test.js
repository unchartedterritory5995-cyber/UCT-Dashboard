// ─── ⭐⭐ (coordinator ruling 2026-11-21, after #2280) — A FIRST-PERIOD BAR WITHHELD BY NAME IS "NOT COMPARED", NEVER A
//     DIVERGE ─────────────────────────────────────────────────────────────────────────────────────────────────────────
//
// On a chart that does not start at the listing and whose first bar is not the first session of its week or month, a
// weekly / monthly read of `open`, `high`, `low` or `volume` would be built from part of the first period, so our side
// withholds it by name: `request:htf-first-period-partial` (look-ahead off, `tfMergeMask`) and
// `request:htf-lookahead-first-period-partial` (look-ahead on, `tfLiveMask`). Those bars were not on the per-bar channel
// (`__withheldBars`, `sinkPerBar`), so the vendor harness graded our `na` there against TradingView's value as a
// mismatch: on #2280's run 44855265228 the ES1 capture (`vw-req-w-closure-day-es1-1d-2026-11-20`) graded 8 plots DIVERGE
// on exactly those first-week bars, with 0 value mismatches. Now both codes write their bars to the channel, and the
// harness grades them "not compared". ⛔ The CONTROL is the point: a first-week value our side DRAWS wrong still
// DIVERGES, so the channel cannot hide a wrong number. The headless lane is unchanged: neither code is in
// `PER_BAR_CLOCK_CODES`, so a script that names one is still refused whole there.
import { describe, it, expect } from 'vitest'
import * as registry from '../../nativeRegistry'
import { TF_MERGE_FIRST_CODE, TF_LIVE_FIRST_CODE, PER_BAR_CLOCK_CODES } from '../../ast/interpret'
import { comparePlot, plotVerdict, tolerancePolicy } from '../../../../../../../tools/vendor_harness/compare.mjs'
import { withheldBarsOf } from './ourSide'

const TOL = tolerancePolicy({ symbol: { pricescale: 100 } })
const verdictOf = (r) => plotVerdict(r, { colorMeasured: false, colorResolvable: false })

// weekdays from Monday 2024-03-04 for five weeks and a day; the CHART holds them from Tuesday 03-05 (off the listing,
// its first week partial), TradingView's history from the Monday. Monday's high and low are the week's extremes, so the
// partial first week's high / low / open / volume are not the week's.
const DAYS = []
for (let d = new Date(Date.UTC(2024, 2, 4)); DAYS.length < 26; d.setUTCDate(d.getUTCDate() + 1)) {
  if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) DAYS.push(d.toISOString().slice(0, 10))
}
const FULL = DAYS.map((t, i) => (i === 0
  ? { t, o: 50, h: 90, l: 1, c: 50, v: 1000 }
  : { t, o: 50 + i, h: 60 + i, l: 40 + i, c: 50 + i, v: 100 + i }))
const CHART = FULL.slice(1)

const S = (name) => ({ type: 'series', name })
const def = (id, ast) => ({ id, name: id, version: 1, plots: [{ key: 'value', style: 'line' }],
  compute: { kind: 'ast', fn: id, source: id, ast }, meta: { recurrenceOrigin: 'pine' } })
const CTX = { tf: 'D', newestBarIsForming: false }
const run = (d, bars, ctx) => {
  const cols = registry.computeFor(d, bars, {}, ctx)
  return { col: Array.from(cols.value), report: registry.withheldBarsReport(cols) }
}
// TradingView's answer: the same read over its longer history (from the Monday, whose week is whole), on the chart's bars
const vendorOf = (d) => run(d, FULL, { ...CTX, historyFromListing: true }).col.slice(1).map((v) => (Number.isFinite(v) ? v : null))

const CASES = [
  { name: 'look-ahead off: tf_merge(W, high)', code: TF_MERGE_FIRST_CODE, ast: { type: 'tf_merge', value: 'W', args: [S('high')] } },
  { name: 'look-ahead on: tf_live(W, high)', code: TF_LIVE_FIRST_CODE, ast: { type: 'tf_live', value: 'W', args: [S('high')] } },
  { name: 'look-ahead on: tf_live(W, volume)', code: TF_LIVE_FIRST_CODE, ast: { type: 'tf_live', value: 'W', args: [S('volume')] } },
]

describe('⭐⭐ the first-period codes are on the per-bar channel, and the harness grades their bars "not compared"', () => {
  CASES.forEach((c, k) => {
    const d = def(`u_firstperiodpb${k}`, c.ast)
    it(`${c.name}: its first-period bars are named per bar, each one blank, and graded INCONCLUSIVE (never DIVERGE)`, () => {
      const { col, report } = run(d, CHART, CTX)
      const mask = report && report.value && report.value[c.code]
      expect(mask, `${c.code} on the per-bar channel`).toBeTruthy()
      const bars = [...mask].map((x, i) => (x ? i : -1)).filter((i) => i >= 0)
      expect(bars.length).toBeGreaterThan(0)
      // a bar named on the channel is one our side left blank: the channel never hides a drawn value
      for (const i of bars) expect(Number.isFinite(col[i]), `bar ${i} is withheld`).toBe(false)
      const vendor = vendorOf(d)
      const held = withheldBarsOf(report, 'value', 0)
      const r = comparePlot({ times: CHART.map((_, i) => 1700000000 + i * 86400), vendor, ours: col, tol: TOL,
        withheldBars: held.bars })
      const v = verdictOf(r)
      expect(r.steady.divergent, v.reason).toBe(0)
      expect(r.withheldVendorValued).toBeGreaterThan(0)
      expect(v.verdict).toBe('INCONCLUSIVE')
      // ...and without the channel the same column grades DIVERGE: what the ruling changes is the grade, not a value
      expect(verdictOf(comparePlot({ times: CHART.map((_, i) => 1700000000 + i * 86400), vendor, ours: col, tol: TOL })).verdict)
        .toBe('DIVERGE')
    })
  })

  it('⛔ CONTROL: a first-week value our side DRAWS wrong still DIVERGES (the same read, the first-period rule not applied)', () => {
    const d = def('u_firstperiodpb9', CASES[1].ast)
    // historyFromListing: our side draws the partial first week's high (as if the chart began at the listing)
    const { col, report } = run(d, CHART, { ...CTX, historyFromListing: true })
    expect(report && report.value && report.value[TF_LIVE_FIRST_CODE]).toBeFalsy()
    const vendor = vendorOf(d)
    expect(Number.isFinite(col[0]) && col[0] !== vendor[0]).toBe(true)                 // a drawn, wrong first-week value
    const r = comparePlot({ times: CHART.map((_, i) => 1700000000 + i * 86400), vendor, ours: col, tol: TOL,
      withheldBars: withheldBarsOf(report, 'value', 0)?.bars || null })
    expect(verdictOf(r).verdict).toBe('DIVERGE')
    expect(r.valueMismatches).toBeGreaterThan(0)
  })

  it('CONTROL: a merge of close is the whole period\'s on the partial week: nothing named, nothing withheld', () => {
    const d = def('u_firstperiodpb8', { type: 'tf_merge', value: 'W', args: [S('close')] })
    const { report } = run(d, CHART, CTX)
    expect(report && report.value && report.value[TF_MERGE_FIRST_CODE]).toBeFalsy()
  })

  it('the headless lane is unchanged: neither first-period code is a per-bar code there', () => {
    expect(PER_BAR_CLOCK_CODES).not.toContain(TF_MERGE_FIRST_CODE)
    expect(PER_BAR_CLOCK_CODES).not.toContain(TF_LIVE_FIRST_CODE)
  })
})
