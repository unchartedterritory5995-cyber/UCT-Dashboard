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

import { translatePine, Resolver, parseWholeExpression } from './pine.js'
import { TABLE } from './parse.js'
import { toRenderState } from '../objectRenderState.js'
import { fixtureLibraries } from './__tests__/libraryFixture.js'
import { interpret } from './interpret.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { runtimeClockOpts } from './pineRuntimeClock.js'
import { lowerIrProgram } from '../runtime/lowerIr.js'
import { execute } from '../runtime/vm.js'
import { ARRAY_FNS } from '../runtime/collections.js'
import { lexPine, blockStatements } from './pine.js'
import {
  crossVersionDifference, crossVersionAdmitted, admissionTableOf, LIBRARY_VERSION, versionAt, stampLibraryVersion,
  ISLAND_FAMILY, RUNTIME_ISLAND_FAMILIES,
} from './pineLibraryVersion.js'
import { linkLibraries } from './pineLibraries.js'
import COMMITTED_ADMISSION from './pineLibraryCrossVersion.json'
import LENGTH_QUALIFIERS from './windowLengthQualifiers.json'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
// [name, body, the sentence, its family (null: refused on every lane, whatever the island)]
const F = ISLAND_FAMILY
const CASES = [
  ['and/or with a call on its right', '    x > 0 and ta.rising(x, 2) ? x : 0.0', /`and` with a call on its right \(`ta\.rising`\)/, F.LAZY_AND_OR],
  ['timeframe.period', '    timeframe.period == "D" ? x : 0.0', /`timeframe\.period`/, F.TIMEFRAME_PERIOD],
  ['a changed colour constant', '    c = color.red\n    x', /`color\.red`.*#FF5252 in v5, #F23645 in v6/, F.COLOURS],
  ['label.new without textcolor', '    label.new(bar_index, x, "a")\n    x', /`label\.new` without `textcolor`/, F.OBJECT_DEFAULTS],
  ['a for bound that calls something', '    float t = 0.0\n    for i = 0 to math.round(x) % 3\n        t := t + 1\n    t', /`for` loop whose end bound calls `math\.round`/, F.FOR_BOUND],
  ['a for bound the loop reassigns', '    int n = 3\n    float t = 0.0\n    for i = 0 to n\n        n := n - 1\n        t := t + 1\n    t', /`for` loop whose end bound reads `n`/, F.FOR_BOUND],
  ['box.new without bgcolor', '    b = box.new(bar_index, x, bar_index + 1, x - 1)\n    x', /`box\.new` without `bgcolor`.*opaque/, F.OBJECT_DEFAULTS],
  ['box.new with bgcolor, without text_color', '    b = box.new(bar_index, x, bar_index + 1, x - 1, bgcolor = color.new(color.blue, 50))\n    x', /`box\.new` without `text_color`/, F.OBJECT_DEFAULTS],
  // ⚰️ 'table.cell without text_color' stood here until e93: a cell's unset text is `color.black` in v5 AND v6
  // (witnessed), so it is no longer a construct the versions draw differently (railed below: NOT held)
  ['a const int division', '    int k = 5\n    x + k / 2', /division of two values that may be `const int`/, null],
  ['a request', '    request.security(syminfo.tickerid, "D", x)', /`request\.security`/, null],
  ['na() of a value not shown to be a number', '    b = x > 0\n    na(b) ? 1.0 : x', /`na\(\)` of a value not shown to be a number/, F.BOOL_NA],
  ['history of a bool', '    b = x > 0\n    b[1] ? 1.0 : x', /history of the bool `b`/, F.BOOL_NA],
  ['a condition not shown to be a bool', '    y = x * 2\n    y ? 1.0 : 0.0', /condition not shown to be a bool/, F.IMPLICIT_CAST],
  // ⚰️ Phase B's check did not hold it: the island drew `up == false` as v6 does on the warm-up bars
  ['a bool compared with ==', '    up = x > ta.sma(x, 5)\n    up == false ? 1.0 : 0.0', /a bool compared with `==`/, F.BOOL_NA],
  ['a bool compared with != (a typed bool, in parentheses)', '    bool up = x > ta.sma(x, 5)\n    (up) != true ? 1.0 : 0.0', /a bool compared with `!=`/, F.BOOL_NA],
  ['an if value without else','    bool b = if x > 0\n        true\n    b ? 1.0 : 0.0', /`if` used as a value without `else`/, F.BOOL_NA],
  ['history of a literal', '    x + 5[1]', /history of a literal or of a field/, null],
  ['a negative literal index', '    a = array.from(1.0, 2.0)\n    array.get(a, -1) + x', /negative index/, null],
  ['str.tostring of a numeric constant', '    s = str.tostring(0.1234567890123)\n    str.length(s) + x', /`str\.tostring` of a numeric constant with no format/, F.TOSTRING_LITERAL],
]
// a clean v5 library whose one export the runtime lane refuses inside the library's own code
const ISLAND_REFUSES = `${MPL}
//@version=5
library("islandrefuses")
export g(float x) => nosuchfn(x)
`
// ── ⭐⭐ the version island, step 2: one v5 library per family the runtime lane judges per token. Each export
// reads the family's construct where its v5 and v6 answers differ, once in a pure expression (the columnar
// resolver's path) and once through a `var` (the run's own lowering), so a rule left on the program version on
// either path draws another picture.
const ISLAND = {
  [F.TIMEFRAME_PERIOD]: {
    lib: `export daily(float x) => timeframe.period == "D" ? x : -x
export counted(float x) =>
    var float n = 0.0
    if timeframe.period == "D"
        n := n + x
    n
export text(float x) =>
    var string s = ""
    s := timeframe.period
    s == "D" ? x : -x
`,
    uses: 'plot(il.daily(close))\nplot(il.counted(close))\nplot(il.text(close))\n',
  },
  // `color.red` / `color.teal` / `color.yellow` changed value in v6 (`#FF5252` / `#00897B` / `#FFEB3B` at v5)
  [F.COLOURS]: {
    lib: `export teal(float x) =>
    var color c = color.teal
    c := x > 100 ? color.teal : color.yellow
    c == #00897B ? 1.0 : 0.0
export kept(float x) =>
    var color c = color.yellow
    c := x > 100 ? color.red : color.yellow
    c == #FFEB3B or c == #FF5252 ? 1.0 : 0.0
`,
    uses: 'plot(il.teal(close))\nplot(il.kept(close))\n',
  },
  // `str.tostring` of a numeric literal: in full at v5, ten decimals at v6 (`pineTextFormat.js::literalTostringText`)
  [F.TOSTRING_LITERAL]: {
    lib: `export digits(float x) => str.length(str.tostring(0.1234567890123)) + x * 0
export kept(float x) =>
    var string s = ""
    s := str.tostring(1.0000000000001)
    str.length(s) + x * 0
`,
    uses: 'plot(il.digits(close))\nplot(il.kept(close))\n',
  },
  // a `for` loop's `to` bound: read once at v5, before every pass at v6 (Dynamic for loop boundaries)
  [F.FOR_BOUND]: {
    lib: `export passes(float x) =>
    int n = 3
    float t = 0.0
    for i = 0 to n
        n := n - 1
        t := t + 1
    t + x * 0
export calls(float x) =>
    float t = 0.0
    for i = 0 to math.round(x) % 3
        t := t + i
    t + x * 0
`,
    uses: 'plot(il.passes(close))\nplot(il.calls(close))\n',
  },
  // `and` / `or`: both sides on every bar at v5, the right side only when the left does not decide at v6, so a
  // `ta.*` on the right keeps every bar's history at v5 and only the bars it ran on at v6
  [F.LAZY_AND_OR]: {
    lib: `export up(float x) => x > 100 and ta.rising(x, 2) ? 1.0 : 0.0
export hits(float x) =>
    var float n = 0.0
    if x > 100 and ta.sma(x, 3) > 100
        n := n + 1
    n
`,
    uses: 'plot(il.up(close))\nplot(il.hits(close))\n',
  },
  // ⭐⭐ island PR 2 — a bool can be `na` at v5: an `if` used as a bool value with no `else` is `na` where it matches
  // nothing at v5 (and `false` at v6, which this lane refuses by name, Q-A3), read here by `na()` and by `== false`
  [F.BOOL_NA]: {
    lib: `export unmatched(float x) =>
    bool b = if x > 101
        true
    na(b) ? 1.0 : 0.0
export unmatchedeq(float x) =>
    bool b = if x > 101
        true
    b == false ? 1.0 : 0.0
`,
    uses: 'plot(il.unmatched(close))\nplot(il.unmatchedeq(close))\n',
  },
}
// ⭐⭐ island PR 2 — the families whose per-token reading draws the SAME picture on the run's own path, so the
// family-by-family rail below cannot tell them from the program version there; each has its own rail (the columnar
// resolver over island tokens, where the two readings do differ).
const SAME_PICTURE_FAMILIES = [F.IMPLICIT_CAST]
// ⭐⭐ island PR 3 — the families whose picture is the run's OBJECTS, railed on the rendered objects (below)
const OBJECT_PICTURE_FAMILIES = [F.OBJECT_DEFAULTS]
// ⭐⭐ island PR 3 — a v5 library that makes a label, a box and a table cell with their colours unset (and one named)
const ISLAND_OBJECTS = `${MPL}
//@version=5
library("islandobjects")
export marks(float x) =>
    if bar_index == 20
        label.new(bar_index, x, "a")
        box.new(bar_index, x + 1, bar_index + 1, x - 1, text = "b")
    x
export cells(float x) =>
    var t = table.new(position.top_right, 1, 1)
    table.cell(t, 0, 0, "c")
    x
export named(float x) =>
    if bar_index == 20
        label.new(bar_index, x, "a", textcolor = color.green)
    x
`
// ⭐⭐ island PR 2 — a v5 library whose bools can be `na`: what a v5 script refuses by name the island refuses by the
// same name; a number read as a condition; and every way a v5 `na` bool could leave the island
const PR2 = `${MPL}
//@version=5
library("islandpr2")
type Flag
    bool on
export eqf(float x) =>
    up = x > ta.sma(x, 5)
    up == false ? 1.0 : 0.0
export nab(float x) =>
    b = x > ta.sma(x, 5)
    na(b) ? 1.0 : 0.0
export cast(float x) =>
    y = x - 100.5
    y ? 1.0 : 0.0
export castvar(float x) =>
    var float n = 0.0
    n := ta.sma(x, 5) - 100.5
    float r = 0.0
    if n
        r := 1.0
    r
export notcast(float x, float y) => not (y - 100.5) ? 1.0 : 0.0
export flags(float x) =>
    array<bool> a = array.new<bool>(0)
    array.push(a, x > 100)
    a
export firstflag(float x) =>
    array<bool> a = array.from(x > 100, x < 50)
    array.get(a, 0)
export fill(array<bool> out, float x) =>
    array.push(out, x > 100)
    x
export floats(array<float> out, float x) =>
    array.push(out, x)
    x
export flagfield(float x) =>
    Flag f = Flag.new(x > 100)
    f.on
`
// the island's one boundary: what a v5 function hands v6 code (design section 2.6)
const BOUNDARY = `${MPL}
//@version=5
library("islandboundary")
export above(float x, float y) => x > y
export both(float x, float y) => x > y and y > 0
export kept(float x) =>
    var bool up = false
    up := x > 100
    up
`
// the island at RUN time: collection rules the VM decides by version (`runtime/collections.js` / `maps.js`), each
// reached from bar 7 on, so a stop has a bar to name
const AT_RUN_TIME = `${MPL}
//@version=5
library("islandruntime")
export last(float x) =>
    a = array.from(1.0, 2.0, x)
    i = bar_index < 7 ? 0 : -1 * math.round(x / x)
    array.get(a, i)
export naindex(float x) =>
    a = array.from(10.0, 20.0)
    int k = 0
    if bar_index >= 7
        k := na
    array.get(a, k) + x * 0
export some(float x) =>
    array<bool> f = array.from(x > 100, x < 50)
    float s = 0.0
    if bar_index >= 7
        bool t = array.some(f)
        s := t ? 1.0 : 0.0
    s
export boolkey(float x) =>
    m = map.new<string, bool>()
    map.put(m, "up", x > 100)
    bool v = map.get(m, bar_index < 7 ? "up" : "gone")
    v ? 1.0 : 0.0
export boolkeyout(float x) =>
    m = map.new<string, bool>()
    map.put(m, "up", x > 100)
    map.get(m, bar_index < 7 ? "up" : "gone")
export floatkey(float x) =>
    m = map.new<string, float>()
    map.put(m, "up", x)
    map.get(m, bar_index < 7 ? "up" : "gone")
export head(float x) =>
    a = array.from(x, 1.0)
    array.get(a, 0)
`
const islandPath = (family) =>`tester/island${family.replace(/[^a-z]/gi, '')}/1`
const islandSource = (family) => `${MPL}\n//@version=5\nlibrary("island")\n${ISLAND[family].lib}`
const LIBS = fixtureLibraries({
  ...Object.fromEntries(Object.keys(ISLAND).map((f) => [islandPath(f), {
    path: islandPath(f), source: islandSource(f), licence: 'MPL-2.0', attribution: 'island (test fixture)',
  }])),
  'tester/islandboundary/1': { path: 'tester/islandboundary/1', source: BOUNDARY, licence: 'MPL-2.0', attribution: 'islandboundary (test fixture)' },
  'tester/islandruntime/1': { path: 'tester/islandruntime/1', source: AT_RUN_TIME, licence: 'MPL-2.0', attribution: 'islandruntime (test fixture)' },
  'tester/islandpr2/1': { path: 'tester/islandpr2/1', source: PR2, licence: 'MPL-2.0', attribution: 'islandpr2 (test fixture)' },
  'tester/islandobjects/1': { path: 'tester/islandobjects/1', source: ISLAND_OBJECTS, licence: 'MPL-2.0', attribution: 'islandobjects (test fixture)' },
  'tester/cleanlib/1': { path: 'tester/cleanlib/1', source: CLEAN, licence: 'MPL-2.0', attribution: 'cleanlib (test fixture)' },
  'tester/islandrefuses/1': { path: 'tester/islandrefuses/1', source: ISLAND_REFUSES, licence: 'MPL-2.0', attribution: 'islandrefuses (test fixture)' },
  ...Object.fromEntries(CASES.map(([, body], k) => [`tester/changed/${k + 1}`, {
    path: `tester/changed/${k + 1}`, source: changed(body), licence: 'MPL-2.0', attribution: 'changed (test fixture)',
  }])),
})

const same = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
// the fixture versions this rail admits (the committed table admits none of them)
const ADMIT = { admit: Object.keys(LIBS).map((path) => ({ path })) }
function hostRun(src) {
  const t = translatePine(src, { libraries: LIBS, libraryCrossVersion: ADMIT, mode: 'host' })
  const cols = (t.outputs || []).filter((o) => o && o.ast && o.kind !== 'alertcondition')
    .map((o) => Array.from(interpret(o.ast, BARS, {})))
  return { t, cols, why: t.refusal ? `${t.refusal.guard}: ${t.refusal.message}` : null }
}
function runtimeRun(src) {
  const b = buildRuntimeIr(src, { ...runtimeClockOpts(false), bars: BARS, inputs: {}, libraries: LIBS, libraryCrossVersion: ADMIT })
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

describe('⭐⭐ the admission table (coordinator ruling 2026-11-16): only an admitted version links across versions', () => {
  it('a clean v5 library that is NOT admitted is refused by name in both lanes, as the committed table leaves it', () => {
    const src = `${V6}${USES}`
    expect(crossVersionAdmitted('tester/cleanlib/1')).toBe(false)
    const t = translatePine(src, { libraries: LIBS, mode: 'host' })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe(LIBRARY_VERSION)
    expect(t.refusal.message).toMatch(/only for a version graded against TradingView in v6 scripts/)
    const b = buildRuntimeIr(src, { ...runtimeClockOpts(false), inputs: {}, libraries: LIBS })
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe(LIBRARY_VERSION)
    // ⭐ CONTROL — the same library in a v5 script is the exact path and needs no admission
    expect(translatePine(`${V5}${USES}`, { libraries: LIBS, mode: 'host' }).ok).toBe(true)
  })

  it('the table fails closed: a document it cannot read admits nothing', () => {
    for (const bad of [null, {}, { admit: 'x' }, { admit: [{}] }, { admit: [{ path: '' }] }, { admit: [{ path: 'a/b/1' }, 7] }]) {
      expect(admissionTableOf(bad)).toBe(null)
      expect(crossVersionAdmitted('a/b/1', admissionTableOf(bad))).toBe(false)
    }
    expect([...admissionTableOf({ admit: [] })]).toEqual([])
    expect(crossVersionAdmitted('a/b/1', admissionTableOf({ admit: [{ path: 'a/b/1' }] }))).toBe(true)
    // an unreadable override admits nothing, in the linker too
    const t = translatePine(`${V6}${USES}`, { libraries: LIBS, libraryCrossVersion: { admit: [{}] }, mode: 'host' })
    expect(t.refusal && t.refusal.guard).toBe(LIBRARY_VERSION)
  })

  it('the committed table is readable and admits exactly its rows', () => {
    const table = admissionTableOf(COMMITTED_ADMISSION)
    expect(table).not.toBe(null)
    for (const row of COMMITTED_ADMISSION.admit) expect(crossVersionAdmitted(row.path)).toBe(true)
  })
})

describe('⛔ each construct the v6 migration guide changed is refused BY NAME on the host lane, and on the runtime lane unless the island judges its family', () => {
  CASES.forEach(([name, , sentence, family], k) => {
    it(name, () => {
      const src = `${V6}import tester/changed/${k + 1} as c\nplot(c.f(close))\n`
      const t = translatePine(src, { libraries: LIBS, libraryCrossVersion: ADMIT, mode: 'host' })
      expect(t.ok).toBe(false)
      expect(t.refusal.guard).toBe(LIBRARY_VERSION)
      expect(t.refusal.message).toMatch(sentence)
      expect(t.refusal.line).toBe(3)
      const b = buildRuntimeIr(src, { ...runtimeClockOpts(false), inputs: {}, libraries: LIBS, libraryCrossVersion: ADMIT })
      if (family && RUNTIME_ISLAND_FAMILIES.includes(family)) {
        // ⭐⭐ the version island: the runtime lane judges this family per token, so the import links
        expect(!b.ok && b.refusal.guard === LIBRARY_VERSION, b.refusal ? b.refusal.message : '').toBe(false)
      } else {
        expect(b.ok).toBe(false)
        expect(b.refusal.guard).toBe(LIBRARY_VERSION)
        expect(b.refusal.message).toMatch(sentence)
      }
      // ⭐ the same library inside a v5 script is the exact path: nothing to refuse for its version
      const v5 = translatePine(`${V5}import tester/changed/${k + 1} as c\nplot(c.f(close))\n`, { libraries: LIBS, mode: 'host' })
      expect(v5.refusal && v5.refusal.guard).not.toBe(LIBRARY_VERSION)
    })
  })

  // ⭐ (libchain, 2026-11-20) what a binding HOLDS decides whether it is a bool: its declared type first, then the
  // arms of a `?:` (never its condition). ⚰️ The pass read `int k = c ? 0 : na` and `c := x > 1 ? color.a : color.b`
  // as bools (the comparison in the condition) and refused the import as "`na` given to the bool": an over-refusal.
  // The conservative side stays: an arm nothing can type keeps a binding (or an `==` operand) a bool, a shadowing bool
  // stays held, and a `?:` read as a CONDITION is a bool only when both its arms are.
  const ask = (body) => {
    const lexed = lexPine(changed(body))
    const stmts = blockStatements(lexed.tokens, lexed.indents, 0)
    const f = stmts.find((s) => s.header.some((t) => t.value === 'f'))
    const d = crossVersionDifference([{ stmt: f, kind: 'fn', name: 'f' }], lexed.indents)
    return d && `${d.family}: ${d.what}`
  }
  for (const [name, body] of [
    ['a typed int bound to a `?:` with an `na` arm', '    int k = x > 1 ? 0 : na\n    k + x'],
    ['a typed int whose `?:` arm nothing types (its declared type answers)', '    int k = x > 1 ? m.count : na\n    k + x'],
    ['a colour reassigned from a `?:` of colours', '    color c = na\n    c := x > 1 ? color.green : color.blue\n    x'],
    ['a colour reassigned from a `?:` whose arm nothing types (its declaration answers)', '    color c = na\n    c := x > 1 ? m.tint : na\n    x'],
    ['an untyped binding of a `?:` of numbers', '    k = x > 1 ? (x > 2 ? 1 : 0) : na\n    k + x'],
    ['a `?:` of numbers compared with `==`', '    (x > 1 ? 1 : 0) == 1 ? x : 0.0'],
  ]) {
    it(`declared types and \`?:\` arms are never bool operands: ${name}`, () => {
      expect(ask(body)).toBe(null)
    })
  }
  // ⭐ e93 (2026-11-21): a cell's unset text colour is `color.black` in v5 AND v6 (witnessed), so a v5 library's
  // `table.cell` without `text_color` is no longer held; CONTROL: `box.new` without `text_color` still is
  it('a `table.cell` without `text_color` is not held (the same `color.black` in both versions); `box.new` still is', () => {
    expect(ask('    t = table.new(position.top_right, 1, 1)\n    table.cell(t, 0, 0, "a")\n    x')).toBe(null)
    expect(ask('    b = box.new(bar_index, x, bar_index + 1, x - 1, bgcolor = color.new(color.blue, 50))\n    x'))
      .toMatch(new RegExp(`^${F.OBJECT_DEFAULTS}: \`box\\.new\` without \`text_color\``))
  })
  for (const [name, body, family] of [
    ['a typed bool given `na` in a `?:`', '    bool b = x > 1 ? true : na\n    x', F.BOOL_NA],
    ['an untyped `?:` whose arm nothing types', '    b = x > 1 ? this.flag : na\n    x', F.BOOL_NA],
    ['a bool that shadows a typed int', '    int k = 0\n    if x > 0\n        k = x > 1\n        k := na\n    x', F.BOOL_NA],
    ['a `?:` whose arm nothing types, compared with `==`', '    (x > 1 ? this.flag : na) == false ? x : 0.0', F.BOOL_NA],
    ['a `?:` of numbers read as a condition (an implicit cast)', '    (x > 1 ? x : 0.0) ? 1.0 : 0.0', F.IMPLICIT_CAST],
  ]) {
    it(`⛔ the conservative side stays held: ${name}`, () => {
      expect(ask(body)).toMatch(new RegExp(`^${family}: `))
    })
  }
  // ⭐ (2026-11-23, coordinator ruling on mutant V28) a shadowing bool stays held at `==` too. ⚰️ `boolOperand` read a
  // name declared with another type ANYWHERE in the kept code (`typedNotBool`) as never a bool operand: since the
  // libchain change a typed name reaches `boolNames` only through a shadowing untyped bool, so that guard decided
  // nothing anywhere else, and here it linked `k == m.v` of the shadowing bool `k` (V28 survived: no case read it).
  // ⚠️ The price (until the per-definition scoping): an outer-scope `k == y` of the typed int itself, in a library
  // that also shadows `k` with a bool, is held too (an over-refusal).
  it('⛔ the conservative side stays held: a bool that shadows a typed int, compared with `==` to a value nothing types', () => {
    expect(ask('    int k = 0\n    if x > 0\n        k = x > 1\n        y = k == m.v ? 1.0 : 0.0\n    x'))
      .toMatch(new RegExp(`^${F.BOOL_NA}: a bool compared with \`==\``))
  })
  it('end to end: a v5 library binding a typed int to a `?:` with an `na` arm links into a v6 script and equals the v5 script', () => {
    const k = CASES.length + 1
    const libs = fixtureLibraries({ [`tester/changed/${k}`]: { path: `tester/changed/${k}`, licence: 'MPL-2.0', attribution: 'changed (test fixture)',
      source: changed('    int k = x > 101 ? 1 : na\n    color c = na\n    c := x > 101 ? color.green : color.blue\n    nz(k) + x') } })
    const admit = { admit: [{ path: `tester/changed/${k}` }] }
    const run = (head) => {
      const t = translatePine(`${head}import tester/changed/${k} as c\nplot(c.f(close))\n`, { libraries: libs, libraryCrossVersion: admit, mode: 'host' })
      return { t, cols: t.ok ? (t.outputs || []).filter((o) => o && o.ast).map((o) => Array.from(interpret(o.ast, BARS, {}))) : null,
        why: t.refusal ? `${t.refusal.guard}: ${t.refusal.message}` : null }
    }
    const inV6 = run(V6)
    expect(inV6.t.ok, inV6.why).toBe(true)
    expectSameColumns(inV6, run(V5))
  })

  it('the checker answers on the definitions it is handed, and nothing else', () => {
    const lexed = lexPine(changed(CASES[1][1]))
    const stmts = blockStatements(lexed.tokens, lexed.indents, 0)
    const f = stmts.find((s) => s.header.some((t) => t.value === 'f'))
    expect(crossVersionDifference([{ stmt: f, kind: 'fn', name: 'f' }], lexed.indents).what).toBe('`timeframe.period`')
    expect(crossVersionDifference([], lexed.indents)).toBe(null)
  })
})

// ─── ⭐⭐ THE VERSION ISLAND, STEP 1 (coordinator ruling 2026-11-19): the carrier and its one reader ───────────────
// A spliced token of a library in another Pine version carries that version; `versionAt` is the only reader; a
// refusal inside the island names the version it was judged under. Nothing reads the version yet, so nothing a
// member is served moves (the committed admission table links no version across versions).
describe('⭐⭐ the version island: every spliced token carries its library\'s version, and one reader answers it', () => {
  const link = (src) => linkLibraries(lexPine(src), { libraries: LIBS, libraryCrossVersion: ADMIT }, { lexPine, blockStatements })

  it('a v5 library in a v6 script: each of its tokens is judged under v5, each of the script\'s under v6', () => {
    const l = link(`${V6}${USES}`)
    const lib = l.tokens.filter((t) => t.lib)
    const own = l.tokens.filter((t) => !t.lib)
    expect(lib.length).toBeGreaterThan(20)
    expect(own.length).toBeGreaterThan(20)
    expect(lib.filter((t) => versionAt(t, 6) !== 5)).toEqual([])
    expect(own.filter((t) => versionAt(t, 6) !== 6)).toEqual([])
    expect(l.libraryLink.libraries.map((x) => [x.path, x.pineVersion])).toEqual([['tester/cleanlib/1', 5]])
  })

  it('the same library in a v5 script is no island: its tokens and its entry carry nothing new', () => {
    const l = link(`${V5}${USES}`)
    const lib = l.tokens.filter((t) => t.lib)
    expect(lib.length).toBeGreaterThan(20)
    expect(lib.filter((t) => versionAt(t, 5) !== 5)).toEqual([])
    expect(lib.every((t) => !Object.prototype.hasOwnProperty.call(t, 'libPineVersion'))).toBe(true)
    expect(l.libraryLink.libraries.every((x) => !Object.prototype.hasOwnProperty.call(x, 'pineVersion'))).toBe(true)
  })

  it('versionAt answers the program version for anything not stamped, and the stamp only when versions differ', () => {
    expect(versionAt(null, 6)).toBe(6)
    expect(versionAt(undefined, 6)).toBe(6)
    expect(versionAt({ kind: 'ident' }, 6)).toBe(6)
    expect(versionAt(stampLibraryVersion({ kind: 'ident' }, 5, 6), 6)).toBe(5)
    expect(Object.keys(stampLibraryVersion({ kind: 'ident' }, 6, 6))).toEqual(['kind'])
    expect(Object.keys(stampLibraryVersion({ kind: 'ident' }, undefined, 6))).toEqual(['kind'])
  })

  it('a refusal inside the island names the library line with the version it was judged under', () => {
    const at = (head) => buildRuntimeIr(`${head}import tester/islandrefuses/1 as r\nplot(r.g(close))\n`,
      { ...runtimeClockOpts(false), inputs: {}, libraries: LIBS, libraryCrossVersion: ADMIT })
    const b = at(V6)
    expect(b.ok).toBe(false)
    expect(b.refusal.line).toBe(3)
    expect(b.refusal.message).toMatch(/in the imported library `tester\/islandrefuses\/1` \(Pine v5\), line 4/)
    // CONTROL: the same library in a v5 script is no island, and names no version
    const b5 = at(V5)
    expect(b5.ok).toBe(false)
    expect(b5.refusal.message).toMatch(/in the imported library `tester\/islandrefuses\/1`, line 4/)
    expect(b5.refusal.message).not.toMatch(/Pine v5\)/)
  })

  it('the island has one reader: no engine source but pineLibraryVersion.js names the stamp', () => {
    const engine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const sources = []
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p) } else if (/\.(m?js|jsx)$/.test(e.name) && !/\.test\.(m?js|jsx)$/.test(e.name)) sources.push(p)
      }
    }
    walk(engine)
    const naming = sources.filter((p) => fs.readFileSync(p, 'utf8').includes('libPineVersion'))
      .map((p) => path.relative(engine, p).split(path.sep).join('/'))
    // non-vacuous: the walk reads the engine, and finds the one file that holds the stamp
    expect(sources.length).toBeGreaterThan(100)
    expect(naming).toEqual(['ast/pineLibraryVersion.js'])
  })
})

