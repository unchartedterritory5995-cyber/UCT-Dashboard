// ─── ⭐⭐ U-DAILY (e96, part A) — A DAILY READ ON A CHART BELOW A DAY ─────────────────────────────────────────────
//
// `tf(x, 'D')` on a stated chart below a day: `x` computed on the symbol's DAILY bars (handed beside the chart's) and
// shown on each chart bar as THE LAST FINISHED DAY, placed by the chart's own projection (`mtfProjection`). Every
// expected number below is worked out by hand from the bars this file builds (the daily close of row j is 100 + j),
// never read back from the code under test. Python twin: tests/test_ast_daily_read.py.

import { describe, it, expect } from 'vitest'
import {
  interpret, maxLookback, DAILY_READ, DAILY_READ_DAY_NOT_HELD, DAILY_READ_NO_DAILY_BARS, treeReadsDaily,
  dailyReadSymbols, isBelowADay, TF_RESAMPLABLE,
} from './interpret.js'
import { DAILY_READ_CODE, lintRepaint } from './lint.js'
import { seriesRefs, checkBudget } from './budget.js'
import { sentenceFor } from './sentence.js'
import { projectFrameColumns, frameKey } from '../mtfProjection.js'
import { dailyReadSupplyFor, dailyReadNeeds, defReadsDaily } from '../dailyReadSupply.js'
import { SOURCE_STATUS } from '../secondaryBars.js'
import { framesNeeded } from '../useCalcFrames.js'

const N = (value) => ({ type: 'num', value })
const S = (name) => ({ type: 'series', name })
const C = (name, ...args) => ({ type: 'call', name, args })
const O = (name, ...args) => ({ type: 'op', name, args })
const TF = (value, child) => ({ type: 'tf', value, args: [child] })
const SYM = (value, child) => ({ type: 'sym', value, args: [child] })
const OFF = (value, child) => ({ type: 'offset', value, args: [child] })

// THREE SESSIONS of four 5 minute bars (09:30..09:45 New York, EST = UTC-5): Monday 12 to Wednesday 14 January 2026
const DAYS = ['2026-01-12', '2026-01-13', '2026-01-14']
const CHART = []
for (const d of DAYS) {
  for (let k = 0; k < 4; k += 1) {
    const t = Date.parse(`${d}T14:30:00Z`) / 1000 + k * 300
    const c = 200 + CHART.length
    CHART.push({ t, o: c, h: c + 1, l: c - 1, c, v: 1000 })
  }
}
// THE DAILY BARS: every weekday from Friday 2 January to Wednesday 14 January; row j closes at 100 + j
const FRAME_DAYS = ['2026-01-02', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09',
  '2026-01-12', '2026-01-13', '2026-01-14']
const dailyOf = (days, base) => days.map((t, j) => ({ t, o: base + j, h: base + j + 2, l: base + j - 2, c: base + j, v: 5000 }))
const FRAME = dailyOf(FRAME_DAYS, 100)
const SPY = dailyOf(FRAME_DAYS, 500)

const supplyOf = (frame, { symbols = {}, newestFinal = true } = {}) => ({
  bars: frame, symbols, newestFinal,
  place: (col, chartBars, tf) => projectFrameColumns(frame, { v: col }, 'D', chartBars, tf, { newestFinal }).columns.v,
})
const run = (tree, opts = {}) => Array.from(interpret(tree, CHART, {}, undefined, undefined, opts))
const five = (supply = supplyOf(FRAME), extra = {}) => ({ tf: '5', frames: { D: supply }, ...extra })
const each = (a, b, c) => [a, a, a, a, b, b, b, b, c, c, c, c]
const guardOf = (fn) => { try { fn(); return null } catch (e) { return e && e.guard } }

describe('U-DAILY — a daily read shows the last finished day on every bar of a chart below a day', () => {
  it('⭐ each bar of a day shows the DAY BEFORE it (a 3 day average of the daily close)', () => {
    // Monday 12th shows Friday 9th (row 5: (103+104+105)/3 = 104), Tuesday Monday (105), Wednesday Tuesday (106)
    expect(run(TF('D', C('sma', S('close'), N(3))), five())).toEqual(each(104, 105, 106))
  })

  it('⭐ the rest of the formula stays on the chart\'s own bars (this bar\'s close minus yesterday\'s daily close)', () => {
    const got = run(O('-', S('close'), TF('D', S('close'))), five())
    const want = CHART.map((b, i) => b.c - (i < 4 ? 105 : i < 8 ? 106 : 107))
    expect(got).toEqual(want)
  })

  it('⭐ another symbol INSIDE the read is read on its own daily bars', () => {
    expect(run(TF('D', SYM('SPY', S('close'))), five(supplyOf(FRAME, { symbols: { SPY } })))).toEqual(each(505, 506, 507))
    expect(dailyReadSymbols(TF('D', SYM('spy', S('close'))))).toEqual(['SPY'])
  })

  it('⛔ CONTROL — the newest daily bar not proven final changes nothing here: today\'s bars read yesterday, final', () => {
    expect(run(TF('D', S('close')), five(supplyOf(FRAME, { newestFinal: false })))).toEqual(each(105, 106, 107))
  })
})

