// app/src/components/chart/engine/__tests__/headlessPerBarClockCodes.test.js
//
// ⭐⭐ THE AUDIT AFTER (A) (coordinator ruling, 2026-11-20): every chart-clock code the headless lane refused whole that
// withholds only SOME bars, measured on "Inspect a bar"'s chart (off the listing, `{tf, sym}`). Five took a picture
// away: the chart drew 589-599 of 600 bars while the headless lane (and so the Builder's Inspect panel) refused the whole
// script. Each now writes its bars to the plot's per-bar channel (`interpret.js::PER_BAR_CLOCK_CODES`, `sinkPerBar`); the
// script computes, its output names the code with the number of bars, and every value equals the chart lane's.
//
// Not reached by this audit's probes (a whole refusal there still): `time-anchor:period-open-missing`,
// `time-anchor:utc-day-clock`, `request:htf-first-period-partial`, `request:htf-lookahead-first-period-partial`,
// `var-origin:bars`, `stoch:flat-window`, `stoch:left-edge`, `rci:left-edge`, `pine:bool-na-unwitnessed`,
// `pine:tie-unwitnessed`. ⛔ CONTROL: `var-origin:window`, a whole withholding, still refuses.
import { describe, it, expect } from 'vitest'

import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { computeFor } from '../nativeRegistry'
import { computeHeadless } from '../headlessCompute.js'
import { referenceBars, REFERENCE_SYMBOL } from '../referenceSeries.js'
import { PER_BAR_CLOCK_CODES } from '../ast/interpret.js'

const REF = referenceBars()
const LAST = REF.slice(-600)
// a daily series that starts on a Wednesday and ends mid-week: its newest weekly bar is not closed
const MID = (() => { const i = REF.findIndex((b) => new Date(`${b.t}T00:00:00Z`).getUTCDay() === 3); return REF.slice(i, i + 600) })()
const src = (...body) => ['//@version=6', 'indicator("a", overlay=true)', ...body].join('\n')
const def = (source) => {
  const d = memberPaneDefinition({ source, id: 'u_0000pbc00001', name: 'per-bar' })
  expect(d.ok, d.reason).toBe(true)
  return d.definition
}
const OFF = { tf: 'D', symbol: REFERENCE_SYMBOL }
const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || a === b

const CASES = [
  ['bar-index:early-bars', src('plot(bar_index > 10 ? close : na)'), LAST, 11],
  ['bar-index:first-bar', src('plot(barstate.isfirst ? 1 : 0)'), LAST, 1],
  ['running-total:early-bars', src('plot(ta.cum(1) > 5 ? close : na)'), LAST, 5],
  ['window-extreme:left-edge', src('plot(ta.highest(close > open ? high : na, 5))'), LAST, 5],
  ['request:htf-newest-unconfirmed', src('plot(request.security(syminfo.tickerid, "W", close))'), MID, 1],
]

describe('the audit after (A): a code that withholds some bars computes the script, named per output', () => {
  it('the list is the engine\'s own and holds these five beside history:before-chart', () => {
    expect([...PER_BAR_CLOCK_CODES].sort()).toEqual(['history:before-chart', ...CASES.map((c) => c[0])].sort())
  })
  for (const [code, source, bars, held] of CASES) {
    it(`${code}: computed, ${held} bar(s) named, every value the chart lane's`, () => {
      const d = def(source)
      const r = computeHeadless(d, bars, OFF)
      expect(r.refusal, JSON.stringify(r.refusal)).toBeUndefined()
      expect(r.outputs[0].withheld).toEqual([{ code, bars: held }])
      const chart = computeFor(d, bars, {}, { tf: 'D', newestBarIsForming: false, symbol: { ticker: REFERENCE_SYMBOL.ticker } }).value
      let bad = -1
      for (let i = 0; i < bars.length && bad === -1; i++) if (!same(r.outputs[0].values[i], chart[i])) bad = i
      expect(bad, `bar ${bad} differs from the chart lane`).toBe(-1)
      // the picture the refusal took away: the chart draws nearly every bar
      expect(Array.from(chart).filter(Number.isFinite).length).toBeGreaterThan(bars.length * 0.95)
    })
  }
  it('⛔ CONTROL: a whole withholding (var-origin:window) still refuses the script', () => {
    const r = computeHeadless(def(src('var int n = 0', 'n += 1', 'plot(n > 3 ? close : na)')), LAST, OFF)
    expect(r.outputs).toBeNull()
    expect(r.refusal && r.refusal.code).toBe('var-origin:window')
  })
})
