// app/src/components/chart/engine/__tests__/calcBarsWindow.cbcfmt.test.js
//
// ─── ⭐⭐ CBC-FMT — `calc_bars_count`: ONE READER, ONE WINDOW, BOTH LANES ─────────────
//
// D1: the HOST lane ignored `indicator(calc_bars_count = N)` and drew every bar (the probe
// `vw-cs1-calc-bars` read DIVERGE on 5 of 6 plots in production). D2: the runtime lane read
// the count with a regex over the whole source, so a `request.security(calc_bars_count = …)`
// argument windowed a script that declares no window. D3: the runtime lane's `bar_index`
// probe refused correct pictures like `plot(bar_index)`, which TradingView prints 0..99.
// These rails hold the fix to the witnessed rule (`engine/calcBarsWindow.js`):
//   W2 the host window on the capture's shape (666 bars, N = 100)
//   W3 a chart of N bars or fewer, and a document without the stamp, are untouched
//   W4 the one reader (request argument, comment, 0, a name, strategy)
//   W5 the runtime lane draws `plot(bar_index)` windowed
//   W6 a `runtime.error` reached only before the window does not stop the picture
//   + what a window does not witness, withheld or refused by name.
import { describe, it, expect, vi, afterEach } from 'vitest'

import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import * as registry from '../nativeRegistry'
import { lexPine, translatePine, declarationCalcBars } from '../ast/pine'
import { buildRuntimeIr } from '../ast/pineRuntimeFrontend'
import { computeRuntimeColumns } from '../runtime/runtimeColumns'
import { objectReaderFor } from '../objectColumns'
import {
  calcBarsWindowOf, calcBarsWindowReport, CALC_BARS_REQUEST_GUARD, CALC_BARS_REQUEST_SOURCE,
  CALC_BARS_FORMING_GUARD, CALC_BARS_WINDOW_CODE,
} from '../calcBarsWindow'

const ID = 'u_cbc-e59'
const N = 666
const BARS = Array.from({ length: N }, (_, i) => {
  const c = 50 + 20 * Math.sin(i / 17) + i * 0.05
  return { t: 1700000000 + i * 86400, o: c - 0.4, h: c + 1, l: c - 1, c, v: 1000 + (i % 13) }
})
const CLOSED = { tf: 'D', newestBarIsForming: false, historyFromListing: true }
const CB = (n = 100, extra = '') => `//@version=6\nindicator("cbc", overlay = false, calc_bars_count = ${n}${extra})\n`
// the capture's own script (tools/visual_conformance/probes/vw-cs1-calc-bars.pine)
const CS1 = `${CB()}var int n = 0\nn += 1\nplot(bar_index, "A00_bar_index")\nplot(time, "A01_time_CONTROL")\n`
  + 'plot(n, "A02_var_count")\nplot(ta.sma(close, 10), "A03_sma10")\nplot(close, "A04_close")\n'

const flags = (runtime = false) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', runtime ? '1' : '')
}
afterEach(() => { registry.uninstallUserDefinition(ID); vi.unstubAllEnvs() })

function door(source) {
  const d = memberPaneDefinition({ source, id: ID, name: 'cbc' })
  expect(d.ok, d.reason).toBe(true)
  return d
}
function host(source, bars = BARS, ctx = CLOSED) {
  const d = door(source)
  const { installed, errors } = registry.installUserDefinitions([d.definition])
  expect(errors).toEqual([])
  return { d, def: installed[0], cols: registry.computeFor(installed[0], bars, undefined, ctx) }
}
const keyOf = (d, label) => d.definition.plots.find((p) => p.label === label).key
const isNa = (v) => typeof v !== 'number' || Number.isNaN(v)