describe('U-DAILY — withheld by name, never read as na', () => {
  it('⛔ a day the daily bars do not hold is withheld, and so is what reads it through nz', () => {
    const late = FRAME.slice(6)                       // the daily bars start on Monday 12th: Monday's bars read Friday
    const clock = new Map()
    const got = run(C('nz', TF('D', S('close')), N(0)), five(supplyOf(late), { chartClockSink: clock }))
    expect(got.slice(0, 4).every((v) => Number.isNaN(v))).toBe(true)     // not 0: nz never saw them
    expect(got.slice(4)).toEqual([106, 106, 106, 106, 107, 107, 107, 107])
    expect(clock.has(DAILY_READ_DAY_NOT_HELD)).toBe(true)
  })

  it('⛔ and every root bar within the tree\'s reach of it (one bar back reads the withheld bar)', () => {
    const late = FRAME.slice(6)
    const got = run(OFF(1, C('nz', TF('D', S('close')), N(0))), five(supplyOf(late)))
    expect(got.slice(0, 5).every((v) => Number.isNaN(v))).toBe(true)     // bar 4 reads bar 3: withheld, never nz's 0
    expect(got.slice(5)).toEqual([106, 106, 106, 106, 107, 107, 107])
  })

  it('⛔ no daily bars handed on a chart below a day: every bar withheld, by name', () => {
    const clock = new Map()
    const got = run(TF('D', S('close')), { tf: '5', chartClockSink: clock })
    expect(got.every((v) => Number.isNaN(v))).toBe(true)
    expect(clock.has(DAILY_READ_NO_DAILY_BARS)).toBe(true)
  })

  it('⛔ an unstated chart (the authoring gate, the server\'s daily consumers) runs the tree and withholds it all', () => {
    const got = run(O('>', S('close'), TF('D', C('sma', S('close'), N(3)))), {})
    expect(got.every((v) => Number.isNaN(v))).toBe(true)
    // …and the tree's own refusals still fire there (the gate asks whether it RUNS)
    expect(guardOf(() => run(TF('D', C('nosuch', S('close'))), {}))).not.toBe(null)
  })
})

describe('U-DAILY — refused by name', () => {
  it('⛔ on a daily or higher chart: the bars there ARE days (the 2026-09-01 step-back stays refused)', () => {
    for (const tf of ['D', 'W', 'M']) {
      expect(guardOf(() => run(TF('D', S('close')), { tf, frames: { D: supplyOf(FRAME) } }))).toBe('interpret:timeframe')
    }
    expect(TF_RESAMPLABLE).not.toContain('D')
  })

  it('⛔ inside another read, and with another timeframe inside it', () => {
    expect(guardOf(() => run(SYM('SPY', TF('D', S('close'))), five()))).toBe('interpret:timeframe')
    expect(guardOf(() => run(TF('W', TF('D', S('close'))), five()))).toBe('interpret:timeframe')
    expect(guardOf(() => run(TF('D', TF('W', S('close'))), five()))).toBe('interpret:timeframe')
  })

  it('⛔ CONTROL — a `sym` under a weekly read is still refused, and a weekly read on its own still runs', () => {
    expect(guardOf(() => run(TF('W', SYM('SPY', S('close'))), { tf: 'D' }))).toBe('interpret:symbol')
    expect(guardOf(() => maxLookback(TF('W', S('close'))))).toBe(null)
  })
})

describe('U-DAILY — the gates that never evaluate agree', () => {
  it('⭐ the lookback counts the child\'s daily reach plus the finished day', () => {
    const child = C('sma', S('close'), N(50))
    expect(maxLookback(TF('D', child))).toBe(maxLookback(child) + 1)
  })

  it('⭐ the same read written twice is ONE read: one column, one series of the budget (never more on the chart)', () => {
    const A = () => TF('D', C('sma', S('close'), N(10)))
    const B = () => TF('D', C('sma', S('close'), N(20)))
    // the 10 day average above the 20 day, and both higher than 5 bars ago: six reads written, two distinct
    const tree = O('&&', O('>', A(), B()), O('&&', O('>', A(), OFF(5, A())), O('>', B(), OFF(5, B()))))
    expect(seriesRefs(tree)).toBe(3)                 // close, and the two distinct daily reads
    expect(checkBudget(tree, undefined).ok).toBe(true)
    // the same read nine times is ONE column on the chart's bars too: the tree evaluated there stays inside the
    // budget's eight series (nine leaves would not), and each bar adds the same value nine times
    let nine = TF('D', C('sma', S('close'), N(3)))
    for (let k = 1; k < 9; k += 1) nine = O('+', nine, TF('D', C('sma', S('close'), N(3))))
    expect(run(nine, five())).toEqual(each(9 * 104, 9 * 105, 9 * 106))
  })

  it('⭐ the linter calls it non-repainting (it reads no bar the chart bar is inside)', () => {
    expect(lintRepaint(O('>', S('close'), TF('D', C('sma', S('close'), N(50))))).mode).toBe('non-repainting')
    expect(DAILY_READ_CODE).toBe(DAILY_READ)
  })

  it('⭐ the read-back names the day it shows', () => {
    expect(sentenceFor(TF('D', C('sma', S('close'), N(50))), {})).toContain('on daily bars, as of the last finished day')
  })

  it('⭐ what reads a daily value, and what is below a day', () => {
    expect(treeReadsDaily(O('+', S('close'), TF('D', S('close'))))).toBe(true)
    expect(treeReadsDaily(TF('W', S('close')))).toBe(false)
    expect(['1', '5', '60', '240'].every(isBelowADay)).toBe(true)
    expect(['D', 'W', 'M', '', null, undefined, '0', '5m'].some(isBelowADay)).toBe(false)
  })
})

