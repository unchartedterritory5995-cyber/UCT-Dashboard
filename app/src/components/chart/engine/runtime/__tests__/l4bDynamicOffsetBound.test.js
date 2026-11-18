// app/src/components/chart/engine/runtime/__tests__/l4bDynamicOffsetBound.test.js
//
// ─── L4b — A DYNAMIC HISTORY OFFSET: A PROVED BOUND, OR A DECLARED BUFFER ─────
//
// RS Rating (Fred6724, MPL-2.0, `indicator(..., max_bars_back = 253)`) reads
// `closeDa[n63]` with `n63 = bar_index < 63 ? bar_index : 63`, and `curveRsPerf[i]`
// in `for i = delta to 34 + delta`, `delta = ta.barssince(...)`. A variable's past
// lives in a ring sized before bar 0, so the runtime lane refused both
// (`runtime:history-dynamic-offset`). Pine's rule: a series keeps `max_bars_back`
// bars of history, and a read past that buffer is a RUNTIME ERROR, never `na`.
//
//   (a) a bound proved before bar 0 sizes the ring (`offsetRange`): `bar_index` is
//       `[0, +inf)`, narrowed by the `?:` test that guards it; `math.min`; a name
//       bound once; `ta.barssince` (`>= 0`, may be `na`, which reads the current bar);
//   (b) no proved top, but a DECLARED buffer (`max_bars_back = N`, or a root
//       `max_bars_back(x, 5000)`): the ring is the buffer, and a read past it stops
//       the run in the VM by name;
//   (c) neither: the refusal stands, by name.
// The bottom of the range is always proved (a negative offset has no answer here).
//
// Every number is graded against a hand computation of Pine's semantics over the
// same synthetic bars. Each admitted shape has a control that must refuse.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

import { N, BARS, SERIES, C, O, RS_RATING_MATH, rsByHand } from '../__fixtures__/rsRatingSynthetic.js'

const opts = (objectsInRun) => ({
  bars: BARS, inputs: {}, tf: 'D', basePeriod: 'D', ...runtimeClockOpts(false, { tf: 'D' }),
  ...(objectsInRun ? { objectsInRun: true } : {}),
})
const build = (src, objectsInRun = false) => buildRuntimeIr(src, opts(objectsInRun))
const programOf = (src, objectsInRun = false) => {
  const built = build(src, objectsInRun)
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  return lowerIrProgram(built.ir)
}
const runOn = (program, bars = N) => execute(program, {
  bars, series: SERIES.map((s) => s.slice(0, bars)), columns: program.columns.map((c) => c.slice(0, bars)),
  confirmed: true, barTimes: BARS.slice(0, bars).map((b) => b.t),
})
const run = (src, objectsInRun = false) => runOn(programOf(src, objectsInRun)).outputs.map((o) => Array.from(o))
const guardOf = (src, objectsInRun = false) => {
  const b = build(src, objectsInRun)
  return b.ok ? null : b.refusal.guard
}
const close = (a, b) => (Number.isNaN(a) ? Number.isNaN(b) : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)))
const expectSeries = (got, want) => {
  expect(got).toHaveLength(want.length)
  want.forEach((w, i) => expect(close(got[i], w), `bar ${i}: got ${got[i]}, want ${w}`).toBe(true))
}

const v5 = (decl, ...lines) => [`//@version=5`, `indicator("t"${decl})`, ...lines].join('\n') + '\n'
const X = (b) => 2 * C[b] - O[b]
const SLOT_X = ['var float x = 0.0', 'x := close * 2 - open']