// ─── ⭐⭐ THE VERSION ISLAND, STEP 2: FAMILY BY FAMILY (coordinator ruling 2026-11-19) ───────────────────────────────
// For every family the runtime lane judges per token: a v5 library that uses it, imported into a v6 script, computes on
// the runtime lane exactly what the SAME library computes imported into a v5 script, column for column. Non-vacuous:
// the same functions pasted into the v6 script (v6 rules over the same code) draw another picture or are refused. And
// the host lane, which does not judge per token, still refuses the import by name.
describe('⭐⭐ the version island, family by family: a v5 library in a v6 script computes what it computes in a v5 script', () => {
  it('every family the runtime lane judges per token has its rail here, and nothing else does', () => {
    expect(RUNTIME_ISLAND_FAMILIES.length).toBeGreaterThan(0)
    for (const f of RUNTIME_ISLAND_FAMILIES) expect(Object.values(ISLAND_FAMILY)).toContain(f)
    expect([...Object.keys(ISLAND), ...SAME_PICTURE_FAMILIES, ...OBJECT_PICTURE_FAMILIES].sort()).toEqual([...RUNTIME_ISLAND_FAMILIES].sort())
  })

  it('length qualifiers: the v5 and v6 references give a `series int` length to the same windows, so the per-token read changes no answer', () => {
    // The runtime lane reads a window's length qualifier at the version of the code that writes the call
    // (`seriesLengthFn`, `versionAt`). No fixture can tell the island from the program version while the two
    // references agree; this rail fails the day a regenerated table makes them differ, and that family then needs
    // its own fixture here.
    const series = (table, name) => !!table && table[name] === 'series int'
    const names = new Set([...Object.keys(LENGTH_QUALIFIERS.length), ...Object.keys(LENGTH_QUALIFIERS.v5Length)])
    expect(names.size).toBeGreaterThan(20)
    const differ = [...names].filter((n) => series(LENGTH_QUALIFIERS.length, n) !== series(LENGTH_QUALIFIERS.v5Length, n))
    expect(differ).toEqual([])
    expect([...names].filter((n) => series(LENGTH_QUALIFIERS.length, n)).length).toBeGreaterThan(5)
  })

  for (const family of Object.keys(ISLAND)) {
    it(`${family}: the runtime lane computes the v5 library's own answer inside a v6 script`, () => {
      const { uses } = ISLAND[family]
      const imp = `import ${islandPath(family)} as il\n`
      const inV6 = runtimeRun(`${V6}${imp}${uses}`)
      expect(inV6.b.ok, inV6.why).toBe(true)
      expect(inV6.b.ir && inV6.cols.length).toBe(uses.split('\n').filter((l) => l.startsWith('plot(')).length)
      expectSameColumns(inV6, runtimeRun(`${V5}${imp}${uses}`))
      // non-vacuous: v6 rules over the same code draw another picture (or are refused)
      const pasted = runtimeRun(`${V6}${ISLAND[family].lib.replace(/^export /gm, '')}${uses.replace(/\bil\./g, '')}`)
      expect(pasted.cols === null || pasted.cols.some((col, i) => !same(col, inV6.cols[i])),
        'v6 rules draw the same picture, so this rail cannot tell the island from the program version').toBe(true)
      // the host lane does not judge per token: it refuses the import by name
      const t = translatePine(`${V6}${imp}${uses}`, { libraries: LIBS, libraryCrossVersion: ADMIT, mode: 'host' })
      expect(t.ok).toBe(false)
      expect(t.refusal.guard).toBe(LIBRARY_VERSION)
    })
  }
})

