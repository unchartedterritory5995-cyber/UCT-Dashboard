// ─── ⭐⭐ PERF (Fred RS 5m profile, 2026-11-19) — A BARE-FIELD REQUEST IS A PICK, NOT A SUB-RUN ───
//
// `vm.js::runRequest` answers a request whose region only reads bar fields and emits them (`bareFieldsOf`) by a pick
// through the alignment index, with no VM sub-run. These rails hold it to the sub-run, BIT FOR BIT, on every
// bare-field shape the run serves (the seam `__bareFieldPickOffForTests` forces the old path): same timeframe, a
// weekly / monthly merge, look-ahead on and off, the own symbol and another, a gap after the series began, a tuple
// of fields, and each of o / h / l / c / v. A region that is NOT a bare field (an expression, a history read, a
// hoisted window) is never picked. And the measured reason it exists: the sub-run walked the source's whole history.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from '../runtimeColumns.js'
import { __bareFieldPickOffForTests, bareFieldsOf } from '../vm.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'

beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })
afterEach(() => { __bareFieldPickOffForTests(false) })

function weekdays(n, from = '2026-01-05') {
  const out = []
  const d = new Date(`${from}T00:00:00Z`)
  while (out.length < n) {
    const w = d.getUTCDay()
    if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
const barsOn = (days, base) => days.map((t, i) => {
  const c = base + i + (i % 3) * 0.5
  return { t, o: c - 0.25, h: c + 1, l: c - 1, c, v: 1000 + i }
})
const DAYS = weekdays(60)
const CHART = barsOn(DAYS, 100)
const SPY = barsOn(DAYS, 500)
const STORE = { SPY: 'NYSE Arca' }
const ctxOf = (over = {}) => ({
  tf: 'D', newestBarIsForming: false, historyFromListing: true,
  symbol: { ticker: 'RDDT', exchange: 'NYSE' },
  secondary: new Map([['SPY', { bars: SPY, status: 'available' }]]),
  exchangeOf: (t) => STORE[t] || null,
  ...over,
})
const doc = (body, outputs) => ({
  id: 'bfp', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:bfp', outputs, source: `//@version=5\nindicator("bfp")\n${body}` },
})

/** The same document run with the pick (the new path) and with every request through the VM sub-run (the old). */
function bothWays(body, outputs = { a: 0 }, ctx = ctxOf()) {
  __bareFieldPickOffForTests(false)
  resetRuntimeSessions(); resetRuntimeLedgers()
  const picked = computeRuntimeColumns(doc(body, outputs), CHART, ctx)
  __bareFieldPickOffForTests(true)
  resetRuntimeSessions(); resetRuntimeLedgers()
  const subRun = computeRuntimeColumns(doc(body, outputs), CHART, ctx)
  __bareFieldPickOffForTests(false)
  return { picked, subRun }
}
/** Bit for bit: every element `Object.is`-equal (NaN equals NaN, -0 is not 0). */
function expectIdentical(a, b, label) {
  expect(a.length, label).toBe(b.length)
  const bad = []
  for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) bad.push(`${i}: ${a[i]} vs ${b[i]}`)
  expect(bad.slice(0, 5), label).toEqual([])
}

const SHAPES = [
  ['same timeframe, another symbol', 'plot(request.security("AMEX:SPY", timeframe.period, close))'],
  ['a "D" literal on a daily chart', 'plot(request.security("AMEX:SPY", "D", close))'],
  ['weekly merge, own symbol', 'plot(request.security(syminfo.tickerid, "W", close))'],
  ['monthly merge, own symbol', 'plot(request.security(syminfo.tickerid, "M", high))'],
  ['weekly merge, look-ahead off written out', 'plot(request.security(syminfo.tickerid, "W", low, lookahead = barmerge.lookahead_off))'],
  ['weekly read, look-ahead ON', 'plot(request.security(syminfo.tickerid, "W", close, lookahead = barmerge.lookahead_on))'],
  ['weekly merge, another symbol', 'plot(request.security("AMEX:SPY", "W", open))'],
  ['volume', 'plot(request.security("AMEX:SPY", timeframe.period, volume))'],
]

describe('the pick equals the VM sub-run, bit for bit, on every bare-field shape', () => {
  for (const [name, body] of SHAPES) {
    it(name, () => {
      const { picked, subRun } = bothWays(body)
      expectIdentical(picked.a, subRun.a, name)
      // and it is a real read, not two blanks agreeing
      expect(Array.from(picked.a).some((v) => Number.isFinite(v)), `${name}: draws`).toBe(true)
    })
  }

  it('a tuple of fields: each element is its own field, in order', () => {
    const body = '[o, h, l, c, v] = request.security("AMEX:SPY", timeframe.period, [open, high, low, close, volume])\n'
      + 'plot(o)\nplot(h)\nplot(l)\nplot(c)\nplot(v)'
    const outputs = { o: 0, h: 1, l: 2, c: 3, v: 4 }
    const { picked, subRun } = bothWays(body, outputs)
    for (const k of Object.keys(outputs)) expectIdentical(picked[k], subRun[k], `tuple ${k}`)
    expect(Array.from(picked.h)).toEqual(SPY.map((b) => b.h))
  })

  it('a gap after the other series began: the same refusal on both paths (the supply decides, not the region)', () => {
    const gapped = SPY.filter((_, i) => i !== 10)
    const ctx = ctxOf({ secondary: new Map([['SPY', { bars: gapped, status: 'available' }]]) })
    const msg = (off) => {
      __bareFieldPickOffForTests(off); resetRuntimeSessions()
      try { computeRuntimeColumns(doc('plot(request.security("AMEX:SPY", timeframe.period, close))', { a: 0 }), CHART, ctx); return 'served' } catch (e) { return String(e && e.message) }
    }
    const a = msg(false)
    expect(a).toMatch(/no bar on 2026-01-19/)
    expect(msg(true)).toBe(a)
  })

  it('a non-finite field is `na` on both paths (EMIT\'s laundering, mirrored)', () => {
    const odd = SPY.map((b, i) => (i === 5 ? { ...b, c: Infinity } : i === 6 ? { ...b, c: undefined } : b))
    const ctx = ctxOf({ secondary: new Map([['SPY', { bars: odd, status: 'available' }]]) })
    const { picked, subRun } = bothWays('plot(request.security("AMEX:SPY", timeframe.period, close))', { a: 0 }, ctx)
    expectIdentical(picked.a, subRun.a, 'non-finite')
    expect(picked.a[5]).toBeNaN()
    expect(picked.a[6]).toBeNaN()
  })
})

describe('only a bare field is picked', () => {
  const programOf = (body) => {
    const built = buildRuntimeIr(`//@version=5\nindicator("bfp")\n${body}`,
      { bars: CHART, inputs: {}, tf: 'D', basePeriod: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' } })
    expect(built.ok, built.ok ? '' : built.refusal.message).toBe(true)
    return lowerIrProgram(built.ir)
  }
  it('READ_SERIES · EMIT · HALT is picked; an expression, a history read and a hoisted window are not', () => {
    const fieldsOf = (body) => {
      const p = programOf(body)
      return p.requests.map((r) => bareFieldsOf(p, r.entry, r.results))
    }
    expect(fieldsOf('plot(request.security("AMEX:SPY", timeframe.period, close))')).toEqual([[3]])
    expect(fieldsOf('plot(request.security("AMEX:SPY", timeframe.period, close[1]))')).toEqual([null])
    expect(fieldsOf('plot(request.security("AMEX:SPY", timeframe.period, close + 1))')).toEqual([null])
    expect(fieldsOf('plot(request.security("AMEX:SPY", timeframe.period, ta.sma(close, 3)))')).toEqual([null])
    expect(fieldsOf('[a, b] = request.security("AMEX:SPY", timeframe.period, [high, low])\nplot(a)\nplot(b)')).toEqual([[1, 2]])
  })

  it('an expression request still runs the VM, and still equals the old path', () => {
    const { picked, subRun } = bothWays('plot(request.security("AMEX:SPY", timeframe.period, close[1] + high - low))')
    expectIdentical(picked.a, subRun.a, 'expression')
  })
})
