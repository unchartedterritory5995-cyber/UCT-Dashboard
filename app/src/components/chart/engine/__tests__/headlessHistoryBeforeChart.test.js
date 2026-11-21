// app/src/components/chart/engine/__tests__/headlessHistoryBeforeChart.test.js
//
// ⭐⭐ (A), coordinator ruling 2026-11-20: THE HEADLESS LANE REPORTS `history:before-chart` PER OUTPUT.
//
// Off the listing, a Pine document that draws from a read before the chart's first bar (`nz(close[1])`,
// `close > close[1]`) has those bars withheld by name (`interpret.js::historyBeforeChartMask`) and every
// other bar drawn. The headless lane (`headlessCompute.js`) refused such a script WHOLE: every named
// chart-clock row was a whole-plot refusal there. So since engine 90 the Builder's "Inspect a bar"
// (`InspectBarPanel`: the member's chart, `{tf, sym}`, off the listing) answered "This script is not
// computed here" for `plot(nz(close[1]))`, which took away a correct picture.
//
// Now the code rides the per-bar channel (`__withheldBars`). The script computes; the output says
// `withheld: [{code: 'history:before-chart', bars}]` for exactly the bars it took a drawn value away from,
// as the runtime lane's warm-up curtain (`runtime:history-start`) already does. Every other bar equals the
// same script run from the listing.
//
// ⛔ CONTROL: a whole withholding still refuses whole. Daily bars that hold Saturdays but not Sundays withhold
// `time("W")` on every bar (`time-clock:weekend-session`, measured), and that is still a refusal by name.
import { describe, it, expect } from 'vitest'

import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { computeHeadless } from '../headlessCompute.js'
import { referenceBars, referenceOptions, REFERENCE_TIMEFRAME, REFERENCE_SYMBOL } from '../referenceSeries.js'
import { HISTORY_BEFORE_CHART_CODE } from '../ast/interpret.js'

const BARS = referenceBars()
const OFF = { tf: REFERENCE_TIMEFRAME, symbol: REFERENCE_SYMBOL }   // the Inspect panel's chart: no listing fact
const FROM_LISTING = referenceOptions()
const src = (...body) => ['//@version=6', 'indicator("t")', ...body].join('\n')
const def = (source) => {
  const d = memberPaneDefinition({ source, id: 'u_headless_hbc' })
  expect(d.ok, d.reason).toBe(true)
  return d.definition
}
const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || a === b

describe('(A) a read before the chart is withheld per bar by name, never the whole script', () => {
  for (const [what, source, held] of [
    ['plot(nz(close[1]))', src('plot(nz(close[1]))'), 1],
    ['plot(close > close[1] ? 1 : 0)', src('plot(close > close[1] ? 1 : 0)'), 1],
    ['plot(nz(close[2]) + nz(close[1]))', src('plot(nz(close[2]) + nz(close[1]))'), 2],
  ]) {
    it(`${what}: computes off the listing, ${held} bar(s) named, every other bar the listing run's`, () => {
      const d = def(source)
      const r = computeHeadless(d, BARS, OFF)
      expect(r.refusal, JSON.stringify(r.refusal)).toBeUndefined()
      expect(Array.isArray(r.outputs) && r.outputs.length).toBe(1)
      const [out] = r.outputs
      expect(out.withheld).toEqual([{ code: HISTORY_BEFORE_CHART_CODE, bars: held }])
      const listed = computeHeadless(d, BARS, FROM_LISTING)
      expect(listed.refusal).toBeUndefined()
      expect(listed.outputs[0].withheld).toBeUndefined()   // from the listing TradingView reads na there too
      const want = listed.outputs[0].values
      for (let i = 0; i < held; i++) {
        expect(Number.isNaN(out.values[i]), `bar ${i} is withheld`).toBe(true)
        expect(Number.isFinite(want[i]), `bar ${i} is drawn from the listing`).toBe(true)
      }
      let bad = -1
      for (let i = held; i < BARS.length && bad === -1; i++) if (!same(out.values[i], want[i])) bad = i
      expect(bad, `bar ${bad} differs from the listing run`).toBe(-1)
    })
  }

  it('a bar already blank is not counted: `close[1] + nz(close[2])` names bar 1 only (bar 0 is na from the listing too)', () => {
    const d = def(src('plot(close[1] + nz(close[2]))'))
    const r = computeHeadless(d, BARS, OFF)
    expect(r.refusal, JSON.stringify(r.refusal)).toBeUndefined()
    expect(r.outputs[0].withheld).toEqual([{ code: HISTORY_BEFORE_CHART_CODE, bars: 1 }])
    const want = computeHeadless(d, BARS, FROM_LISTING).outputs[0].values
    expect(Number.isNaN(r.outputs[0].values[0]) && Number.isNaN(want[0])).toBe(true)
    expect(Number.isNaN(r.outputs[0].values[1]) && Number.isFinite(want[1])).toBe(true)
  })

  it('a plot that takes nothing away (`close[1]` stays na on bar 0) is not named and computes', () => {
    const r = computeHeadless(def(src('plot(close - close[1])')), BARS, OFF)
    expect(r.refusal).toBeUndefined()
    expect(r.outputs[0].withheld).toBeUndefined()
  })

  it('⛔ CONTROL: a whole withholding still refuses whole (time("W") on daily bars that hold Saturdays, not Sundays)', () => {
    const week = []
    for (let d = new Date('2024-01-01T00:00:00Z'); week.length < 400; d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() === 0) continue
      const c = 100 + Math.sin(week.length / 7) * 5
      week.push({ t: d.toISOString().slice(0, 10), o: c, h: c + 1, l: c - 1, c, v: 1000 })
    }
    const r = computeHeadless(def(src('plot((time("W") - time) / 86400000)')), week, OFF)
    expect(r.outputs).toBeNull()
    expect(r.refusal && r.refusal.code).toBe('time-clock:weekend-session')
    // and a script that carries BOTH a per-bar read and a whole withholding is refused by the whole one
    const both = computeHeadless(def(src('plot(nz(close[1]))', 'plot((time("W") - time) / 86400000)')), week, OFF)
    expect(both.refusal && both.refusal.code).toBe('time-clock:weekend-session')
  })
})