// ─── ⭐⭐ THE ISLAND'S ONE BOUNDARY (design section 2.6): a v5 function handing v6 code a bool that can be `na` ─────────
// Pine v6 holds no `na` bool, and no capture shows what TradingView hands a v6 caller for a v5 one (`false`, or the
// `na` kept): capture row LV6. Until it lands the call is refused BY NAME, on both lanes and on both of the runtime
// lane's paths (the columnar resolver's inlining and the run's own call). `and` / `or` / `not` are never `na` at v5
// (F2, Q-NL) and cross. The same calls in a v5 script are no boundary.
describe('⭐⭐ the version island\'s boundary: a v5 function handing v6 code a bool that can be `na` is refused at the call', () => {
  const imp = 'import tester/islandboundary/1 as ib\n'
  const LV6 = /library function that hands this v6 script a .*can be `na` in Pine v5.*\(LV6\)/
  for (const [name, use, hostSaysBoundary, v5Draws] of [
    ['a comparison of its parameters (the columnar path)', 'plot(ib.above(close, ta.sma(close, 5)) ? 1 : 0)\n', true, true],
    // in a v5 script `na()` of such a bool is refused by its own (pre-island) name, never as the boundary
    ['a comparison read by `na()`', 'plot(na(ib.above(close, ta.sma(close, 5))) ? 1 : 0)\n', true, false],
    // the host lane may refuse this one by another name first (a `var` in a function)
    ['a `bool` variable (the run\'s own call)', 'plot(ib.kept(close) ? 1 : 0)\n', false, true],
  ]) {
    it(`${name}: refused by name in a v6 script, both lanes; served in a v5 script`, () => {
      const r = runtimeRun(`${V6}${imp}${use}`)
      expect(r.cols, 'the runtime lane drew a v5 na bool in v6 code').toBe(null)
      expect(r.b.refusal.guard).toBe(LIBRARY_VERSION)
      expect(r.b.refusal.message).toMatch(LV6)
      expect(r.b.refusal.line).toBe(4)
      const t = translatePine(`${V6}${imp}${use}`, { libraries: LIBS, libraryCrossVersion: ADMIT, mode: 'host' })
      expect(t.ok).toBe(false)
      if (hostSaysBoundary) expect(t.refusal.message).toMatch(LV6)
      // CONTROL: in a v5 script there is no boundary
      const v5 = runtimeRun(`${V5}${imp}${use}`)
      if (v5Draws) expect(v5.cols, v5.why).not.toBe(null)
      else expect(v5.b.refusal && v5.b.refusal.guard).not.toBe(LIBRARY_VERSION)
    })
  }

  it('`and` / `or` crosses: never `na` at v5, so it is served and equals the v5 script', () => {
    const use = 'plot(ib.both(close, open) ? 1 : 0)\n'
    const r = runtimeRun(`${V6}${imp}${use}`)
    expect(r.b.ok, r.why).toBe(true)
    expectSameColumns(r, runtimeRun(`${V5}${imp}${use}`))
  })
})

