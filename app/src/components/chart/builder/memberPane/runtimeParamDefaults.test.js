// app/src/components/chart/builder/memberPane/runtimeParamDefaults.test.js
//
// ─── ⭐ L2 — A USER FUNCTION'S DEFAULT PARAMETER VALUES, IN THE RUNTIME LANE ────
//
// `f(src, n = 5) =>` was refused by the runtime front end ("default values are
// not supported yet"), and that header is the FIRST wall nearly every imported
// library export meets: TradingView/ta's `ao(series float source = hl2, simple int
// shortLength = 5, …)`, ZenLibrary's `getPipSize(…)`, reees/TA, ta/9 — measured
// with the 50 production libraries loaded (`libraryImportersCensus.measure`).
//
// ⭐ THE RULE (Pine): a call that omits a trailing argument runs the body with the
// declared default. TradingView's own capture says so for a series default —
// `vw-library-import-rddt-1d-2026-10-02` (Q-L1): `highestSince(cond)` equals
// `highestSince(cond, high)` on every bar (`vendorHarness.capRound4`). So the
// omitted argument is compiled as the default WRITTEN AT THE CALL, and this rail
// proves exactly that, bar for bar, through the member door: the script with the
// argument omitted draws the same columns as the script with it written.
//
// ⛔ Only defaults whose value cannot depend on where they are read are taken
// (`paramDefaultsOf`): literals, dotted built-in constants, and Pine's built-in
// bar series — and a bar-series default is refused BY NAME when the caller binds
// that name to something else. Anything else keeps the header's refusal.

import { describe, it, expect, vi, afterEach } from 'vitest'

import * as registry from '../../engine/nativeRegistry'
import { memberPaneDefinition } from './memberPaneDefinition'
import { computeRuntimeColumns } from '../../engine/runtime/runtimeColumns'
import { buildRuntimeIr, paramDefaultsOf } from '../../engine/ast/pineRuntimeFrontend'
import { runtimeClockOpts } from '../../engine/ast/pineRuntimeClock'
import { registerPineLibrary, clearPineLibraries } from '../../engine/ast/pineLibraryStore'
import { lexPine } from '../../engine/ast/pine'

const FLAG = 'VITE_PINE_RUNTIME_PANE_ENABLED'
const DEF_ID = 'u_member-pane-l2-defaults'
const HEAD = '//@version=5\nindicator("t")\n'

const N = 60
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + Math.sin(i / 3) * 4,
  h: 106 + Math.sin(i / 3) * 4 + (i % 4),
  l: 94 + Math.sin(i / 3) * 4 - (i % 3),
  c: 100 + Math.sin(i / 3) * 4 + ((i * 7) % 5) - 2,
  v: 1000 + (i % 9) * 120,
}))

afterEach(() => {
  registry.uninstallUserDefinition(DEF_ID)
  clearPineLibraries()
  vi.unstubAllEnvs()
})

function draw(source) {
  vi.stubEnv(FLAG, '1')
  const built = memberPaneDefinition({ source, id: DEF_ID })
  expect(built.ok, built.reason || JSON.stringify(built.runtimeDeclined)).toBe(true)
  expect(built.lane).toBe('runtime')
  const cols = computeRuntimeColumns(built.definition, BARS,
    { tf: 'D', newestBarIsForming: false, historyFromListing: true })
  return built.rows.map((r) => Array.from(cols[r.key]))
}

const finite = (col) => col.filter((v) => Number.isFinite(v)).length
const headerOf = (src) => {
  const toks = lexPine(src).tokens
  const line = toks.filter((t) => t.line === 3)
  return [line, line.findIndex((t) => t.kind === 'punct' && t.value === '=>')]
}