describe('(a) a bound proved before bar 0 sizes the ring', () => {
  const capAt5 = Array.from({ length: N }, (_, b) => X(b - Math.min(b, 5)))
  it.each([
    ['a ternary capping bar_index, bound to a name', ['n = bar_index < 5 ? bar_index : 5', 'plot(x[n])']],
    ['the same ternary written in the offset', ['plot(x[bar_index < 5 ? bar_index : 5])']],
    ['the test mirrored (`5 > bar_index`)', ['n = 5 > bar_index ? bar_index : 5', 'plot(x[n])']],
    ['the test negated (`bar_index >= 5 ? 5 : bar_index`)', ['plot(x[bar_index >= 5 ? 5 : bar_index])']],
    ['math.min(bar_index, 5)', ['plot(x[math.min(bar_index, 5)])']],
  ])('%s: the read is x at bar - min(bar, 5), both builds', (_, body) => {
    for (const objectsInRun of [false, true]) {
      const [y] = run(v5('', ...SLOT_X, ...body), objectsInRun)
      expectSeries(y, capAt5)
    }
  })

  it.each([
    ['the arms swapped (`bar_index < 5 ? 5 : bar_index` has no top)', 'plot(x[bar_index < 5 ? 5 : bar_index])'],
    ['the test reversed (`bar_index > 5 ? bar_index : 5` has no top)', 'plot(x[bar_index > 5 ? bar_index : 5])'],
    ['a test that is not about bar_index proves nothing', 'plot(x[close < 5 ? bar_index : 5])'],
    ['math.max(bar_index, 5) has no top', 'plot(x[math.max(bar_index, 5)])'],
    ['bar_index itself has no top', 'plot(x[bar_index])'],
  ])('CONTROL, no declaration: %s — refused by name', (_, line) => {
    for (const objectsInRun of [false, true]) {
      expect(guardOf(v5('', ...SLOT_X, line), objectsInRun)).toBe('runtime:history-dynamic-offset')
    }
  })

  it('⛔ a bound that may be `na` proves no bar_index fact: a failed test is not `bar_index <= k`', () => {
    // `close > open * 2` never holds: `d` is `na` on every bar, and so is the counter, so
    // the test is FALSE without `bar_index <= 10`: the offset is `bar_index`, no top.
    const naK = ['d = ta.barssince(close > open * 2)', 's = 0.0', 'for j = d to d',
      '    s := x[bar_index > math.min(j, 10) ? 3 : bar_index]', 'plot(s)']
    for (const objectsInRun of [false, true]) {
      expect(guardOf(v5('', ...SLOT_X, ...naK), objectsInRun)).toBe('runtime:history-dynamic-offset')
    }
    // CONTROL: the same shape over a `k` that is never `na` builds, and reads right
    const [y] = run(v5('', ...SLOT_X, 'plot(x[bar_index > math.min(7, 10) ? 3 : bar_index])'))
    expectSeries(y, Array.from({ length: N }, (_, b) => X(b > 7 ? b - 3 : 0)))
  })

  it('a named constant over a COLUMN is that constant (it read "counts backwards")', () => {
    const [a, ref] = run(v5('', 'n63 = 63', 'closeDa = request.security(syminfo.tickerid, "D", close)',
      'plot(closeDa[n63])', 'plot(close[63])'))
    expectSeries(a, ref)
    expect(a.filter((v) => !Number.isNaN(v))).toHaveLength(N - 63)   // non-vacuity
  })
})

// `ta.barssince(close > open)` by hand: bars since the last bar it held, `na` before
const BARSSINCE = (() => {
  let last = -1
  return C.map((c, b) => { if (c > O[b]) last = b; return last < 0 ? NaN : b - last })
})()