describe('W4 — the one reader (`pine.js::declarationCalcBars`)', () => {
  const read = (src) => declarationCalcBars(lexPine(src).tokens.filter((t) => t.line === 2))
  it('a positive literal is the window; absent, `na` and `0` are none (S10 vw-cbc-zero: every bar)', () => {
    expect(read(CB(100)).count).toBe(100)
    expect(read(CB(100, ', max_boxes_count = 500')).count).toBe(100)
    expect(read('//@version=6\nindicator("x")\n')).toBeNull()
    expect(read('//@version=6\nindicator("x", calc_bars_count = na)\n')).toBeNull()
    expect(read(CB(0))).toBeNull()
  })
  it('⛔ anything that is not a literal count refuses by name (S10 vw-cbc-input-count: CE10123)', () => {
    expect(translatePine('//@version=6\nN = input.int(100)\nindicator("x", calc_bars_count = N)\nplot(close)\n', { strict: true })
      .refusal.message).toMatch(/CE10123/)
    expect(read('//@version=6\nindicator("x", calc_bars_count = N)\n').guard).toBe('pine:calc-bars-count-expr')
    expect(read('//@version=6\nindicator("x", calc_bars_count = 100.0)\n').guard).toBe('pine:calc-bars-count-expr')
    expect(read('//@version=6\nindicator("x", calc_bars_count = -5)\n').guard).toBe('pine:calc-bars-count-expr')
  })
  it('⛔ D2 — a request argument, a comment and a string are NOT the declaration\'s count', () => {
    const src = '//@version=6\nindicator("x // calc_bars_count = 5")\n// calc_bars_count = 7\n'
      + 'plot(request.security(syminfo.tickerid, "D", close, calc_bars_count = 200000))\n'
    const t = translatePine(src, { strict: true })
    expect(t.calcBarsCount).toBeUndefined()
    // the regex it replaces read 5 here (the FIRST `calc_bars_count = <digits>` anywhere)
    expect(read(src)).toBeNull()
  })
  it('the host lane stamps it (indicator and strategy); a SCREEN refuses it by name', () => {
    expect(translatePine(CS1, { strict: true }).calcBarsCount).toBe(100)
    const strat = '//@version=6\nstrategy("s", calc_bars_count = 300)\nplot(close)\n'
    expect(translatePine(strat, { strict: true }).calcBarsCount).toBe(300)
    const screen = translatePine(CS1)
    expect(screen.ok).toBe(false)
    expect(screen.refusal.guard).toBe('pine:window-dependent')
    expect(screen.refusal.message).toMatch(/last 100 bars/)
  })
  it('⭐ the doors agree: the runtime front end refuses an expression by the same name, and builds `0`', () => {
    const body = 'var float a = 0.0\na += close\nplot(a)\n'
    expect(buildRuntimeIr(`${CB(0)}${body}`).ok).toBe(true)
    expect(buildRuntimeIr(`//@version=6\nN = 5\nindicator("x", calc_bars_count = N)\n${body}`).refusal.guard)
      .toBe('pine:calc-bars-count-expr')
    expect(buildRuntimeIr(`${CB(100)}${body}`).ok).toBe(true)
    const zero = translatePine(`${CB(0)}plot(close)\n`, { strict: true })
    expect(zero.ok).toBe(true)
    expect(zero.calcBarsCount).toBeUndefined()
  })
  // landing train 1: the scan carries no lookbehind (iOS 16 floor, src/noRegexLookbehind.test.js)
  it('the request scan reads a call, never a longer name or a member of something else', () => {
    const NL = String.fromCharCode(10)
    for (const yes of ['security(a)', 'x = security (a)', 'plot(request.security(t, "", close))', 'request . financial(a)', `plot(close)${NL}financial(a)`]) {
      expect(CALC_BARS_REQUEST_SOURCE.test(yes), yes).toBe(true)
    }
    for (const no of ['my_security(a)', 'lib.security(a)', 'xfinancial(a)', 'security = 1', 'a.request.security(x)', 'xrequest.security(x)']) {
      expect(CALC_BARS_REQUEST_SOURCE.test(no), no).toBe(false)
    }
    expect(CALC_BARS_REQUEST_SOURCE.global || CALC_BARS_REQUEST_SOURCE.sticky).toBe(false) // .test() keeps no lastIndex
  })
  it('the member door writes the stamp, and the request fact beside it', () => {
    flags()
    expect(door(CS1).definition.meta.calcBarsCount).toBe(100)
    expect(door(CS1).definition.meta.calcBarsRequest).toBeUndefined()
    const req = door(`${CB()}plot(request.security(syminfo.tickerid, "", close))\n`)
    expect(req.definition.meta.calcBarsRequest).toBe(true)
    expect(door('//@version=6\nindicator("x")\nplot(close)\n').definition.meta.calcBarsCount).toBeUndefined()
  })
})