describe('⭐ L2 — an omitted trailing argument IS its declared default (runtime lane)', () => {
  it('⭐ a literal window default and a bar-series default: omitted == written, bar for bar', () => {
    const body = (call) => `${HEAD}osc(series float source = hl2, simple int fast = 5, simple int slow = 34) =>
    float result = ta.sma(source, fast) - ta.sma(source, slow)
plot(${call}, "A")
`
    const omitted = draw(body('osc()'))
    const written = draw(body('osc(hl2, 5, 34)'))
    expect(omitted).toEqual(written)
    expect(finite(omitted[0])).toBe(N - 33) // non-vacuity: the 34-bar window warmed
    // ⛔ CONTROL: a DIFFERENT argument draws something else, so the equality above
    // is not two refusals or two empty columns agreeing.
    expect(draw(body('osc(close, 5, 34)'))).not.toEqual(written)
  })

  it('⭐ only the trailing arguments omitted: a partial call takes the rest from the header', () => {
    const body = (call) => `${HEAD}band(series float src, simple int len = 10, float k = 2.0) =>
    ta.sma(src, len) + k * ta.stdev(src, len)
plot(${call}, "B")
`
    expect(draw(body('band(close)'))).toEqual(draw(body('band(close, 10, 2.0)')))
    expect(draw(body('band(close, 4)'))).toEqual(draw(body('band(close, 4, 2.0)')))
    expect(draw(body('band(close, 4)'))).not.toEqual(draw(body('band(close)')))
  })

  it("⭐ Q-L1's shape: an imported export with `var` state and a series default, at two call sites", () => {
    // A fixture library written for this rail (no third-party code): the
    // `highestSince` contract TradingView's capture pins — reset on `cond`,
    // running max otherwise, `source` defaulting to `high`.
    const LIB = `// This Pine Script code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/
//@version=5
library("l2lib")
export since(series bool cond, series float source = high) =>
    var float result = na
    if cond
        result := source
    result := math.max(nz(source, result), nz(result, source))
`
    registerPineLibrary({ path: 'tester/l2lib/1', source: LIB, licence: 'MPL-2.0', attribution: 'l2lib (test fixture)' })
    const imported = `${HEAD}import tester/l2lib/1 as lib
plot(lib.since(bar_index % 7 == 0), "S1")
plot(lib.since(bar_index % 11 == 0), "S2")
plot(lib.since(bar_index % 7 == 0, high), "S3")
`
    const cols = draw(imported)
    expect(cols[0]).toEqual(cols[2]) // omitted source == `high` written
    expect(cols[0]).not.toEqual(cols[1]) // two call sites keep two states
    expect(finite(cols[0])).toBe(N)
  })

  it('⛔ a default this lane cannot pin to the call is still refused by name (`n = len * 2`)', () => {
    const src = `${HEAD}len = 5
f(series float s, simple int n = len * 2) => ta.sma(s, n)
plot(f(close))
`
    const r = buildRuntimeIr(src, { tf: 'D', ...runtimeClockOpts(false) })
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:function')
    expect(r.refusal.message).toMatch(/default values are not supported yet/)
  })

  it('⛔ a bar-series default is refused when the CALLER binds that name to something else', () => {
    const src = `${HEAD}f(series float s = high) => s * 2
g() =>
    high = close + 1
    f()
plot(g())
`
    const r = buildRuntimeIr(src, { tf: 'D', ...runtimeClockOpts(false) })
    expect(r.ok).toBe(false)
    expect(r.refusal.message).toMatch(/default is `high`/)
  })

  it('⛔ a default that names anything but a built-in is not this shape', () => {
    expect(paramDefaultsOf(...headerOf(`${HEAD}f(b, a = 1) => a + b\n`)).names).toEqual(['b', 'a'])
    expect(paramDefaultsOf(...headerOf(`${HEAD}f(b, a = other) => a + b\n`))).toBe(null)
  })

  it("⭐ a REQUIRED parameter behind an optional one (MLExtensions' header): every argument written draws", () => {
    // `filter_volatility(simple int minLength=1, simple int maxLength=10, bool
    // useVolatilityFilter)` is published and compiles on TradingView. A call
    // that writes all three never reads a default.
    expect(paramDefaultsOf(...headerOf(`${HEAD}f(a = 1, b) => a + b\n`)).names).toEqual(['a', 'b'])
    const src = `${HEAD}fv(simple int minLength=1, simple int maxLength=10, bool useFilter) =>
    useFilter ? ta.atr(minLength) - ta.atr(maxLength) : 0.0
plot(fv(2, 6, true), "V")
`
    // (the comparison header declares a default on every parameter, so both
    // sides are the runtime lane's — a header with none is the host lane's)
    const pasted = `${HEAD}fv(simple int minLength=1, simple int maxLength=10, bool useFilter=false) =>
    useFilter ? ta.atr(minLength) - ta.atr(maxLength) : 0.0
plot(fv(2, 6, true), "V")
`
    const a = draw(src)
    expect(a).toEqual(draw(pasted))
    expect(finite(a[0])).toBeGreaterThan(N - 10)
  })

  it('⛔ …and leaving the REQUIRED one out is still the arity refusal it always was', () => {
    const src = `${HEAD}fv(simple int a = 1, bool on) => on ? a : 0
plot(fv(2))
`
    const r = buildRuntimeIr(src, { tf: 'D', ...runtimeClockOpts(false) })
    expect(r.ok).toBe(false)
    expect(r.refusal.message).toMatch(/takes 2 arguments, given 1/)
  })
})