// ─── ⭐⭐ ISLAND PR 2: A v5 LIBRARY'S BOOLS ARE v5 BOOLS (they can be `na`), AND A NUMBER IT READS AS A CONDITION IS CAST ──
// The run's own rules (`boolNaOnThisLane`, the `na()` read, an unmatched bool block) and the columnar resolver's
// (`condition`, `boolNaOperator`, `na()`) read the version at the token. Where a v5 script refuses a bool that can be
// `na` by name, the island refuses it by the same name; where it draws, the island draws the same picture (the family
// rail above). Every way such a bool could reach the v6 script is refused at the call (LV6).
describe('⭐⭐ island PR 2: a v5 library\'s bools are judged under v5, and a v5 `na` bool never reaches v6 code', () => {
  const imp = 'import tester/islandpr2/1 as p2\n'
  const pasted = PR2.split('\n').slice(3).join('\n').replace(/^export /gm, '')
  // a refusal inside a library names the library line; the island's adds the version it was judged under
  const sameRefusal = (island, v5) => {
    expect(v5.cols, 'CONTROL: the v5 script refuses it').toBe(null)
    expect(island.cols, 'the island drew what the v5 script refuses').toBe(null)
    expect(island.b.refusal.guard).toBe(v5.b.refusal.guard)
    expect(island.b.refusal.line).toBe(v5.b.refusal.line)
    expect(island.b.refusal.message.replace(' (Pine v5), line', ', line')).toBe(v5.b.refusal.message)
  }
  for (const [name, use] of [
    ['`== false` over a bool that can be `na` (the run\'s own `==`)', 'plot(p2.eqf(close))\n'],
    ['`na()` of a bool that can be `na` (the run\'s own `na()`)', 'plot(p2.nab(close))\n'],
  ]) {
    it(`${name}: refused by the v5 script's own name; pasted into the v6 script it draws`, () => {
      sameRefusal(runtimeRun(`${V6}${imp}${use}`), runtimeRun(`${V5}${imp}${use}`))
      const v6 = runtimeRun(`${V6}${pasted}${use.replace('p2.', '')}`)
      expect(v6.cols, v6.why).not.toBe(null)
    })
  }

  it('a number read as a condition: the island computes the v5 script\'s picture on the run\'s own path', () => {
    const use = 'plot(p2.cast(close))\nplot(p2.castvar(close))\nplot(p2.notcast(close, ta.sma(close, 5)))\n'
    const inV6 = runtimeRun(`${V6}${imp}${use}`)
    expect(inV6.b.ok, inV6.why).toBe(true)
    expectSameColumns(inV6, runtimeRun(`${V5}${imp}${use}`))
  })

  // the columnar resolver over a v5 library's tokens: the same expression, stamped as island tokens and read by a v6
  // resolver, equals a v5 resolver's reading, and differs from a v6 resolver's (non-vacuous)
  const expressionTokens = (text, island) => lexPine(`${V6}x = ${text}\n`).tokens.filter((t) => t.line === 3).slice(2)
    .map((t) => (island ? stampLibraryVersion({ ...t }, 5, 6) : t))
  const resolved = (text, version, island) => {
    const seen = []
    const r = new Resolver(new Map(), TABLE, new Map(), { pineVersion: version, pineScript: true })
    r.onCondition = (c) => seen.push(`${c.site}:${c.cast}:${c.version}`)
    const col = Array.from(interpret(r.resolve(parseWholeExpression(expressionTokens(text, island))), BARS, {}))
    return { col, seen }
  }
  for (const [name, text, family] of [
    ['`== false` drawn as a value', '(close > ta.sma(close, 5)) == false', F.BOOL_NA],
    ['`== false` read as a condition', '(close > ta.sma(close, 5)) == false ? 1 : 0', F.BOOL_NA],
    ['`na()` of a comparison', 'na(close > ta.sma(close, 5)) ? 1 : 0', F.BOOL_NA],
    ['a number read as a condition', '(ta.sma(close, 5) - 100.5) ? 1 : 0', F.IMPLICIT_CAST],
  ]) {
    it(`${family}, the columnar resolver: ${name} over island tokens is read as a v5 script reads it`, () => {
      const island = resolved(text, 6, true)
      const v5 = resolved(text, 5, false)
      const v6 = resolved(text, 6, false)
      expect(same(island.col, v5.col), `island ${island.col.slice(0, 8)} v5 ${v5.col.slice(0, 8)}`).toBe(true)
      expect(same(v6.col, v5.col), 'v5 and v6 read it alike, so this rail cannot tell them apart').toBe(false)
      expect(island.seen).toEqual(v5.seen)
      if (family === F.IMPLICIT_CAST) expect(island.seen).toEqual(['ternary:true:5'])
    })
  }

  for (const [name, use, phrase] of [
    ['a `bool` array handed back', 'a = p2.flags(close)\nplot(array.size(a))\n', /a collection or record that can hold a `bool`/],
    ['an element of a `bool` array', 'plot(p2.firstflag(close) ? 1 : 0)\n', /a value read from a collection that can hold a `bool`/],
    ['a `bool` array the script shares with it', 'var b = array.new<bool>(0)\nplot(p2.fill(b, close))\n', /the `out` it shares with this script, a collection or record that can hold a `bool`/],
    ['a record\'s `bool` field', 'plot(p2.flagfield(close) ? 1 : 0)\n', /a record field that can hold a `bool`/],
  ]) {
    it(`⛔ the boundary: ${name} is refused at the call by name (LV6); served in a v5 script`, () => {
      const r = runtimeRun(`${V6}${imp}${use}`)
      expect(r.cols, 'a v5 bool that can be na reached v6 code').toBe(null)
      expect(r.b.refusal.guard).toBe(LIBRARY_VERSION)
      expect(r.b.refusal.message).toMatch(phrase)
      expect(r.b.refusal.message).toMatch(/\(LV6\)/)
      const v5 = runtimeRun(`${V5}${imp}${use}`)
      expect(v5.b.refusal && v5.b.refusal.guard, v5.why).not.toBe(LIBRARY_VERSION)
    })
  }
  it('CONTROL: a `float` array the script shares with it crosses (no bool in it) and equals the v5 script', () => {
    const use = 'var f = array.new<float>(0)\nplot(p2.floats(f, close))\nplot(array.size(f))\n'
    const r = runtimeRun(`${V6}${imp}${use}`)
    expect(r.b.ok, r.why).toBe(true)
    expectSameColumns(r, runtimeRun(`${V5}${imp}${use}`))
  })
})

