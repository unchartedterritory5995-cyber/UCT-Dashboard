// app/src/components/chart/engine/runtime/__tests__/runtimeWarmupEarlyStop.test.js
//
// ⭐⭐⭐ UIE PHASE 3 (M1) — THE CURTAIN'S SECOND RUN STOPS ONLY WHEN IT IS PROVEN TO
// REPEAT THE FIRST (`warmupProbe.js`, `vmState.js`, the VM's `opts.probe`).
//
// The one property that matters: with the early stop and without it, a member's chart
// draws EXACTLY the same thing — the same values on every bar, the same withheld
// warm-up, the same refusal. Each case below is a shape of state the proof has to
// carry (vars, arrays, records, a call site's own `var`, history rings, nested loops),
// or a way for two runs with EQUAL state to still diverge (a precomputed column that
// depends on the first bar, a read of the past that reaches before the second run's
// first bar, constant or dynamic) — each is a case a weaker proof would draw wrongly.
import { describe, it, expect } from 'vitest'
import { computeRuntimeColumns, runtimeWarmupOf } from '../runtimeColumns.js'
import { encodeState, sameState } from '../vmState.js'
import { makeWarmupProbe, warmupCheckpoints, columnAgreesFrom } from '../warmupProbe.js'
import { udtRecord } from '../records.js'

const FULL = 6000
const bars = Array.from({ length: FULL }, (_, i) => {
  const c = 100 + 12 * Math.sin(i / 17) + 4 * Math.sin(i / 5.3) + i * 0.01
  return { t: 1500000000 + i * 86400, o: c - 0.3, h: c + 1.1, l: c - 0.9, c, v: 1000 + (i % 29) * 7 }
})
const WINDOW = bars.slice(FULL - 4000)
const doc = (body, extra = {}) => ({
  id: 'w', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:w', outputs: { v: 0 }, source: `//@version=6\nindicator("w")\n${body}`, ...extra },
})
const D = { tf: 'D', newestBarIsForming: false }

function both(d, rows = WINDOW, ctx = D) {
  const run = (es) => {
    try {
      const r = computeRuntimeColumns(d, rows, ctx, { warmupEarlyStop: es })
      return { v: r.v, w: runtimeWarmupOf(r) }
    } catch (e) { return { guard: e.guard || e.name } }
  }
  return { full: run(false), early: run(true) }
}
const expectSameDrawing = ({ full, early }) => {
  expect(early.guard).toBe(full.guard)
  if (full.guard) return
  expect(early.w.withheldBars).toBe(full.w.withheldBars)
  expect(early.v.length).toBe(full.v.length)
  for (let i = 0; i < full.v.length; i += 1) expect(Object.is(early.v[i], full.v[i]), `bar ${i}`).toBe(true)
}

const STOPS = {
  'a var recurrence': 'var float x = na\nx := na(x) ? close : 0.9 * x + 0.1 * close\nplot(x)\n',
  'ta.rsi (a precomputed column)': 'plot(ta.rsi(close, 14))\n',
  'a window (ta.sma)': 'plot(ta.sma(close, 20))\n',
  'an array (var, push/shift)': 'var a = array.new_float(0)\narray.push(a, close)\nif array.size(a) > 20\n    array.shift(a)\nplot(array.avg(a))\n',
  'a user-defined type': 'type P\n    float v\nvar p = P.new(0)\np.v := 0.5 * p.v + 0.5 * close\nplot(p.v)\n',
  "a function's own var (one call site)": 'f(x) =>\n    var float s = na\n    s := na(s) ? x : 0.8 * s + 0.2 * x\n    s\nplot(f(close))\n',
  'nested loops over the past': 'var float acc = 0\nfloat t = 0\nfor i = 0 to 4\n    for j = 0 to 4\n        t += close[i] * j\nacc := 0.7 * acc + 0.3 * t\nplot(acc)\n',
  'a history ring (x[k] of a var)': 'var float x = 0\nx := 0.5 * x + 0.5 * close\nplot(x - x[7])\n',
}

