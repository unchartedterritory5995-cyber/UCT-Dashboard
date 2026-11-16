// app/src/components/chart/engine/ast/pineLibraryVersion.test.js
//
// ─── ⭐⭐ U15 PHASE B — A PINE v5 LIBRARY INSIDE A v6 SCRIPT ─────────────────────
//
// TradingView runs a library at its own `//@version`; this engine compiles one
// program at one version. `pineLibraryVersion.js` links a v5 library into a v6
// script only where the code the script reaches holds nothing the v6 migration
// guide changed, and refuses the import line BY NAME (`pine:library-version`)
// otherwise. This rail proves both halves:
//   · a clean v5 library in a v6 script computes exactly what the SAME library
//     computes inside a v5 script (the exact path, the linker's v5 = v5 case), and
//     what its functions compute pasted into the v6 script, in BOTH lanes;
//   · each construct the guide changed is refused by name, in both lanes, and only
//     when the script REACHES it.
//
// ⛔ EVERY LIBRARY HERE IS A FIXTURE WRITTEN FROM SCRATCH FOR THIS FILE. No
// third-party library source is in this repository (`pineLibraryStore.js`).
import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'
import { fixtureLibraries } from './__tests__/libraryFixture.js'
import { interpret } from './interpret.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { runtimeClockOpts } from './pineRuntimeClock.js'
import { lowerIrProgram } from '../runtime/lowerIr.js'
import { execute } from '../runtime/vm.js'
import { lexPine, blockStatements } from './pine.js'
import { crossVersionDifference, LIBRARY_VERSION } from './pineLibraryVersion.js'

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
const V5 = '//@version=5\nindicator("t", overlay=true)\n'
const V6 = '//@version=6\nindicator("t", overlay=true)\n'

