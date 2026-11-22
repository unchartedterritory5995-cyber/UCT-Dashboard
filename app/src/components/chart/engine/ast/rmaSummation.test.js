// app/src/components/chart/engine/ast/rmaSummation.test.js
//
// ─── ⭐⭐ LANDING TRAIN 1 — `ta.rma` IN TRADINGVIEW'S OWN ARITHMETIC, HELD TO THE BIT ─────────────
//
// TradingView's `ta.rma` is `(prev * (n - 1) + src) / n`. Measured offline against float64 bit
// patterns (not a tolerance) on licence-held captures, 4,063 of 4,063 values:
//   vw-w3n-draw-block-history-c-spy-1d-2026-11-15   `ta.rma(close, 3)` per call site   501 / 501
//   vw-w3n-draw-block-history-c-rddt-1d-2026-11-15  the same on NYSE:RDDT              314 / 314
//   average-true-range-rddt-1d-2026-11-14           builtin ATR(14)                    653 / 653
//   relative-strength-index-rddt-1d-2026-11-14      builtin RSI(14)                    652 / 652
//   directional-movement-index-rddt-1d-2026-11-14   builtin DMI(14): +DI, -DI, ADX     652, 652, 639
// The spelling this engine used, `prev * (1 - 1/n) + src * (1/n)`, matched 62, 45, 52, 281, 121,
// 67 and 72 of those and was one unit in the last place off on the rest.
// (`docs/pine/evidence/2026-11-16-rma-summation/EVIDENCE.md`.)
//
// The captures stay out of git. The builtin ATR capture's bars ARE the committed RDDT fixture's
// 666 sessions (checked bar for bar), so the ten doubles below, read off that capture, are what
// TradingView draws for `ta.rma(ta.tr(true), 14)` over committed bars; six of them differ from
// the old spelling in their last bits (bars 16, 50, 100, 333, 500, 665).
import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'
import { interpret, CARRIED, FN, carriedCellsOf } from './interpret.js'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from '../runtime/runtimeColumns.js'

const REPO = path.resolve(process.cwd(), '..')
const RDDT = JSON.parse(fs.readFileSync(path.join(REPO,
  'tests/fixtures/vendor/harness/support-and-resistance-5f95e90f-rddt-1d-2026-11-13.json'), 'utf8')).bars.rows
  .map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const CTX = { tf: 'D', newestBarIsForming: false, historyFromListing: true }

/** TradingView, builtin ATR(14), NYSE:RDDT 1D from the listing: bar -> the plotted double. */
const TV_ATR14 = Object.freeze({
  13: 7.250335714285716, 14: 7.042454591836736, 15: 6.70870783527697, 16: 6.414514418471472,
  50: 4.4190304995348, 100: 4.2696716837663855, 200: 11.144666762069308, 333: 8.012469608006338,
  500: 8.400680456350505, 665: 8.071162948989976,
})
const BARS_THE_OLD_SPELLING_MISSED = [16, 50, 100, 333, 500, 665]

/** Pine's `ta.tr(true)` over the committed bars, in this file's own words. */
const TR = RDDT.map((b, i) => (i === 0 ? b.h - b.l
  : Math.max(b.h - b.l, Math.abs(b.h - RDDT[i - 1].c), Math.abs(b.l - RDDT[i - 1].c))))
/** The witnessed recurrence, written out here (never imported): an SMA seed, then one step a bar. */
const reference = (src, n, step) => {
  const out = new Array(src.length).fill(NaN)
  let prev = NaN
  let sum = 0
  for (let i = 0; i < src.length; i++) {
    if (Number.isNaN(prev)) { sum += src[i]; if (i === n - 1) { prev = sum / n; out[i] = prev } } else { prev = step(prev, src[i], n); out[i] = prev }
  }
  return out
}
const TV_STEP = (prev, v, n) => (prev * (n - 1) + v) / n
const OLD_STEP = (prev, v, n) => prev * (1 - 1 / n) + v * (1 / n)
const hostColumn = (src) => {
  const t = translatePine(src, { strict: true, basePeriod: 'D' })
  expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
  return Array.from(interpret(t.outputs[0].ast, RDDT, undefined, undefined, undefined, { historyFromListing: true, tf: 'D' }))
}
const runtimeColumn = (src) => Array.from(computeRuntimeColumns({
  id: 'rma', meta: { runtimeHistory: 'listing' }, compute: { kind: 'runtime', fn: 'runtime:rma', outputs: { a: 0 }, source: src },
}, RDDT, CTX).a)
const v6 = (...lines) => ['//@version=6', 'indicator("rma")', ...lines].join('\n')
const bitsEqual = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]) || (Number.isNaN(v) && Number.isNaN(b[i])))

beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })

describe('the witness is what this file says it is', () => {
  it('666 committed RDDT sessions; the reference in TradingView\'s arithmetic is the ten captured doubles, bit for bit', () => {
    expect(RDDT).toHaveLength(666)
    const ref = reference(TR, 14, TV_STEP)
    for (const [bar, want] of Object.entries(TV_ATR14)) expect(Object.is(ref[bar], want), `bar ${bar}: ${ref[bar]} vs ${want}`).toBe(true)
  })
  it('⛔ and the old spelling is NOT: it misses six of the ten in their last bits (the rail can fail)', () => {
    const old = reference(TR, 14, OLD_STEP)
    const missed = Object.keys(TV_ATR14).map(Number).filter((bar) => !Object.is(old[bar], TV_ATR14[bar]))
    expect(missed).toEqual(BARS_THE_OLD_SPELLING_MISSED)
    for (const bar of missed) expect(Math.abs(old[bar] - TV_ATR14[bar])).toBeLessThan(1e-12 * TV_ATR14[bar])
  })
})

describe('⭐⭐ every lane draws TradingView\'s doubles', () => {
  const REF14 = reference(TR, 14, TV_STEP)
  it('the kernel table: `CARRIED.rma` stepped over the true range, every bar', () => {
    const spec = CARRIED.rma
    const st = new Float64Array(carriedCellsOf(spec, 14))
    spec.init(st, 0)
    const col = TR.map((v) => spec.step(st, 0, v, 14, spec.alpha(14)))
    expect(bitsEqual(col, REF14)).toBe(true)
    expect(bitsEqual(Array.from(FN.rma(Float64Array.from(TR), 14)), REF14)).toBe(true)
  })
  it('the host lane: `ta.rma(ta.tr(true), 14)` and `ta.atr(14)`, the ten captured doubles and every other bar', () => {
    for (const body of ['plot(ta.rma(ta.tr(true), 14))', 'plot(ta.atr(14))']) {
      const col = hostColumn(v6(body))
      for (const [bar, want] of Object.entries(TV_ATR14)) expect(Object.is(col[bar], want), `${body} bar ${bar}: ${col[bar]} vs ${want}`).toBe(true)
      expect(bitsEqual(col, REF14), body).toBe(true)
    }
  })
  it('the runtime lane, a pure column and a value the VM steps bar by bar (its own kernel)', () => {
    const pure = runtimeColumn(v6('plot(ta.rma(ta.tr(true), 14))'))
    expect(bitsEqual(pure, REF14)).toBe(true)
    // `x` is reassigned, so `ta.rma(x, 14)` is stepped by the VM's carried kernel, not folded to a column
    const stepped = runtimeColumn(v6('float x = na', 'x := ta.tr(true)', 'plot(ta.rma(x, 14))'))
    for (const [bar, want] of Object.entries(TV_ATR14)) expect(Object.is(stepped[bar], want), `bar ${bar}: ${stepped[bar]} vs ${want}`).toBe(true)
    expect(bitsEqual(stepped, REF14)).toBe(true)
  })
  it('another length and another source: `ta.rma(close, 3)` is the same recurrence on every lane', () => {
    const want = reference(RDDT.map((b) => b.c), 3, TV_STEP)
    expect(bitsEqual(hostColumn(v6('plot(ta.rma(close, 3))')), want)).toBe(true)
    expect(bitsEqual(runtimeColumn(v6('float x = na', 'x := close', 'plot(ta.rma(x, 3))')), want)).toBe(true)
  })
  it('⛔ CONTROL: `ta.ema` is untouched (its last bit is not measured): still the exponential spelling', () => {
    const k = 2 / (14 + 1)
    const want = reference(RDDT.map((b) => b.c), 14, (prev, v) => prev * (1 - k) + v * k)
    expect(bitsEqual(hostColumn(v6('plot(ta.ema(close, 14))')), want)).toBe(true)
  })
})