// ─── the chart's half: which daily bars are fetched, and what the binder hands ────────────────────────────────────
const DEF = { id: 'u_daily', compute: { kind: 'ast', ast: O('>', S('close'), TF('D', SYM('SPY', S('close')))) },
  plots: [{ key: 'value', style: 'line' }] }
const PLAIN = { id: 'u_plain', compute: { kind: 'ast', ast: C('sma', S('close'), N(50)) }, plots: [{ key: 'value', style: 'line' }] }
const entry = (bars, newestBarIsForming = false) => ({ status: SOURCE_STATUS.AVAILABLE, bars, newestBarIsForming })

describe('U-DAILY — the daily bars a chart hands', () => {
  it('⭐ the chart symbol first, then each symbol a daily read names; nothing for a document that reads none', () => {
    expect(defReadsDaily(DEF)).toBe(true)
    expect(dailyReadNeeds(DEF, 'nvda')).toEqual(['NVDA', 'SPY'])
    expect(dailyReadNeeds(PLAIN, 'NVDA')).toEqual([])
  })

  it('⛔ PENDING until the chart symbol\'s daily bars are in hand (never computed without them), null off an intraday chart', () => {
    expect(dailyReadSupplyFor(DEF, new Map(), 'NVDA', '5')).toEqual({ pending: true })
    expect(dailyReadSupplyFor(DEF, new Map([[frameKey('D', 'NVDA'), { status: SOURCE_STATUS.LOADING }]]), 'NVDA', '5'))
      .toEqual({ pending: true })
    expect(dailyReadSupplyFor(DEF, new Map(), 'NVDA', 'D')).toBe(null)
    expect(dailyReadSupplyFor(PLAIN, new Map(), 'NVDA', '5')).toBe(null)
  })

  it('⭐ in hand: the bars, the other symbols held, the newest bar\'s state, and the chart\'s own projection as `place`', () => {
    const frames = new Map([[frameKey('D', 'NVDA'), entry(FRAME)], [frameKey('D', 'SPY'), entry(SPY)]])
    const got = dailyReadSupplyFor(DEF, frames, 'NVDA', '5')
    expect(got.frame.bars).toBe(FRAME)
    expect(got.frame.symbols).toEqual({ SPY })
    expect(got.frame.newestFinal).toBe(true)
    const col = Float64Array.from(FRAME, (_b, j) => j)
    expect(Array.from(got.frame.place(col, CHART, '5')))
      .toEqual(Array.from(projectFrameColumns(FRAME, { v: col }, 'D', CHART, '5', { newestFinal: true }).columns.v))
    expect(got.frame.stale).toBe(false)
    // and the signature moves when a new bars array lands (the binder's memo key)
    const again = dailyReadSupplyFor(DEF, new Map([[frameKey('D', 'NVDA'), entry([...FRAME])], [frameKey('D', 'SPY'), entry(SPY)]]), 'NVDA', '5')
    expect(again.sig).not.toBe(got.sig)
  })

  it('⭐ daily bars behind the chart say so (the binder asks for a refresh)', () => {
    const behind = FRAME.slice(0, 6)                // they end on Friday 9th: the chart's Tuesday shows a day they lack
    const got = dailyReadSupplyFor(DEF, new Map([[frameKey('D', 'NVDA'), entry(behind)]]), 'NVDA', '5')
    got.frame.place(Float64Array.from(behind, (_b, j) => j), CHART, '5')
    expect(got.frame.stale).toBe(true)
  })

  it('⭐ the frames a chart below a day fetches for it, and none on a daily chart', () => {
    const insts = [{ instanceId: 'i1', defId: 'u_daily', inputs: {} }]
    const defOf = (id) => (id === 'u_daily' ? DEF : null)
    const keys = framesNeeded(insts, defOf, 'NVDA', '5').map((f) => frameKey(f.frame, f.symbol)).sort()
    expect(keys).toEqual([frameKey('D', 'NVDA'), frameKey('D', 'SPY')].sort())
    expect(framesNeeded(insts, defOf, 'NVDA', 'D')).toEqual([])
  })
})