// ── a v5 library whose reached code means the same in v5 and v6 ──────────────
const CLEAN = `${MPL}
//@version=5
library("cleanlib")
export spread(float h, float l) => h - l
export smooth(float src, int len) =>
    float base = ta.sma(src, len)
    base + (src - src[1]) / 2.0
export pick(float a, float b, bool useA) => useA ? a : b
export band(float src, int len) =>
    float total = 0.0
    for i = 0 to len - 1
        total := total + src[i]
    total / len
export rising(float a, float b) => a > b and b > 0
unused() => timeframe.period == "D" ? color.red : color.teal
`
// one library per construct the guide changed, each reached by `f`
const changed = (body) => `${MPL}
//@version=5
library("changed")
export f(float x) =>
${body}
`
const CASES = [
  ['and/or with a call on its right', '    x > 0 and ta.rising(x, 2) ? x : 0.0', /`and` with a call on its right \(`ta\.rising`\)/],
  ['timeframe.period', '    timeframe.period == "D" ? x : 0.0', /`timeframe\.period`/],
  ['a changed colour constant', '    c = color.red\n    x', /`color\.red`.*#FF5252 in v5, #F23645 in v6/],
  ['label.new without textcolor', '    label.new(bar_index, x, "a")\n    x', /`label\.new` without `textcolor`/],
  ['a for bound that calls something', '    float t = 0.0\n    for i = 0 to math.round(x) % 3\n        t := t + 1\n    t', /`for` loop whose end bound calls `math\.round`/],
  ['a for bound the loop reassigns', '    int n = 3\n    float t = 0.0\n    for i = 0 to n\n        n := n - 1\n        t := t + 1\n    t', /`for` loop whose end bound reads `n`/],
  ['a const int division', '    int k = 5\n    x + k / 2', /division of two values that may be `const int`/],
  ['a request', '    request.security(syminfo.tickerid, "D", x)', /`request\.security`/],
  ['na() of a value not shown to be a number', '    b = x > 0\n    na(b) ? 1.0 : x', /`na\(\)` of a value not shown to be a number/],
  ['history of a bool', '    b = x > 0\n    b[1] ? 1.0 : x', /history of the bool `b`/],
  ['a condition not shown to be a bool', '    y = x * 2\n    y ? 1.0 : 0.0', /condition not shown to be a bool/],
  ['an if value without else', '    bool b = if x > 0\n        true\n    b ? 1.0 : 0.0', /`if` used as a value without `else`/],
  ['history of a literal', '    x + 5[1]', /history of a literal or of a field/],
  ['a negative literal index', '    a = array.from(1.0, 2.0)\n    array.get(a, -1) + x', /negative index/],
]
const LIBS = fixtureLibraries({
  'tester/cleanlib/1': { path: 'tester/cleanlib/1', source: CLEAN, licence: 'MPL-2.0', attribution: 'cleanlib (test fixture)' },
  ...Object.fromEntries(CASES.map(([, body], k) => [`tester/changed/${k + 1}`, {
    path: `tester/changed/${k + 1}`, source: changed(body), licence: 'MPL-2.0', attribution: 'changed (test fixture)',
  }])),
})

const same = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
function hostRun(src) {
  const t = translatePine(src, { libraries: LIBS, mode: 'host' })
  const cols = (t.outputs || []).filter((o) => o && o.ast && o.kind !== 'alertcondition')
    .map((o) => Array.from(interpret(o.ast, BARS, {})))
  return { t, cols, why: t.refusal ? `${t.refusal.guard}: ${t.refusal.message}` : null }
}
function runtimeRun(src) {
  const b = buildRuntimeIr(src, { ...runtimeClockOpts(false), bars: BARS, inputs: {}, libraries: LIBS })
  if (!b.ok) return { b, cols: null, why: `${b.refusal.guard}: ${b.refusal.message}` }
  const p = lowerIrProgram(b.ir)
  const { outputs } = execute(p, { bars: N, series: SERIES, columns: p.columns, confirmed: true })
  return { b, cols: outputs.map((o) => Array.from(o)) }
}
function expectSameColumns(ra, rb) {
  expect(ra.cols, `first side refused — ${ra.why}`).not.toBe(null)
  expect(rb.cols, `second side refused — ${rb.why}`).not.toBe(null)
  expect(ra.cols.length, ra.why || '').toBeGreaterThan(0)
  expect(ra.cols.length).toBe(rb.cols.length)
  ra.cols.forEach((col, i) => {
    expect(col.some((x) => Number.isFinite(x)), `column ${i} computed nothing`).toBe(true)
    expect(same(col, rb.cols[i]), `column ${i} differs`).toBe(true)
  })
}

// the host lane computes no `for` loop (the runtime lane does), so the loop is read by the runtime case only
const USES = `import tester/cleanlib/1 as cl
plot(cl.spread(high, low))
plot(cl.smooth(close, 5))
plot(cl.pick(high, low, close > open))
plot(cl.rising(close, open) ? 1 : 0)
`
const USES_LOOP = `${USES}plot(cl.band(close, 4))
`
const PASTED_FNS = `spread(float h, float l) => h - l
smooth(float src, int len) =>
    float base = ta.sma(src, len)
    base + (src - src[1]) / 2.0
pick(float a, float b, bool useA) => useA ? a : b
band(float src, int len) =>
    float total = 0.0
    for i = 0 to len - 1
        total := total + src[i]
    total / len
rising(float a, float b) => a > b and b > 0
`
const PASTED_V6 = `${V6}${PASTED_FNS}plot(spread(high, low))
plot(smooth(close, 5))
plot(pick(high, low, close > open))
plot(rising(close, open) ? 1 : 0)
`
const PASTED_V6_LOOP = `${PASTED_V6}plot(band(close, 4))
`

describe('⭐⭐ a clean v5 library in a v6 script', () => {
  it('host lane: equals the library inside a v5 script, and its functions pasted into the v6 script', () => {
    const inV6 = hostRun(`${V6}${USES}`)
    const inV5 = hostRun(`${V5}${USES}`)
    expect(inV6.t.ok, inV6.why).toBe(true)
    expect(inV5.t.ok, inV5.why).toBe(true)
    expectSameColumns(inV6, inV5)
    expectSameColumns(inV6, hostRun(PASTED_V6))
    expect(inV6.cols.length).toBe(4)
  })

  it('runtime lane: the same', () => {
    const inV6 = runtimeRun(`${V6}${USES_LOOP}`)
    expect(inV6.b.ok, inV6.why).toBe(true)
    expectSameColumns(inV6, runtimeRun(`${V5}${USES_LOOP}`))
    expectSameColumns(inV6, runtimeRun(PASTED_V6_LOOP))
    expect(inV6.cols.length).toBe(5)
  })

  it('only the code the script REACHES is held to the guide (an unused function may read `timeframe.period`)', () => {
    const d = crossVersionDifference([], [])
    expect(d).toBe(null)
    const t = hostRun(`${V6}import tester/cleanlib/1 as cl\nplot(cl.spread(high, low))\n`)
    expect(t.t.ok, t.why).toBe(true)
  })

  it('⛔ CONTROL — a v6 library in a v5 script is still refused (the guide reads v5 → v6 only)', () => {
    const lib6 = fixtureLibraries({ 'tester/modern/1': { path: 'tester/modern/1', licence: 'MPL-2.0', attribution: 'm',
      source: `${MPL}\n//@version=6\nlibrary("modern")\nexport one() => 1\n` } })
    const t = translatePine(`${V5}import tester/modern/1 as m\nplot(m.one())\n`, { libraries: lib6, mode: 'host' })
    expect(t.refusal.guard).toBe('pine:module')
    expect(t.refusal.message).toMatch(/written in Pine v6 and this script in v5/)
  })
})

describe('⛔ each construct the v6 migration guide changed is refused BY NAME, in both lanes', () => {
  CASES.forEach(([name, , sentence], k) => {
    it(name, () => {
      const src = `${V6}import tester/changed/${k + 1} as c\nplot(c.f(close))\n`
      const t = translatePine(src, { libraries: LIBS, mode: 'host' })
      expect(t.ok).toBe(false)
      expect(t.refusal.guard).toBe(LIBRARY_VERSION)
      expect(t.refusal.message).toMatch(sentence)
      expect(t.refusal.line).toBe(3)
      const b = buildRuntimeIr(src, { ...runtimeClockOpts(false), inputs: {}, libraries: LIBS })
      expect(b.ok).toBe(false)
      expect(b.refusal.guard).toBe(LIBRARY_VERSION)
      expect(b.refusal.message).toMatch(sentence)
      // ⭐ the same library inside a v5 script is the exact path: nothing to refuse for its version
      const v5 = translatePine(`${V5}import tester/changed/${k + 1} as c\nplot(c.f(close))\n`, { libraries: LIBS, mode: 'host' })
      expect(v5.refusal && v5.refusal.guard).not.toBe(LIBRARY_VERSION)
    })
  })

  it('the checker answers on the definitions it is handed, and nothing else', () => {
    const lexed = lexPine(changed(CASES[1][1]))
    const stmts = blockStatements(lexed.tokens, lexed.indents, 0)
    const f = stmts.find((s) => s.header.some((t) => t.value === 'f'))
    expect(crossVersionDifference([{ stmt: f, kind: 'fn', name: 'f' }], lexed.indents).what).toBe('`timeframe.period`')
    expect(crossVersionDifference([], lexed.indents)).toBe(null)
  })
})
