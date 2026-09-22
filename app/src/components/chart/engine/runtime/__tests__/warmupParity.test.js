// app/src/components/chart/engine/runtime/__tests__/warmupParity.test.js
//
// ─── ⭐⭐ WHERE EVERY WINDOWED FUNCTION STARTS, MEASURED AT THE VENDOR ───────
//
// A warm-up is the bar a function first answers on, and it is the one property
// of this family that CANNOT be checked on an ordinary chart: every difference
// in it has decayed out of view long before the visible window. The 2026-09-21
// ATR defect was exactly this shape — one bar of warm-up, a different seed
// forever after, and invisible past bar ~30.
//
// ⭐⭐ SO THE WHOLE FAMILY WAS CAPTURED AT ONCE, on 12M, where SPY's ENTIRE
// series is 34 bars and `bar_index` 0 is loaded:
// `tests/fixtures/vendor/w2-warmup-spy-12m-2026-09-22.json`, hash-verified out
// of the browser.
//
// ⭐ THE RESULT IS A CONFIDENCE RESULT, AND THAT IS WORTH SAYING PLAINLY: all
// twelve readings this engine serves match the vendor on BOTH the first
// emission bar and the values. The ATR seed was an isolated defect, not the
// visible corner of a systemic one.
//
// ⛔ THE FIXTURE'S OWN `bar_index` IS THE KEY, NEVER THE ROW NUMBER. The chart
// model's array index is a position in the LOADED WINDOW; Pine's `bar_index` is
// a position in the SERIES. On a 1D capture those differ by 8,168.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const FIX = JSON.parse(fs.readFileSync(
  path.resolve(process.cwd(), '../tests/fixtures/vendor/w2-warmup-spy-12m-2026-09-22.json'), 'utf8'))

const BARS = FIX.rows.map((r) => ({ t: r.date, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))

const column = (expr) => {
  const r = buildRuntimeIr(`//@version=6\nindicator("t")\nplot(${expr})\n`, { bars: BARS, inputs: {} })
  if (!r.ok) throw new Error(`refused ${r.refusal.guard}: ${r.refusal.message}`)
  const prog = lowerIrProgram(r.ir)
  const { outputs } = execute(prog, {
    bars: BARS.length, series: SERIES, columns: prog.columns, confirmed: true,
  })
  return Array.from(outputs[0])
}

/** column name in the fixture → the Pine this engine is asked. */
const SERVED = [
  ['W01_rsi5_GATED_ON_RMA', 'ta.rsi(close, 5)'],
  ['W02_highest5', 'ta.highest(high, 5)'],
  ['W03_lowest5', 'ta.lowest(low, 5)'],
  ['W04_wma5', 'ta.wma(close, 5)'],
  ['W05_vwma5', 'ta.vwma(close, 5)'],
  ['W06_mom5', 'ta.mom(close, 5)'],
  ['W07_roc5', 'ta.roc(close, 5)'],
  ['W08_dev5', 'ta.dev(close, 5)'],
  ['W09_linreg5_offset0', 'ta.linreg(close, 5, 0)'],
  ['W11_stoch5', 'ta.stoch(close, high, low, 5)'],
  ['W12_tr_BARE_na_on_bar0', 'ta.tr'],
  ['W14_sma1_DEGENERATE_WINDOW', 'ta.sma(close, 1)'],
]

describe('⛔ the fixture is the one this file was written against', () => {
  it('names its symbol, its timeframe, and the bar range that makes it decisive', () => {
    expect(FIX._symbol).toBe('SPY')
    expect(FIX._tf).toBe('12M')
    // ⛔ THE LOAD-BEARING ONE. A capture that never reaches bar_index 0 cannot
    // answer a warm-up question at all, however many rows it has.
    expect(FIX._barIndexRange[0]).toBe(0)
    expect(FIX.rows[0].bar_index).toBe(0)
  })
})

describe('⭐⭐ every served reading matches TradingView — bar AND value', () => {
  for (const [col, expr] of SERVED) {
    it(`${expr} — starts where the vendor starts, and agrees after`, () => {
      const vendorFirst = FIX.first_emission_bar[col]
      expect(vendorFirst, `the fixture records no first emission for ${col}`).not.toBeNull()

      const ours = column(expr)
      // ⛔ THE BAR IS ASSERTED SEPARATELY FROM THE VALUES, because agreeing on
      // every overlapping bar while starting a bar late is EXACTLY the ATR
      // defect — and a value-only comparison passes straight through it.
      expect(ours.findIndex((v) => Number.isFinite(v)),
        `${expr}: first emission bar`).toBe(vendorFirst)

      let compared = 0
      let worst = 0
      for (let i = 0; i < FIX.rows.length; i += 1) {
        const vendor = FIX.rows[i][col]
        if (vendor === null) {
          expect(Number.isFinite(ours[i]),
            `${expr} bar ${i}: vendor is na, we answered ${ours[i]}`).toBe(false)
          continue
        }
        expect(Number.isFinite(ours[i]), `${expr} bar ${i}: vendor ${vendor}, we are na`).toBe(true)
        worst = Math.max(worst, Math.abs(vendor - ours[i]) / Math.max(1, Math.abs(vendor)))
        compared += 1
      }
      // ⛔ NON-VACUITY: a comparison over zero bars is satisfied by two all-na
      // series, which is what a broken build produces.
      expect(compared, `${expr}: compared nothing`).toBeGreaterThan(20)
      expect(worst, `${expr}: worst relative difference`).toBeLessThan(1e-9)
    })
  }
})

describe('⭐ what the vendor answers that this engine does not serve yet', () => {
  // ⭐ RECORDED AS VENDOR TRUTH WE ALREADY HOLD, so whoever builds these has a
  // number to aim at instead of a definition to interpret. Both compiled at
  // TradingView in the same capture.
  const UNSERVED = [
    ['W10_cci5', 'ta.cci(close, 5)', 'pine:role-order'],
    ['W13_cum_close_FROM_BAR0', 'ta.cum(close)', 'pine:function'],
  ]

  for (const [col, expr, guard] of UNSERVED) {
    it(`${expr} — refuses ${guard}, and the vendor's answer is already captured`, () => {
      // ⛔ THE REFUSAL IS PINNED BY NAME. If it ever changes, this file should be
      // re-read rather than quietly updated: the fixture holds the numbers, so
      // the case becomes an ordinary parity assertion the day it is served.
      let refusal = null
      try { column(expr) } catch (e) { refusal = String(e.message) }
      expect(refusal, `${expr} no longer refuses — promote this to a parity case`).toContain(guard)
      // and the vendor really did answer, so there is something to aim at
      expect(FIX.first_emission_bar[col]).not.toBeNull()
    })
  }
})