describe('(b) no proved top: a DECLARED buffer sizes the ring, and a read past it stops the run', () => {
  const loop = ['var float x = 0.0', 'x := close', 'd = ta.barssince(close > open)', 's = 0.0',
    'for i = d to d + 3', '    s := s + nz(x[i])', 'plot(s)']
  const want = Array.from({ length: N }, (_, b) => {
    let s = 0
    for (let i = BARSSINCE[b]; i <= BARSSINCE[b] + 3; i += 1) s += b - i >= 0 ? C[b - i] : 0
    return s
  })
  it('the bars are what this rail needs: `close > open` on bar 0, and `d` reaches past 0', () => {
    expect(BARSSINCE[0]).toBe(0)
    expect(Math.max(...BARSSINCE)).toBeGreaterThan(0)
  })
  it('`indicator(max_bars_back = 50)`: builds in both builds, and every bar is the hand sum', () => {
    for (const objectsInRun of [false, true]) expectSeries(run(v5(', max_bars_back = 50', ...loop), objectsInRun)[0], want)
  })
  it('the bound read through a SLOT declared once (`d = ta.barssince(x > open)` reads x)', () => {
    // RS Rating's `delta` reads the request's value, which the run holds: `d` is a slot
    const src = v5(', max_bars_back = 50', loop[0], loop[1], 'd = ta.barssince(x > open)', ...loop.slice(3))
    for (const objectsInRun of [false, true]) expectSeries(run(src, objectsInRun)[0], want)
  })
  it('`indicator(max_bars_back = 5000)`, Pine\'s ceiling itself, is a declaration too', () => {
    for (const objectsInRun of [false, true]) expectSeries(run(v5(', max_bars_back = 5000', ...loop), objectsInRun)[0], want)
  })
  it('a root `max_bars_back(x, 5000)` declares x\'s buffer: builds, and reads the same', () => {
    const src = v5('', loop[0], loop[1], 'max_bars_back(x, 5000)', ...loop.slice(2))
    for (const objectsInRun of [false, true]) expectSeries(run(src, objectsInRun)[0], want)
  })
  it('CONTROL: no declaration — refused by name, both builds', () => {
    for (const objectsInRun of [false, true]) expect(guardOf(v5('', ...loop), objectsInRun)).toBe('runtime:history-dynamic-offset')
  })
  it('CONTROL: `max_bars_back(x, 5000)` for ANOTHER series declares nothing for x', () => {
    const src = v5('', loop[0], loop[1], 'var float y = 0.0', 'y := open', 'max_bars_back(y, 5000)', ...loop.slice(2))
    expect(guardOf(src)).toBe('runtime:history-dynamic-offset')
  })
  it('CONTROL: a bottom that is not proved stays refused even under a declaration', () => {
    const src = v5(', max_bars_back = 50', 'var float x = 0.0', 'x := close', 'd = ta.barssince(close > open)',
      's = 0.0', 'for i = d to d + 3', '    s := s + nz(x[i - 1])', 'plot(s)')
    for (const objectsInRun of [false, true]) expect(guardOf(src, objectsInRun)).toBe('runtime:history-dynamic-offset')
  })
  it('a read past the declared buffer is the REAL history, never a stop and never `na` (WS-C Q1 M2 / Q-MBB, captured 2026-11-18)', () => {
    // `ta.barssince(bar_index == 0)` is the bar index, so bar 21 reads x[21], past the declared 20: TradingView answers it
    // (Fred RS's seed loop reads `curveRsPerf[423 ..]` past its declared 253 on a 5m chart and still draws its labels)
    const src = v5(', max_bars_back = 20', 'var float x = 0.0', 'x := close',
      'd = ta.barssince(bar_index == 0)', 's = 0.0', 'for i = d to d', '    s := x[i]', 'plot(s)')
    for (const objectsInRun of [false, true]) {
      const out = runOn(programOf(src, objectsInRun), 40).outputs[0]
      for (let b = 0; b < 40; b += 1) expect(out[b]).toBe(C[0])   // x[bar] is bar 0's close, past 20 too
    }
  })
})