// ─── ⭐⭐ ISLAND PR 3: A v5 LIBRARY'S OBJECTS DRAW v5's DEFAULT COLOURS ─────────────────────────────────────────────
// A label's unset text colour, a box's unset fill and text colour and a table cell's unset text colour are v5's
// witnessed defaults (`objectDefaults.js` VERSION_DEFAULTS[5]) for an object a v5 library makes inside a v6 script,
// as for the same library inside a v5 script. The run's objects are drawn at the PROGRAM's version, so the call
// carries the island's default (`pineRuntimeFrontend.js` lowerObjectCall). Railed on the RENDERED objects.
describe('⭐⭐ island PR 3: a v5 library\'s label, box and table cell draw v5\'s default colours inside a v6 script', () => {
  const imp = 'import tester/islandobjects/1 as io\n'
  const pastedObjects = ISLAND_OBJECTS.split('\n').slice(3).join('\n').replace(/^export /gm, '')
  const rendered = (src) => {
    const b = buildRuntimeIr(src, { ...runtimeClockOpts(false), bars: BARS, inputs: {}, libraries: LIBS, libraryCrossVersion: ADMIT, objectsInRun: true })
    if (!b.ok) return { why: `${b.refusal.guard}: ${b.refusal.message}` }
    const p = lowerIrProgram(b.ir)
    const r = execute(p, { bars: N, series: SERIES, columns: p.columns, confirmed: true })
    const rs = toRenderState(r.objects.finish().live, { bars: BARS.map((x) => ({ time: x.t * 1000, ...x })), tf: 'D', pineVersion: b.ir.version })
    return {
      labels: rs.labels.map((l) => [l.text, l.textcolor, l.color]),
      boxes: rs.boxes.map((x) => [x.bgcolor, x.text_color, x.border_color]),
      cells: rs.tables.flatMap((t) => (t.cells || []).map((c) => [c.text, c.text_color])),
    }
  }
  // ⭐ e93: a cell's unset text is `color.black` in v6 too (witnessed), so the pasted v6 cell draws the SAME colour:
  // the island has nothing left to carry for a cell (`v6Differs` false), and the label / box case stays the control
  for (const [name, use, expectV5, v6Differs] of [
    ['a label and a box with their colours unset', 'plot(io.marks(close))\n', { labels: [['a', '#363A45', '#2962FF']], boxes: [['#2962FF', '#363A45', '#2962FF']], cells: [] }, true],
    ['a table cell with its text colour unset', 'plot(io.cells(close))\n', { labels: [], boxes: [], cells: [['c', '#363A45']] }, false],
  ]) {
    it(`${name}: the island draws the v5 script's colours; pasted into the v6 script, v6's`, () => {
      const v5 = rendered(`${V5}${imp}${use}`)
      expect(v5, v5.why).toEqual(expectV5)
      const island = rendered(`${V6}${imp}${use}`)
      expect(island, island.why).toEqual(v5)
      // non-vacuous: v6 rules over the same calls draw v6's defaults
      const pasted = rendered(`${V6}${pastedObjects}${use.replace('io.', '')}`)
      expect(pasted.why).toBe(undefined)
      if (v6Differs) expect(pasted).not.toEqual(v5)
      else expect(pasted).toEqual(v5)
      // the host lane does not judge per token: it refuses the import by name where the versions differ; a cell's
      // unset text no longer does (e93), so a library whose only object is that cell links on the host lane too
      const t = translatePine(`${V6}${imp}${use}`, { libraries: LIBS, libraryCrossVersion: ADMIT, mode: 'host' })
      if (v6Differs) expect(t.refusal && t.refusal.guard).toBe(LIBRARY_VERSION)
      else expect(t.refusal && t.refusal.guard, t.refusal && t.refusal.message).not.toBe(LIBRARY_VERSION)
    })
  }
  it('a colour the library names is its own, never replaced; the script\'s own label keeps v6\'s default', () => {
    const island = rendered(`${V6}${imp}plot(io.named(close))\nif bar_index == 21\n    label.new(bar_index, close, "own")\n`)
    expect(island.why).toBe(undefined)
    expect(island.labels).toEqual([['a', '#4CAF50', '#2962FF'], ['own', '#FFFFFF', '#2962FF']])
  })
})

