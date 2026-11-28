// app/src/components/chart/builder/authoring/intradayHtfFormula.test.js
//
// ─── ⭐⭐ E101 INTRADAY-HTF (2026-11-28) — A FORMULA READS A HIGHER INTRADAY TIMEFRAME, THE LAST CLOSED BUCKET ──────────
//
// The write-capability eval's w02, "On a 15 minute chart, plot the 1 hour 50 EMA and shade the background green while
// the close is above it", was refused on every lane: the runtime lane cannot draw it off the listing (R-W, e102), and a
// formula could read only weeks and months. A formula's `tf(x, '60')` is now x on 60 minute bars of this chart's own
// symbol, as of the last CLOSED 60 minute bar (the daily read's rule, one rung down), on the chart's own grid
// (`interpret.js::periodStamps`), and the formula lane's start masks apply to it as to any read. These rails hold:
//   * the browser's patch gate admits it on a chart below a day whose minutes divide the code, refuses it elsewhere,
//     and reads it back in the words a member is asked to trust;
//   * its value on a 15 minute chart is the last CLOSED hour's (hand-written), and the bar closing an hour does not
//     yet read that hour (non-repainting: no future bar);
//   * the linter's span row is the evaluator's (`INTRADAY_HTF_SPANS` = `INTRADAY_HTF_MIN_SPAN`).
import { describe, it, expect } from 'vitest'
import { gateTree, CROSS_CONTEXT } from './applyPatch'
import CROSS from './crossContext.json'
import { interpret, INTRADAY_HTF_CODES, INTRADAY_HTF_MIN_SPAN } from '../../engine/ast/interpret'
import { INTRADAY_HTF_SPANS } from '../../engine/ast/lint'

const S = (name) => ({ type: 'series', name })
const N = (value) => ({ type: 'num', value })
const C = (name, ...args) => ({ type: 'call', name, args })
const O = (name, ...args) => ({ type: 'op', name, args })
const HOUR = (child) => ({ type: 'tf', value: '60', args: [child] })
// w02's formula: the close above the 1 hour 50 EMA
const W02 = O('>', S('close'), HOUR(C('ema', S('close'), N(50))))
const codeOf = (fn) => { try { fn(); return null } catch (e) { return e && e.code } }

describe('the patch gate', () => {
  it('⭐ admits a read of 60 minutes on a 15 minute chart, non-repainting, read back as the last closed hour', () => {
    const g = gateTree(W02, {}, 'value', { tf: '15', symbol: 'NVDA' })
    expect(g.mode).toBe('non-repainting')
    expect(g.readback).toContain('on 60 minute bars, as of the last closed 60 minute bar')
    for (const tf of ['1', '5', '30']) expect(codeOf(() => gateTree(W02, {}, 'value', { tf }))).toBe(null)
  })
  it('⛔ refuses it on a daily chart, above a chart whose minutes do not divide it, on its own timeframe, and unsaid', () => {
    for (const ctx of [{ tf: 'D' }, { tf: 'W' }, { tf: '45' }, { tf: '60' }, { tf: '120' }, {}, null]) {
      expect(codeOf(() => gateTree(W02, {}, 'value', ctx)), JSON.stringify(ctx)).toBe('tree:timeframe')
    }
    expect(() => gateTree(W02, {}, 'value', { tf: '45' })).toThrow(/whole number/)
  })
  it('reads its codes from the shared file (one authority with the server door)', () => {
    expect(CROSS.tfIntradayCodes).toEqual(INTRADAY_HTF_CODES)
    expect(CROSS_CONTEXT.tfIntradayCodes).toEqual(INTRADAY_HTF_CODES)
    expect(CROSS.tfCodes).toEqual(['W', 'M'])
  })
})

describe('the value on a 15 minute chart is the last CLOSED hour', () => {
  const ET = (day, hh, mm) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d, hh + 5, mm) / 1000 }
  const BARS = Array.from({ length: 26 }, (_, k) => ET('2026-01-12', 9, 30) + k * 900)
    .map((t, i) => ({ t, o: i + 1, h: i + 1.5, l: i + 0.5, c: i + 1, v: 1 }))
  const col = (tree) => Array.from(interpret(tree, BARS, {}, undefined, undefined, { tf: '15', historyFromListing: true }))
    .map((v) => (Number.isFinite(v) ? v : null))
  it('⭐ tf(close, 60): the first hour has no closed hour before it; 10:30-11:15 read 4 (the 09:30 hour closed at 10:15)', () => {
    const c = col(HOUR(S('close')))
    expect(c.slice(0, 4)).toEqual([null, null, null, null])   // 10:15 closes the 09:30 hour but does not READ it: no lookahead
    expect(c.slice(4, 8)).toEqual([4, 4, 4, 4])
    expect(c[8]).toBe(8)
    expect(c[25]).toBe(24)                                     // 15:45, in the short 15:30 bucket, reads the 14:30 hour's 24
  })
  it('⭐ the child runs on the hourly bars: tf(sma(close, 2), 60) is the mean of the last two closed hours', () => {
    const c = col(HOUR(C('sma', S('close'), N(2))))
    expect(c[8]).toBe(6)                                       // (4 + 8) / 2
  })
})

describe('the linter and the evaluator agree on the span', () => {
  it('every intraday code counts its child at INTRADAY_HTF_MIN_SPAN chart bars in both', () => {
    for (const code of INTRADAY_HTF_CODES) expect(INTRADAY_HTF_SPANS[code]).toBe(INTRADAY_HTF_MIN_SPAN)
  })
})