describe('the memory budget sees a declared ring', () => {
  it('a proved top past a declared buffer keeps a ring of the TOP: the declared number bounds nothing', () => {
    const src = v5(', max_bars_back = 20', 'var float x = 0.0', 'x := close', 'plot(x[math.min(bar_index, 4000)])')
    const built = build(src)
    expect(built.ok).toBe(true)
    const rings = lowerIrProgram(built.ir).history.filter((h) => h.name === 'x')
    expect(rings.map((h) => h.depth)).toEqual([4000])
    const out = runOn(programOf(src), 40).outputs[0]
    expect(out[30]).toBe(C[0])                                   // x[30], past the declared 20
  })
  it('a declared ring with NO proved top is Pine\'s 5,000, never the declared number and never the chart\'s length', () => {
    const src = v5(', max_bars_back = 20', 'var float x = 0.0', 'x := close',
      'd = ta.barssince(bar_index == 0)', 's = 0.0', 'for i = d to d', '    s := x[i]', 'plot(s)')
    const rings = lowerIrProgram(build(src).ir).history.filter((h) => h.name === 'x')
    expect(rings.map((h) => h.depth)).toEqual([5000])
  })
  it('⛔ TRAP A — the ring does not depend on the chart the build saw: built on N bars or on 4,000, one 5,000 ring, and the grown chart reads the real history', () => {
    const src = v5(', max_bars_back = 20', 'var float x = 0.0', 'x := close',
      'd = bar_index', 's = 0.0', 'for i = d to d', '    s := x[i]', 'plot(s)')
    const M = 4000
    const grown = Array.from({ length: M }, (_, i) => ({ ...BARS[i % N], t: BARS[0].t + i * 86400 }))
    const ringOf = (bars) => {
      const b = buildRuntimeIr(src, { ...opts(false), bars })
      expect(b.ok, b.ok ? '' : b.refusal.message).toBe(true)
      return { program: lowerIrProgram(b.ir), depth: lowerIrProgram(b.ir).history.filter((h) => h.name === 'x').map((h) => h.depth) }
    }
    const small = ringOf(BARS)
    const big = ringOf(grown)
    expect(small.depth).toEqual([5000])
    expect(big.depth).toEqual(small.depth)                       // a reused build's ring holds the grown chart too
    const out = execute(big.program, {
      bars: M, series: ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(grown.map((b) => b[k]))), columns: big.program.columns,
      confirmed: true, barTimes: grown.map((b) => b.t),
    }).outputs[0]
    expect(out[M - 1]).toBe(grown[0].c)                          // x[3,999] is bar 0's close
  })
  const many = (k) => v5(', max_bars_back = 4999',
    ...Array.from({ length: k }, (_, j) => [`var float x${j} = 0.0`, `x${j} := close + ${j}`]).flat(),
    'd = ta.barssince(close > open)', 's = 0.0', 'for i = d to d',
    ...Array.from({ length: k }, (_, j) => `    s := s + nz(x${j}[i])`), 'plot(s)')
  // the rings are sized to the CHART now (`boundedSlotOffset`), so the budget is proved on a chart long enough to fill
  // them: 5,000 bars, every ring Pine's 5,000
  const LONG = Array.from({ length: 5000 }, (_, i) => ({ ...BARS[i % N], t: BARS[0].t + i * 86400 }))
  const programOnLong = (src) => {
    const built = buildRuntimeIr(src, { ...opts(false), bars: LONG })
    if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
    return lowerIrProgram(built.ir)
  }
  it('60 rings of 5,000 bars pass HISTORY_VALUES (262,144): the run is refused before bar 0, by name', () => {
    const program = programOnLong(many(60))
    expect(program.history.filter((h) => /^x\d+$/.test(h.name)).every((h) => h.depth === 5000)).toBe(true)
    let err = null
    try { runOn(program, 5) } catch (e) { err = e }
    expect(err && err.name).toBe('RuntimeLimitError')
    expect(err.limit).toBe('HISTORY_VALUES')
  })
  it('CONTROL: 50 such rings fit, and run', () => {
    expect(() => runOn(programOnLong(many(50)), 5)).not.toThrow()
  })
})

// ─── RS Rating's rating math (Fred6724, MPL-2.0), over synthetic series ──────
// `request.security` is another lane (L5): here the two closes and the seed are
// variables the run holds, which is what an other-symbol request's value is.
const RS = v5(', overlay = true, max_bars_back = 253',
  ...RS_RATING_MATH,
  'plot(totalRsRating, title="RS Rating value")',
  'plot(totalRsScore, title="score")')

describe('RS Rating\'s rating math builds on the runtime lane and equals the hand computation', () => {
  const hand = rsByHand()
  it('the hand computation is not vacuous: 7 thresholds, and the rating takes many values', () => {
    expect(hand.values.every((v) => Number.isFinite(v) && v !== 0)).toBe(true)
    const distinct = new Set(hand.rating.map((r) => Math.round(r)))
    expect(distinct.size).toBeGreaterThan(5)
    expect(hand.rating.some((r) => r > 1 && r < 99 && r !== Math.round(r))).toBe(true)   // a percentile branch ran
  })
  it.each([[false, 'the value build'], [true, 'the drawing build (objectsInRun)']])('%s', (objectsInRun) => {
    const [rating, score] = run(RS, objectsInRun)
    expectSeries(score, hand.score)
    expectSeries(rating, hand.rating)
  })
  it('CONTROL: without `max_bars_back`, the seed loop is refused by name', () => {
    const undeclared = RS.replace(', overlay = true, max_bars_back = 253', ', overlay = true')
    for (const objectsInRun of [false, true]) expect(guardOf(undeclared, objectsInRun)).toBe('runtime:history-dynamic-offset')
  })
})