describe('W2 — the host window on the capture\'s shape (666 bars, N = 100)', () => {
  it('⭐ NaN before the window; bar_index 0..99, the var counter 1..100, sma10 window-only, time real', () => {
    flags()
    const { d, cols } = host(CS1)
    expect(N).toBeGreaterThan(100) // non-vacuity: the window is taken
    const bi = cols[keyOf(d, 'A00_bar_index')]
    const tm = cols[keyOf(d, 'A01_time_CONTROL')]
    const n = cols[keyOf(d, 'A02_var_count')]
    const sma = cols[keyOf(d, 'A03_sma10')]
    const cl = cols[keyOf(d, 'A04_close')]
    expect(bi).toHaveLength(N)
    for (let i = 0; i < 566; i += 1) {
      for (const col of [bi, tm, n, sma, cl]) expect(isNa(col[i]), `bar ${i}`).toBe(true)
    }
    for (let i = 566; i < N; i += 1) {
      expect(bi[i]).toBe(i - 566)
      expect(n[i]).toBe(i - 565)
      expect(cl[i]).toBe(BARS[i].c)
      expect(tm[i]).toBe(BARS[i].t * 1000)
    }
    for (let i = 566; i <= 574; i += 1) expect(isNa(sma[i]), `sma bar ${i}`).toBe(true)
    let s = 0
    for (let i = 566; i < 576; i += 1) s += BARS[i].c
    expect(sma[575]).toBeCloseTo(s / 10, 9)
  })
  it('⭐ a chart NOT known to start at the listing: the window is still the whole history (state from its first bar)', () => {
    flags()
    const { d, cols } = host(CS1, BARS, { tf: 'D', newestBarIsForming: false })
    const n = cols[keyOf(d, 'A02_var_count')]
    const bi = cols[keyOf(d, 'A00_bar_index')]
    expect(n[566]).toBe(1)
    expect(n[N - 1]).toBe(100)
    expect(bi[566]).toBe(0)
  })
  it('the window is named on the member\'s strip ("computed on its last 100 bars")', () => {
    flags()
    const { cols } = host(CS1)
    expect(calcBarsWindowReport(cols)).toMatchObject({ count: 100, cut: 566, formingWithheld: false })
    const rows = registry.chartClockReport(cols).withheld
    expect(rows.map((r) => r.code)).toEqual([CALC_BARS_WINDOW_CODE])
    expect(rows[0].reason).toMatch(/last 100 bars/)
  })
  it('⛔ realtime ruling — the newest bar is withheld by name while it may be forming', () => {
    flags()
    for (const forming of [true, null]) {
      const { d, cols } = host(CS1, BARS, { ...CLOSED, newestBarIsForming: forming })
      const n = cols[keyOf(d, 'A02_var_count')]
      expect(n[N - 2]).toBe(99)
      expect(isNa(n[N - 1]), `forming=${forming}`).toBe(true)
      expect(registry.chartClockReport(cols).withheld.map((r) => r.code))
        .toEqual([CALC_BARS_WINDOW_CODE, CALC_BARS_FORMING_GUARD])
    }
  })
})

describe('W3 — a chart within the count, and a document without the stamp, are untouched', () => {
  it('⭐ rows <= N: byte-identical to the same document with no stamp', () => {
    flags()
    const { d, def } = host(CS1)
    const bare = { ...def, meta: { ...def.meta } }
    delete bare.meta.calcBarsCount
    for (const rows of [BARS.slice(0, 100), BARS.slice(0, 60)]) {
      const a = registry.computeFor(def, rows, undefined, { ...CLOSED, newestBarIsForming: true })
      const b = registry.computeFor(bare, rows, undefined, { ...CLOSED, newestBarIsForming: true })
      expect(Object.keys(a)).toEqual(Object.keys(b))
      for (const k of Object.keys(a)) expect(Array.from(a[k])).toEqual(Array.from(b[k]))
      expect(calcBarsWindowReport(a)).toBeNull()
      expect(Array.from(a[keyOf(d, 'A00_bar_index')]).slice(0, 3)).toEqual([0, 1, 2])
    }
    expect(calcBarsWindowOf(bare, BARS)).toBeNull()
  })
})

