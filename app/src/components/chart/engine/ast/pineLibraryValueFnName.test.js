// app/src/components/chart/engine/ast/pineLibraryValueFnName.test.js
//
// ─── ⭐⭐ F4 (step 85) — A LIBRARY VALUE AND A LIBRARY FUNCTION OF ONE NAME ──────
//
// Pine keeps a top-level value and a function of the same name apart: `x()` calls
// the function, a bare `x` reads the value. `theEccentricTrader/PubLibTrend/3`
// writes exactly that (`rlut = rlut()`, `dt = dt()`, `ut = ut()`, `rldt = rldt()`),
// and the linker spelled both `__lib<n>_rlut`, so the linked program held ONE name
// for two things and every call of the function read as a call of the value
// (`pine:function` `__lib3_rlut`). On all-chart-patterns-theeccentrictrader (SPY 1D,
// CAP3) that refused the guard of every pattern built on those trends and the
// door held 64 of TradingView's 156 objects; with the two spelled apart it holds
// all 156, id for id (`vendorHarness.f4SpyDrawings.test.js`).
//
// ⛔ EVERY LIBRARY HERE IS A FIXTURE WRITTEN FOR THIS FILE (no third-party source).
import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'
import { interpret } from './interpret.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { runtimeClockOpts } from './pineRuntimeClock.js'
import { lowerIrProgram } from '../runtime/lowerIr.js'
import { execute } from '../runtime/vm.js'

const N = 60
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + Math.sin(i),
  h: 102 + Math.sin(i) + (i % 3),
  l: 98 - (i % 4),
  c: 100 + Math.cos(i) * 2 + i * 0.1,
  v: 1000 + i * 7,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const MPL = '// This Pine Script code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/'

// the PubLibTrend shape: a function, then a top-level value of the same name
// holding its call, then an export reading the VALUE bare
const LIB = `${MPL}
//@version=6
library("samename")
export rising() =>
    close > close[1]
rising = rising()
export both() =>
    rising and close > open
`
// the PubLibPattern shape on top: a second library that imports the first and
// binds the function's call to a value of its own (`rlut = tr.rlut()`)
const OUTER = `${MPL}
//@version=6
library("outerpat")
import tester/samename/1 as tr
rising = tr.rising()
export pattern() =>
    rising and close > open
`
const LIBS = {
  'tester/samename/1': { path: 'tester/samename/1', source: LIB, licence: 'MPL-2.0', attribution: 'samename (test fixture)' },
  'tester/outerpat/1': { path: 'tester/outerpat/1', source: OUTER, licence: 'MPL-2.0', attribution: 'outerpat (test fixture)' },
}
const HEAD = '//@version=6\nindicator("t", overlay=true)\n'
const LINKED = `${HEAD}import tester/samename/1 as sn
plot(sn.both() ? 1 : 0)
plot(sn.rising() ? 1 : 0)
`
const PASTED = `${HEAD}plot(close > close[1] and close > open ? 1 : 0)
plot(close > close[1] ? 1 : 0)
`

const same = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
function hostCols(src) {
  const t = translatePine(src, { libraries: LIBS, mode: 'host' })
  return { t, cols: (t.outputs || []).filter((o) => o && o.ast && o.kind !== 'alertcondition').map((o) => Array.from(interpret(o.ast, BARS, {}))) }
}
function runtimeCols(src) {
  const b = buildRuntimeIr(src, { ...runtimeClockOpts(false), bars: BARS, inputs: {}, libraries: LIBS })
  if (!b.ok) return { b, cols: null }
  const p = lowerIrProgram(b.ir)
  const { outputs } = execute(p, { bars: N, series: SERIES, columns: p.columns, confirmed: true })
  return { b, cols: outputs.map((o) => Array.from(o)) }
}

describe('⭐⭐ F4 — a library value named like one of its functions', () => {
  it('host lane: the linked script equals the same logic pasted in, bar for bar', () => {
    const linked = hostCols(LINKED)
    const pasted = hostCols(PASTED)
    expect(linked.t.refusal, linked.t.refusal && linked.t.refusal.message).toBeFalsy()
    expect(pasted.cols.length).toBe(2)
    expect(linked.cols.length).toBe(2)
    // non-vacuity: both outputs move (a constant column would agree by accident)
    for (const c of pasted.cols) expect(new Set(c.filter((x) => Number.isFinite(x))).size).toBe(2)
    linked.cols.forEach((c, i) => expect(same(c, pasted.cols[i]), `output ${i}`).toBe(true))
  })

  it('runtime lane: the same', () => {
    const linked = runtimeCols(LINKED)
    const pasted = runtimeCols(PASTED)
    expect(linked.b.ok, linked.b.refusal && linked.b.refusal.message).toBe(true)
    expect(pasted.b.ok).toBe(true)
    linked.cols.forEach((c, i) => expect(same(c, pasted.cols[i]), `output ${i}`).toBe(true))
  })

  it('object lane: a drawing guarded by the export converts whole (it was refused `pine:function`)', () => {
    // all-chart-patterns' own shape: the pattern bound to a value, the guard reads it
    const src = `${HEAD}import tester/outerpat/1 as pa
pat = pa.pattern()
var line l = line.new(na, na, na, na)
if pat and barstate.isconfirmed
    line.set_xy1(l, bar_index, high)
    line.set_xy2(l, bar_index, low)
plot(close)
`
    const t = translatePine(src, { libraries: LIBS, mode: 'host' })
    const d = t.objectDiagnostics || {}
    expect(d.attemptedOps).toBeGreaterThan(0)
    expect(d.dropReasons).toEqual({})
    expect(JSON.stringify(d.guardRefusalWhy || [])).not.toMatch(/__lib\d+_rising/)
    // and the nested library's plot reading agrees with the pasted logic
    const linked = hostCols(`${HEAD}import tester/outerpat/1 as pa
plot(pa.pattern() ? 1 : 0)
`)
    const pasted = hostCols(`${HEAD}plot(close > close[1] and close > open ? 1 : 0)
`)
    expect(linked.cols.length).toBe(1)
    expect(same(linked.cols[0], pasted.cols[0])).toBe(true)
  })

  it('the spelling changes ONLY where the unit defines both: a value with no function of its name keeps its old spelling', () => {
    const lib2 = `${MPL}
//@version=6
library("plain")
level = 2.0
export f() => close * level
`
    const libs = { 'tester/plain/1': { path: 'tester/plain/1', source: lib2, licence: 'MPL-2.0', attribution: 'plain (test fixture)' } }
    const t = translatePine(`${HEAD}import tester/plain/1 as pl\nplot(pl.f())\n`, { libraries: libs, mode: 'host' })
    expect(t.refusal).toBeFalsy()
    const toks = JSON.stringify(t.outputs.map((o) => o.ast))
    expect(toks).not.toMatch(/__value/)
    const col = Array.from(interpret(t.outputs[0].ast, BARS, {}))
    expect(col[5]).toBeCloseTo(BARS[5].c * 2, 12)
  })
})