describe('⭐⭐ the second run stops early, and the chart draws EXACTLY what the full check draws', () => {
  for (const [name, body] of Object.entries(STOPS)) {
    it(`${name}: stopped early; every bar and the warm-up identical`, () => {
      const r = both(doc(body))
      expect(r.early.w && r.early.w.secondRunStoppedAt).toBeGreaterThan(0)
      expect(r.early.w.secondRunStoppedAt).toBeLessThan(WINDOW.length / 2)
      expectSameDrawing(r)
    })
  }

  it('a forming last bar: identical too', () => {
    expectSameDrawing(both(doc(STOPS['a var recurrence']), WINDOW, { tf: 'D', newestBarIsForming: true }))
  })

  it('deterministic: the same window run twice draws bit-identical values and stops at the same bar', () => {
    const a = both(doc(STOPS['a user-defined type'])).early
    const b = both(doc(STOPS['a user-defined type'])).early
    expect(b.w).toEqual(a.w)
    for (let i = 0; i < a.v.length; i += 1) expect(Object.is(a.v[i], b.v[i])).toBe(true)
  })
})

describe('⛔ two runs with EQUAL state that still diverge later: the stop waits, or never comes', () => {
  it('a column that depends on the first bar (`bar_index` gate): no stop before the column agrees', () => {
    const r = both(doc('plot(bar_index > 1500 ? close : 0)\n'))
    expectSameDrawing(r)
    // the column `bar_index > 1500` agrees from A's bar 1,751: no stop before it
    expect(r.early.w.withheldBars).toBe(1751)
    expect(r.early.w.secondRunStoppedAt).toBeGreaterThanOrEqual(1751)
  })

  it('a constant read 300 bars back: no stop before it lands on the second run\'s bars', () => {
    const r = both(doc('plot(close[300])\n'))
    expectSameDrawing(r)
    expect(r.early.w.withheldBars).toBe(550)
    expect(r.early.w.secondRunStoppedAt).toBeGreaterThanOrEqual(549)
  })

  it('a DYNAMIC read of a series far back (`close[off]`): measured, so never stopped early wrongly', () => {
    const r = both(doc('off = math.round(close * 10)\nplot(close[off])\n'))
    expectSameDrawing(r)
  })

  it('a DYNAMIC read of a column, its offset held in a var: measured where it reaches; no stop before it lands on agreeing bars', () => {
    const r = both(doc('var int k = 1\nk := close > 0 ? 1200 : 1\nrsi = ta.rsi(close, 14)\nplot(rsi[k])\n'))
    expectSameDrawing(r)
    expect(r.early.w.withheldBars).toBeGreaterThan(1450)
    expect(r.early.w.secondRunStoppedAt).toBeGreaterThanOrEqual(r.early.w.withheldBars - 1)
  })

  it('a window still filling in the second run (`ta.highest` over a var that starts na): no stop until every ring is full', () => {
    // x is na before 2023-10-06 in BOTH runs, so the encoded rings agree early — but
    // the second run's window is not full yet, and it answers na where the first
    // answers the highest of the finite bars it holds (`restart`)
    const r = both(doc('var float y = 0\ny := close\nx = year * 10000 + month * 100 + dayofmonth >= 20231006 ? y : na\nplot(ta.highest(x, 60))\n'))
    expectSameDrawing(r)
    expect(r.early.w.secondRunStoppedAt).toBeGreaterThanOrEqual(250 + 59)
  })

  it('a DYNAMIC read of a column far back (`ta.rsi(...)[off]`): the same', () => {
    const r = both(doc('rsi = ta.rsi(close, 14)\noff = math.round(close * 10)\nplot(rsi[off])\n'))
    expectSameDrawing(r)
  })

  it('a hidden counter: plots agree for 3,500 bars, the state never does — still refused by name', () => {
    const r = both(doc('var int c = 0\nc := c + 1\nplot(c > 3500 ? c : 0)\n'))
    expect(r.full.guard).toBe('runtime:warmup-never-converges')
    expectSameDrawing(r)
  })

  it('a script that never converges (`ta.cum`) is refused exactly as before', () => {
    expectSameDrawing(both(doc('plot(ta.cum(close))\n')))
  })

  it('⛔ a document that draws: never probed (its object store is not encoded)', () => {
    const d = doc(STOPS['a var recurrence'] + 'if bar_index % 50 == 0\n    label.new(bar_index, high, "x")\n',
      { objects: true })
    const r = computeRuntimeColumns(d, WINDOW, D)
    expect(runtimeWarmupOf(r).secondRunStoppedAt).toBeUndefined()
  })
})