describe('what a window does not witness — withheld or refused BY NAME', () => {
  it('⭐ S10 vw-cbc-history-reads / vw-cbc-mbb-and-input (RDDT 1D, 666 bars, N = 100): served as TradingView prints', () => {
    flags()
    // the capture's own script (tools/visual_conformance/probes/vw-cbc-history-reads.pine)
    const { d, cols } = host(`${CB()}plot(bar_index, "A00")\nplot(close[1], "A01")\nplot(close[150], "A02")\n`
      + 'plot(nz(close[100], -1), "A03")\nplot(ta.highest(high, 150), "A04")\nplot(last_bar_index, "A05")\n'
      + 'plot(barstate.isfirst ? 1 : 0, "A06")\nplot(ta.cum(1), "A07")\nplot(time[1], "A08")\nplot(bar_index[1], "A09")\n')
    const c = (k) => cols[keyOf(d, k)]
    const W0 = N - 100
    // A01 / A08 / A09: `na` on the window's first bar (never the chart's bar 565), the window's own after
    for (const k of ['A01', 'A08', 'A09']) expect(isNa(c(k)[W0]), k).toBe(true)
    expect(c('A01')[W0 + 1]).toBe(BARS[W0].c)
    expect(c('A08')[W0 + 1]).toBe(BARS[W0].t * 1000)
    expect(c('A09')[W0 + 1]).toBe(0)
    for (let i = W0; i < N; i += 1) {
      expect(isNa(c('A02')[i]), `A02 ${i}`).toBe(true) // close[150]: na on all 100
      expect(isNa(c('A04')[i]), `A04 ${i}`).toBe(true) // highest(150): na on all 100
      expect(c('A03')[i], `A03 ${i}`).toBe(-1) // nz(close[100], -1): -1 on all 100
      expect(c('A05')[i], `A05 ${i}`).toBe(99) // last_bar_index: the window's
      expect(c('A06')[i], `A06 ${i}`).toBe(i === W0 ? 1 : 0) // isfirst: the window's first bar
      expect(c('A07')[i], `A07 ${i}`).toBe(i - W0 + 1) // ta.cum(1): 1..100
    }
    registry.uninstallUserDefinition(ID)
    // max_bars_back = 500 does not reach before the window (vw-cbc-mbb-and-input)
    const m = host('//@version=6\nindicator("m", overlay = false, calc_bars_count = 100, max_bars_back = 500)\n'
      + 'plot(close[300], "A01")\nplot(ta.sma(close, 300), "A02")\n')
    for (let i = 0; i < N; i += 1) {
      expect(isNa(m.cols[keyOf(m.d, 'A01')][i]), `mbb A01 ${i}`).toBe(true)
      expect(isNa(m.cols[keyOf(m.d, 'A02')][i]), `mbb A02 ${i}`).toBe(true)
    }
  })
  it('⛔ a request of other bars refuses every plot (the identity request too)', () => {
    flags()
    const { d, cols } = host(`${CB()}plot(request.security(syminfo.tickerid, "", close), "R")\nplot(close, "C")\n`)
    const errs = registry.columnErrors(cols)
    expect(errs[keyOf(d, 'R')].guard).toBe(CALC_BARS_REQUEST_GUARD)
    expect(errs[keyOf(d, 'C')].guard).toBe(CALC_BARS_REQUEST_GUARD)
    expect(Object.keys(cols)).toEqual([])
  })
  it('⛔ the host object program of a windowed script is withheld, and said so', () => {
    flags()
    const d = door(`${CB()}plot(close)\nif bar_index % 50 == 0\n    label.new(bar_index, close, "x")\n`)
    expect(d.definition.objects).toBeFalsy()
    expect(d.notes.some((n) => /calc_bars_count/.test(n.note))).toBe(true)
  })
})

describe('W6 — a runtime.error reached only before the window does not stop the picture', () => {
  it('⭐ an error on bar 10 of 666 is not reached in the last 100; one inside the window is', () => {
    flags()
    // chart bar 10 by its TIME (the window's `bar_index` restarts at 0: `bar_index == 10` is window bar 10)
    const before = host(`${CB()}if time == ${BARS[10].t * 1000}\n    runtime.error("early")\nplot(close, "C")\n`)
    expect(before.cols[keyOf(before.d, 'C')][N - 2]).toBe(BARS[N - 2].c)
    registry.uninstallUserDefinition(ID)
    // control: the window's own bar 10 (chart bar 576) is reached on TradingView, and stops it
    const inside = host(`${CB()}if bar_index == 10\n    runtime.error("inside")\nplot(close, "C")\n`)
    expect(inside.cols[keyOf(inside.d, 'C')]).toBeUndefined()
  })
})

