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
import {
  crossVersionDifference, crossVersionAdmitted, admissionTableOf, LIBRARY_VERSION, versionAt, stampLibraryVersion,
  ISLAND_FAMILY, RUNTIME_ISLAND_FAMILIES,
} from './pineLibraryVersion.js'
import { linkLibraries } from './pineLibraries.js'
import COMMITTED_ADMISSION from './pineLibraryCrossVersion.json'
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
  ['label.new without textcolor', '    label.new(bar_index, x, "a")\n    x', /`label\.new` without `textcolor`/, null],
  ['a for bound that calls something', '    float t = 0.0\n    for i = 0 to math.round(x) % 3\n        t := t + 1\n    t', /`for` loop whose end bound calls `math\.round`/, F.FOR_BOUND],
  ['a for bound the loop reassigns', '    int n = 3\n    float t = 0.0\n    for i = 0 to n\n        n := n - 1\n        t := t + 1\n    t', /`for` loop whose end bound reads `n`/, F.FOR_BOUND],
  ['a const int division', '    int k = 5\n    x + k / 2', /division of two values that may be `const int`/, null],
  ['a request', '    request.security(syminfo.tickerid, "D", x)', /`request\.security`/, null],
  ['na() of a value not shown to be a number', '    b = x > 0\n    na(b) ? 1.0 : x', /`na\(\)` of a value not shown to be a number/, F.BOOL_NA],
  ['history of a bool', '    b = x > 0\n    b[1] ? 1.0 : x', /history of the bool `b`/, F.BOOL_NA],
  ['a condition not shown to be a bool', '    y = x * 2\n    y ? 1.0 : 0.0', /condition not shown to be a bool/, F.IMPLICIT_CAST],
  ['an if value without else', '    bool b = if x > 0\n        true\n    b ? 1.0 : 0.0', /`if` used as a value without `else`/, F.BOOL_NA],
  ['history of a literal', '    x + 5[1]', /history of a literal or of a field/, null],
  ['a negative literal index', '    a = array.from(1.0, 2.0)\n    array.get(a, -1) + x', /negative index/, null],
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
`,
    uses: 'plot(il.daily(close))\nplot(il.counted(close))\n',
  },
}
const islandPath = (family) => `tester/island${family.replace(/[^a-z]/gi, '')}/1`
const islandSource = (family) => `${MPL}\n//@version=5\nlibrary("island")\n${ISLAND[family].lib}`
const LIBS = fixtureLibraries({
  ...Object.fromEntries(Object.keys(ISLAND).map((f) => [islandPath(f), {
    path: islandPath(f), source: islandSource(f), licence: 'MPL-2.0', attribution: 'island (test fixture)',
  }])),
  'tester/cleanlib/1':{ path: 'tester/cleanlib/1', source: CLEAN, licence: 'MPL-2.0', attribution: 'cleanlib (test fixture)' },
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
    expect(Object.keys(ISLAND).sort()).toEqual([...RUNTIME_ISLAND_FAMILIES].sort())
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