describe('the pieces', () => {
  it('encodeState: equal by structure, aliasing counts, unknown objects refuse', () => {
    const x = [1, 2]
    expect(sameState(encodeState([[x, x]]), encodeState([[[1, 2], [1, 2]]]))).toBe(false)
    expect(sameState(encodeState([[[1, 2], NaN]]), encodeState([[[1, 2], NaN]]))).toBe(true)
    expect(sameState(encodeState([[0]]), encodeState([[-0]]))).toBe(false)
    expect(sameState(encodeState([[1 + 1e-15]]), encodeState([[1]]))).toBe(false)
    const r = (v) => udtRecord('P', ['v'], [v])
    expect(sameState(encodeState([[r(1)]]), encodeState([[r(1)]]))).toBe(true)
    expect(sameState(encodeState([[r(1)]]), encodeState([[r(2)]]))).toBe(false)
    expect(encodeState([[new Map()]])).toBeNull()
    expect(encodeState([[Symbol.for('x')]])).not.toBeNull()
    expect(encodeState([new Array(10).fill(0)], 5)).toBeNull()
  })

  it('checkpoints: dense first, then geometric, all inside the window', () => {
    const c = warmupCheckpoints(4000, 250)
    expect(c[0]).toBe(281)
    expect(c.every((x, i) => i === 0 || x > c[i - 1])).toBe(true)
    expect(c[c.length - 1]).toBeLessThan(3999)
    expect(c.length).toBeLessThan(15)
  })

  it('columnAgreesFrom: exact, from the tail', () => {
    expect(columnAgreesFrom([9, 9, 1, 2, 3], [5, 2, 3], 2)).toBe(3)
    expect(columnAgreesFrom([9, 9, 1, 2, 3], [5, 2, 4], 2)).toBe(Infinity)
    expect(columnAgreesFrom([0, 1, 2], [1, 2 + 1e-12], 1)).toBe(Infinity)
  })

  // a probe driven by hand: A's state at every checkpoint is [1], and so is B's
  const drive = (progA, progB, low = { dynLowSeries: Infinity, dynLowCol: Infinity }) => {
    const p = makeWarmupProbe(1000, 250)
    p.programA(progA)
    for (const c of p.forA.bars) p.forA.visit(c, { cells: [1], committed: c + 1, ...low })
    p.forA.done(low)
    p.programB(progB)
    for (const b of p.forB.bars) if (p.forB.visit(b, { cells: [1], committed: b + 1, ...low })) break
    return p.stoppedAt()
  }
  const prog = (code) => ({ code, consts: [], columns: [], history: [], windows: [] })

  it('the hand-driven probe stops at the first checkpoint when nothing else holds it back', () => {
    expect(drive(prog([41, 0, 0]), prog([41, 0, 0]))).toBe(281)
  })

  it('⛔ programs that differ: never stops', () => {
    expect(drive(prog([41, 0, 0]), prog([41, 0, 1]))).toBeNull()
  })

  it('⛔ a constant series read 100 bars back: no stop before it lands on the second run’s bars', () => {
    const code = [4 /* READ_SERIES_HIST */, 3, 100, 41, 0, 0]
    expect(drive(prog(code), prog(code))).toBeGreaterThanOrEqual(250 + 100 - 1)
  })

  it('⛔ a dynamic series read that reached bar 10 after every checkpoint: never stops', () => {
    const code = [57 /* READ_SERIES_HIST_DYN */, 3, 0, 41, 0, 0]
    expect(drive(prog(code), prog(code), { dynLowSeries: 10, dynLowCol: Infinity })).toBeNull()
    expect(drive(prog(code), prog(code), { dynLowSeries: 400, dynLowCol: Infinity })).toBe(281)
  })

})