describe('W6b — the object lane asks the same window of a runtime.error (a stored windowed document)', () => {
  it('⭐ an error before the window does not stop the drawings; CONTROL without the stamp it does', () => {
    flags()
    const d = door(`//@version=6\nindicator("t", overlay = true)\nif time == ${BARS[10].t * 1000}\n    runtime.error("early")\n`
      + 'plot(close, "C")\nif barstate.islast\n    label.new(bar_index, close, "x")\n')
    expect(d.definition.objects).toBeTruthy()
    expect(d.definition.meta.runtimeErrors).toBeTruthy()
    const ctx = { tf: 'D', newestBarIsForming: false, historyFromListing: true }
    expect(objectReaderFor(d.definition, BARS, ctx), 'no stamp: reached on bar 10').toBeNull()
    const stamped = { ...d.definition, meta: { ...d.definition.meta, calcBarsCount: 100 } }
    expect(objectReaderFor(stamped, BARS, ctx), 'stamped: the window starts at bar 566').not.toBeNull()
  })
})

describe('W5 — the runtime lane: `plot(bar_index)` windowed is DRAWN (D3 gone)', () => {
  const RUN = `${CB()}var float acc = 0.0\nacc += close\nplot(acc, "acc")\nplot(bar_index, "bi")\n`
  it('⭐ bar_index 0..99 over the window, NaN before it; the running total starts on its first bar', () => {
    flags(true)
    const d = door(RUN)
    expect(d.definition.compute.kind).toBe('runtime')
    expect(d.definition.meta.calcBarsCount).toBe(100)
    const { installed } = registry.installUserDefinitions([d.definition])
    const cols = computeRuntimeColumns(installed[0], BARS, CLOSED)
    const bi = cols[keyOf(d, 'bi')]
    const acc = cols[keyOf(d, 'acc')]
    expect(isNa(bi[565])).toBe(true)
    expect(bi[566]).toBe(0)
    expect(bi[N - 1]).toBe(99)
    expect(acc[566]).toBeCloseTo(BARS[566].c, 9)
    expect(calcBarsWindowReport(cols)).toMatchObject({ count: 100, cut: 566 })
  })
  it('⛔ the runtime lane refuses a request in a window by the host\'s name (the identity request too)', () => {
    flags(true)
    for (const [tail, guard] of [['plot(request.security(syminfo.tickerid, "W", close), "r")\n', CALC_BARS_REQUEST_GUARD],
      ['plot(request.security(syminfo.tickerid, "", close), "r")\n', CALC_BARS_REQUEST_GUARD]]) {
      const def = { id: 'rt-cbc', meta: { runtimeHistory: 'listing', calcBarsCount: 100 },
        compute: { kind: 'runtime', fn: 'runtime:rt-cbc', outputs: { a: 0, b: 1 }, source: `${CB()}var float a = 0.0\na += close\nplot(a)\n${tail}` } }
      let err = null
      try { computeRuntimeColumns(def, BARS, CLOSED) } catch (e) { err = e }
      expect(err && err.guard, tail).toBe(guard)
    }
  })
  it('⭐ S10 — the runtime lane agrees with the host on last_bar_index, isfirst and a cross-window read', () => {
    const def = { id: 'rt-cbc3', meta: { runtimeHistory: 'listing', calcBarsCount: 100 },
      compute: { kind: 'runtime', fn: 'runtime:rt-cbc3', outputs: { a: 0, b: 1, c: 2 },
        source: `${CB()}var float k = 0.0\nk += 1\nplot(last_bar_index)\nplot(barstate.isfirst ? 1 : 0)\nplot(nz(close[1], -1) + k * 0)\n` } }
    const cols = computeRuntimeColumns(def, BARS, CLOSED)
    expect(cols.a[N - 100]).toBe(99)
    expect(cols.a[N - 1]).toBe(99)
    expect(cols.b[N - 100]).toBe(1)
    expect(cols.b[N - 99]).toBe(0)
    expect(cols.c[N - 100]).toBe(-1)
    expect(cols.c[N - 99]).toBe(BARS[N - 100].c)
  })
  it('⛔ D2 — the runtime lane takes no window from the source: only the stamp windows a run', () => {
    const def = { id: 'rt-cbc2', meta: { runtimeHistory: 'listing' },
      compute: { kind: 'runtime', fn: 'runtime:rt-cbc2', outputs: { a: 0 }, source: `${CB()}var float a = 0.0\na += 1\nplot(a)\n` } }
    const cols = computeRuntimeColumns(def, BARS, CLOSED)
    expect(cols.a[N - 1]).toBe(N)
    expect(calcBarsWindowReport(cols)).toBeNull()
  })
})