// ─── ⭐⭐ THE VERSION ISLAND AT RUN TIME: a collection op a v5 library writes is judged under v5 by the VM ──────────
// `runtime/collections.js` and `maps.js` decide four rules by version while the script runs (a negative index counts
// from the end at v6 and stops at v5; an `na` index reads `na` at v4 / v6 and stops at v5; `array.every` / `some`
// are v6 members; a bool map's missing key). The front end marks a v5 library's collection call inside a v6 program
// (`islandVersion`), `lowerIr` carries it on that op alone, and the VM judges that op under v5 (`budget.opVersion`).
// So the island raises the SAME named stop a v5 script raises, on the same bar; the same functions pasted into the
// v6 script take v6's path (non-vacuous). The one exception is the bool map: a v5 script answers `na` there, which
// the island cannot hand on until bool `na` is judged per token, so the island stops by its own name instead.
describe('⭐⭐ the version island at run time: a v5 library\'s collection op is judged under v5, the script\'s under its own version', () => {
  const imp = 'import tester/islandruntime/1 as ir\n'
  const pastedLib = AT_RUN_TIME.split('\n').slice(3).join('\n').replace(/^export /gm, '')
  /** Build, lower and run; a runtime stop is `{name, message, bar}` (the bar it stopped on), never thrown. */
  function runStop(src) {
    const b = buildRuntimeIr(src, { ...runtimeClockOpts(false), bars: BARS, inputs: {}, libraries: LIBS, libraryCrossVersion: ADMIT })
    if (!b.ok) return { b, p: null, cols: null, stop: null, why: `${b.refusal.guard}: ${b.refusal.message}` }
    const p = lowerIrProgram(b.ir)
    let done = -1
    try {
      const run = execute(p, { bars: N, series: SERIES, columns: p.columns, confirmed: true }, undefined, { onBar: (bar) => { done = bar } })
      return { b, p, run, cols: run.outputs.map((o) => Array.from(o)), stop: null }
    } catch (e) {
      return { b, p, cols: null, stop: { name: e.name, message: e.message, bar: done + 1 } }
    }
  }
  /** Every value of `key` anywhere in `o` (the IR is a plain tree of objects and arrays). */
  const valuesOf = (o, key, out = [], seen = new WeakSet()) => {
    if (!o || typeof o !== 'object' || seen.has(o)) return out
    seen.add(o)
    if (Object.prototype.hasOwnProperty.call(o, key)) out.push(o[key])
    for (const v of Object.values(o)) valuesOf(v, key, out, seen)
    return out
  }
  const expectSameStop = (island, v5, sentence) => {
    expect(v5.b.ok, v5.why).toBe(true)
    expect(island.b.ok, island.why).toBe(true)
    expect(v5.stop, 'CONTROL: the v5 script stops there').not.toBe(null)
    expect(v5.stop.name).toBe('CollectionError')
    expect(v5.stop.message).toMatch(sentence)
    expect(v5.stop.bar, v5.stop.message).toBe(7)
    // ⛔ never the v6 path: the island stops, it computes no value
    expect(island.cols, 'the island took the v6 path and drew a value').toBe(null)
    expect(island.stop).toEqual(v5.stop)
  }

  it('a computed negative index stops as the v5 script stops (same sentence, same bar); pasted into the v6 script it counts from the end', () => {
    const use = 'plot(ir.last(close))\n'
    expectSameStop(runStop(`${V6}${imp}${use}`), runStop(`${V5}${imp}${use}`), /array\.get: index -1 is outside an array of 3/)
    // non-vacuous: v6 rules over the same code count from the end (the last element is `x`)
    const pasted = runStop(`${V6}${pastedLib}plot(last(close))\n`)
    expect(pasted.stop, pasted.why || (pasted.stop && pasted.stop.message)).toBe(null)
    expect(pasted.cols[0].slice(7)).toEqual(BARS.slice(7).map((b) => b.c))
  })

  it('an `na` index stops as the v5 script stops; pasted into the v6 script it reads `na`', () => {
    const use = 'plot(ir.naindex(close))\n'
    expectSameStop(runStop(`${V6}${imp}${use}`), runStop(`${V5}${imp}${use}`), /array\.get: index NaN is outside an array of 2/)
    const pasted = runStop(`${V6}${pastedLib}plot(naindex(close))\n`)
    expect(pasted.stop, pasted.why || (pasted.stop && pasted.stop.message)).toBe(null)
    expect(pasted.cols[0].slice(0, 7).every((x) => x === 10)).toBe(true)
    expect(pasted.cols[0].slice(7).every((x) => Number.isNaN(x))).toBe(true)
  })

  it('`array.some`, a v6 member, stops in v5 library code as in a v5 script; pasted into the v6 script it answers', () => {
    const use = 'plot(ir.some(close))\n'
    expectSameStop(runStop(`${V6}${imp}${use}`), runStop(`${V5}${imp}${use}`), /`?array\.some`? in a script older than v6/)
    const pasted = runStop(`${V6}${pastedLib}plot(some(close))\n`)
    expect(pasted.stop, pasted.why || (pasted.stop && pasted.stop.message)).toBe(null)
    expect(pasted.cols[0].some((x) => x === 1)).toBe(true)
  })

  it('a bool map\'s missing key: the island answers `na` as the v5 script does (island PR 2: bool na is judged per token); v6 stops by W6-K1', () => {
    const use = 'plot(ir.boolkey(close))\n'
    const island = runStop(`${V6}${imp}${use}`)
    const v5 = runStop(`${V5}${imp}${use}`)
    // the v5 script answers `na` there and runs on (its `?:` over that `na` is not known off the listing)
    expect(v5.stop, v5.why || (v5.stop && v5.stop.message)).toBe(null)
    expect(v5.cols[0].slice(0, 7).every((x) => x === 0 || x === 1), String(v5.cols[0])).toBe(true)
    expect(v5.cols[0].slice(7).every((x) => Number.isNaN(x)), String(v5.cols[0])).toBe(true)
    // ⚰️ island step 2 stopped here by its own name until the island read its bools under v5
    expect(island.stop, island.why || (island.stop && island.stop.message)).toBe(null)
    expect(island.cols).toEqual(v5.cols)
    // ⛔ the `na` never leaves the island: the bool itself handed to v6 code is refused at the call (LV6)
    const out = runStop(`${V6}${imp}plot(ir.boolkeyout(close) ? 1 : 0)\n`)
    expect(out.cols).toBe(null)
    expect(out.b.refusal.guard).toBe(LIBRARY_VERSION)
    expect(out.b.refusal.message).toMatch(/hands this v6 script a value read from a collection that can hold a `bool`.*\(LV6\)/)
    // CONTROL: v6 rules over the same code stop by W6-K1, a different sentence
    const pasted = runStop(`${V6}${pastedLib}plot(boolkey(close))\n`)
    expect(pasted.cols).toBe(null)
    expect(pasted.stop.message).toMatch(/W6-K1/)
    expect(pasted.stop.message).not.toMatch(/Pine v5 library/)
  })

  it('a float map\'s missing key answers `na` in every version: the island equals the v5 script', () => {
    const use = 'plot(ir.floatkey(close))\n'
    const island = runStop(`${V6}${imp}${use}`)
    expect(island.stop, island.why || (island.stop && island.stop.message)).toBe(null)
    const v5 = runStop(`${V5}${imp}${use}`)
    expect(island.cols).toEqual(v5.cols)
    expect(island.cols[0].slice(7).every((x) => Number.isNaN(x))).toBe(true)
  })

  it('the op is judged, not the run: the script\'s own computed negative index still counts from the end beside an island op', () => {
    // the island op runs first on every bar; the VM must give the script its own version back before the next op
    const use = 'plot(ir.head(close))\nb = array.from(1.0, 2.0, close)\nj = -1 * math.round(close / close)\nplot(array.get(b, j))\n'
    const r = runStop(`${V6}${imp}${use}`)
    expect(r.stop, r.why || (r.stop && r.stop.message)).toBe(null)
    expect(r.cols[0]).toEqual(BARS.map((b) => b.c))
    expect(r.cols[1]).toEqual(BARS.map((b) => b.c))
    expect(r.run.budget.opVersion).toBe(undefined)
  })

  it('only a v5 library\'s collection calls carry the mark: a script with no island lowers to the bytes it lowered to before', () => {
    const use = 'plot(ir.last(close))\nplot(ir.floatkey(close))\n'
    const island = runStop(`${V6}${imp}${use}`)
    const marks = valuesOf(island.b.ir, 'islandVersion')
    expect(marks.length).toBeGreaterThan(4)
    expect(new Set(marks)).toEqual(new Set([5]))
    expect(island.p.arrayOps.filter((op) => op.version === 5).length).toBeGreaterThan(4)
    // the same library in a v5 script, and its functions pasted into the v6 script: no mark, two keys per op
    for (const other of [runStop(`${V5}${imp}${use}`), runStop(`${V6}${pastedLib}plot(last(close))\nplot(floatkey(close))\n`)]) {
      expect(other.b.ok, other.why).toBe(true)
      expect(valuesOf(other.b.ir, 'islandVersion')).toEqual([])
      expect(other.p.arrayOps.length).toBeGreaterThan(4)
      for (const op of other.p.arrayOps) expect(Object.keys(op).sort()).toEqual(['fn', 'typeArg'])
    }
  })

  it('the collection rules read the op\'s version before the script\'s, and nothing else', () => {
    const get = ARRAY_FNS['array.get'].fn
    expect(get([[1, 2, 3], -1], { pineVersion: 6 })).toBe(3)
    const v5stop = (() => { try { get([[1, 2, 3], -1], { pineVersion: 5 }) } catch (e) { return e.message } return null })()
    expect(v5stop).toMatch(/index -1 is outside an array of 3/)
    expect(() => get([[1, 2, 3], -1], { pineVersion: 6, opVersion: 5 })).toThrow(v5stop)
    expect(get([[1, 2, 3], -1], { pineVersion: 5, opVersion: 6 })).toBe(3)
  })
})
