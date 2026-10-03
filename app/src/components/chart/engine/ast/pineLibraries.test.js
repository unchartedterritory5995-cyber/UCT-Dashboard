// app/src/components/chart/engine/ast/pineLibraries.test.js
//
// ─── ⭐⭐ L1 — AN IMPORTED LIBRARY FUNCTION IS THE SCRIPT'S OWN FUNCTION ────────
//
// The proof the brief asks for: a script calling `mylib.f(x)` equals the same
// script with `f` pasted in, BAR FOR BAR, in BOTH lanes (the host translator's
// trees run through `interpret`, and the runtime lane's IR lowered and executed).
//
// ⛔ EVERY LIBRARY HERE IS A FIXTURE WRITTEN FROM SCRATCH FOR THIS FILE. No
// third-party library source is in this repository (`pineLibraryStore.js`).
import { describe, it, expect, afterEach } from 'vitest'

import { translatePine } from './pine.js'
import { interpret } from './interpret.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { runtimeClockOpts } from './pineRuntimeClock.js'
import { lowerIrProgram } from '../runtime/lowerIr.js'
import { execute } from '../runtime/vm.js'
import {
  registerPineLibrary, clearPineLibraries, pineLibraryEntry, ensurePineLibraries, importPathsOf,
} from './pineLibraryStore.js'

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
const HEAD = '//@version=5\nindicator("t", overlay=true)\n'

// ── fixture libraries (written for this file) ────────────────────────────────
const LIB_V1 = `${MPL}
//@version=5
library("fixturelib")
FACTOR = 2.0
spread(float a, float b) => a - b
export mid(float h, float l) => (h + l) / FACTOR
export band(float src, int len) => ta.sma(src, len) + spread(high, low)
export type Pair
    float a
    float b
export method total(Pair p) => p.a + p.b
plot(mid(high, low))
`
// v2 is DIFFERENT CODE under the same name: another factor, another band.
const LIB_V2 = LIB_V1.replace('FACTOR = 2.0', 'FACTOR = 4.0').replace('ta.sma(src, len)', 'ta.ema(src, len)')
// a library that imports another
const LIB_OUTER = `${MPL}
//@version=5
library("outer")
import tester/fixturelib/1 as inner
export twice(float h, float l) => inner.mid(h, l) * 2
`
const LIB_V6 = `${MPL}
//@version=6
library("modern")
export one() => 1
`
// a parameter with the name of a top-level value: inside `f` it is the parameter
const LIB_SHADOW = `${MPL}
//@version=5
library("shadow")
source = close
export f(float source) => source * 2
export g() => source + 1
export h(float source = 0.0) => source + 1
export type Holder
    float source
export method doubled(Holder h) => h.source * 2
`
// a block local with a top-level value's name, while the top-level value is read
// after the block: positional scoping cannot tell, so it is refused
const LIB_BLOCK_SHADOW = `${MPL}
//@version=5
library("blockshadow")
LEVEL = 3.0
export f(float x) =>
    y = x + LEVEL
    if x > 100
        LEVEL = x * 2
        y := y + LEVEL
    y + LEVEL
`
const LIB_REFUSES = `${MPL}
//@version=5
library("refuses")
export g(float x) => request.security(syminfo.tickerid, timeframe.period + "x", x)
`
const LIBS = {
  'tester/fixturelib/1': { path: 'tester/fixturelib/1', source: LIB_V1, licence: 'MPL-2.0', attribution: 'fixturelib v1 (test fixture)' },
  'tester/fixturelib/2': { path: 'tester/fixturelib/2', source: LIB_V2, licence: 'MPL-2.0', attribution: 'fixturelib v2 (test fixture)' },
  'tester/outer/1': { path: 'tester/outer/1', source: LIB_OUTER, licence: 'MPL-2.0', attribution: 'outer (test fixture)' },
  'tester/modern/1': { path: 'tester/modern/1', source: LIB_V6, licence: 'MPL-2.0', attribution: 'modern (test fixture)' },
  'tester/shadow/1': { path: 'tester/shadow/1', source: LIB_SHADOW, licence: 'MPL-2.0', attribution: 'shadow (test fixture)' },
  'tester/blockshadow/1': { path: 'tester/blockshadow/1', source: LIB_BLOCK_SHADOW, licence: 'MPL-2.0', attribution: 'blockshadow (test fixture)' },
  'tester/refuses/1': { path: 'tester/refuses/1', source: LIB_REFUSES, licence: 'MPL-2.0', attribution: 'refuses (test fixture)' },
}

// ── the two lanes, run to numbers ────────────────────────────────────────────
const same = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
function hostRun(src, libraries = LIBS) {
  const t = translatePine(src, { libraries, mode: 'host' })
  const cols = (t.outputs || []).filter((o) => o && o.ast && o.kind !== 'alertcondition')
    .map((o) => Array.from(interpret(o.ast, BARS, {})))
  return { t, cols, why: t.refusal ? `${t.refusal.guard}: ${t.refusal.message}` : null }
}
function runtimeRun(src, libraries = LIBS) {
  const b = buildRuntimeIr(src, { ...runtimeClockOpts(false), bars: BARS, inputs: {}, libraries })
  if (!b.ok) return { b, cols: null, why: `${b.refusal.guard}: ${b.refusal.message}` }
  const p = lowerIrProgram(b.ir)
  const { outputs } = execute(p, { bars: N, series: SERIES, columns: p.columns, confirmed: true })
  return { b, cols: outputs.map((o) => Array.from(o)) }
}
function expectSameColumns(ra, rb) {
  expect(ra.cols, `linked side refused — ${ra.why}`).not.toBe(null)
  expect(rb.cols, `pasted side refused — ${rb.why}`).not.toBe(null)
  const a = ra.cols
  const b = rb.cols
  expect(a.length, ra.why || '').toBeGreaterThan(0) // non-vacuity: something was computed
  expect(a.length).toBe(b.length)
  a.forEach((col, i) => {
    expect(col.length).toBe(N)
    expect(col.some((x) => Number.isFinite(x))).toBe(true)
    expect(same(col, b[i]), `column ${i} differs`).toBe(true)
  })
}

const LINKED = `${HEAD}import tester/fixturelib/1 as fx
plot(fx.mid(high, low))
plot(fx.band(close, 5))
`
const PASTED = `${HEAD}FACTOR = 2.0
spread(float a, float b) => a - b
mid(float h, float l) => (h + l) / FACTOR
band(float src, int len) => ta.sma(src, len) + spread(high, low)
plot(mid(high, low))
plot(band(close, 5))
`

describe('⭐⭐ a library function equals the same function pasted in, bar for bar', () => {
  it('host lane', () => {
    const linked = hostRun(LINKED)
    const pasted = hostRun(PASTED)
    expect(pasted.cols.length, 'control: the pasted script translates').toBe(2)
    expectSameColumns(linked, pasted)
    // the library's own demo `plot` never runs in the importing script
    expect(linked.cols.length).toBe(2)
  })

  it('runtime lane', () => {
    const linked = runtimeRun(LINKED)
    const pasted = runtimeRun(PASTED)
    expect(pasted.b.ok, pasted.b.refusal && pasted.b.refusal.message).toBe(true)
    expect(linked.b.ok, linked.b.refusal && linked.b.refusal.message).toBe(true)
    expectSameColumns(linked, pasted)
  })

  it('⛔ CONTROL — without the library the same script is REFUSED (the equality is the link, not a coincidence)', () => {
    const h = hostRun(LINKED, {})
    expect(h.cols.length).toBe(0)
    const r = runtimeRun(LINKED, {})
    expect(r.b.ok).toBe(false)
  })

  it("the library's names never capture the script's own (a script `mid` and `FACTOR` of its own)", () => {
    const own = `${HEAD}FACTOR = 10.0
mid(float a, float b) => a * b
import tester/fixturelib/1 as fx
plot(fx.mid(high, low))
plot(mid(high, low) / FACTOR)
`
    const pastedRenamed = `${HEAD}FACTOR = 10.0
mid(float a, float b) => a * b
LFACTOR = 2.0
lmid(float h, float l) => (h + l) / LFACTOR
plot(lmid(high, low))
plot(mid(high, low) / FACTOR)
`
    expectSameColumns(hostRun(own), hostRun(pastedRenamed))
    expectSameColumns(runtimeRun(own), runtimeRun(pastedRenamed))
  })

  it("a parameter named like a top-level value is the PARAMETER inside its function", () => {
    const linked = `${HEAD}import tester/shadow/1 as s
plot(s.f(high))
plot(s.g())
plot(s.h(high))
`
    const pasted = `${HEAD}gsource = close
f(float source) => source * 2
g() => gsource + 1
`
      + `h(float source = 0.0) => source + 1
plot(f(high))
plot(g())
plot(h(high))
`
    // a DEFAULT on the parameter (`= 0.0`): the host lane reads it; the runtime lane
    // refuses defaults by name (its own wall, linked or pasted alike)
    expectSameColumns(hostRun(linked), hostRun(pasted))
    const rLinked = linked.replace('plot(s.h(high))\n', '')
    const rPasted = pasted.replace('plot(h(high))\n', '')
    expectSameColumns(runtimeRun(rLinked), runtimeRun(rPasted))
    // the same wall, named the same way, and placed on the member's import line
    expect(runtimeRun(linked).why)
      .toBe(`${runtimeRun(pasted).why} — in the imported library \`tester/shadow/1\`, line 7`)
  })

  it("a type FIELD named like a top-level value is the field (runtime lane)", () => {
    const linked = `${HEAD}import tester/shadow/1 as s
h = s.Holder.new(high)
plot(h.doubled() + s.g())
`
    const pasted = `${HEAD}gsource = close
g() => gsource + 1
type Holder
    float source
method doubled(Holder h) => h.source * 2
h = Holder.new(high)
plot(h.doubled() + g())
`
    const p = runtimeRun(pasted)
    expect(p.b.ok, p.b.refusal && p.b.refusal.message).toBe(true)
    expectSameColumns(runtimeRun(linked), p)
  })

  it('a library type and its method (runtime lane)', () => {
    const linked = runtimeRun(`${HEAD}import tester/fixturelib/1 as fx
p = fx.Pair.new(high, low)
plot(p.total())
`)
    const pasted = runtimeRun(`${HEAD}type Pair
    float a
    float b
method total(Pair p) => p.a + p.b
p = Pair.new(high, low)
plot(p.total())
`)
    expect(pasted.b.ok, pasted.b.refusal && pasted.b.refusal.message).toBe(true)
    expectSameColumns(linked, pasted)
  })

  it('a library that imports another library', () => {
    const linked = `${HEAD}import tester/outer/1 as o
plot(o.twice(high, low))
`
    const pasted = `${HEAD}FACTOR = 2.0
mid(float h, float l) => (h + l) / FACTOR
twice(float h, float l) => mid(h, l) * 2
plot(twice(high, low))
`
    expectSameColumns(hostRun(linked), hostRun(pasted))
    expectSameColumns(runtimeRun(linked), runtimeRun(pasted))
  })
})

describe('⛔ a VERSION is different code', () => {
  it('`/2` runs v2, not v1, in both lanes', () => {
    const v2 = `${HEAD}import tester/fixturelib/2 as fx
plot(fx.mid(high, low))
plot(fx.band(close, 5))
`
    const pastedV2 = PASTED.replace('FACTOR = 2.0', 'FACTOR = 4.0').replace('ta.sma(src, len)', 'ta.ema(src, len)')
    expectSameColumns(hostRun(v2), hostRun(pastedV2))
    expectSameColumns(runtimeRun(v2), runtimeRun(pastedV2))
    // and it is not v1's answer
    expect(same(hostRun(v2).cols[0], hostRun(LINKED).cols[0])).toBe(false)
  })

  it('a version the registry does not hold is refused, never substituted', () => {
    const src = `${HEAD}import tester/fixturelib/3 as fx\nplot(fx.mid(high, low))\n`
    const t = translatePine(src, { libraries: LIBS, mode: 'host' })
    expect(t.refusal.guard).toBe('pine:module')
    expect(t.refusal.message).toContain('`tester/fixturelib/3` is not in this engine\'s library registry')
  })
})

describe('⛔ refused BY NAME, with the import line', () => {
  const MISSING = `${HEAD}import nobody/nothing/4 as nn\nplot(nn.f(close))\n`

  it('an unknown library — both lanes name it, and the guards are unchanged', () => {
    const t = translatePine(MISSING, { libraries: LIBS, mode: 'host' })
    expect(t.refusal.guard).toBe('pine:module')
    expect(t.refusal.message).toMatch(/`nobody\/nothing\/4` is not in this engine's library registry/)
    expect(t.refusal.line).toBe(3)
    const b = buildRuntimeIr(MISSING, { ...runtimeClockOpts(false), inputs: {}, libraries: LIBS })
    expect(b.refusal.guard).toBe('runtime:library')
    expect(b.refusal.message).toContain('`import nobody/nothing/4 as nn`')
    expect(b.refusal.message).toContain('`nobody/nothing/4` is not in this engine\'s library registry')
  })

  it('a library in another Pine version than the script', () => {
    const t = translatePine(`${HEAD}import tester/modern/1 as m\nplot(m.one())\n`, { libraries: LIBS, mode: 'host' })
    expect(t.refusal.guard).toBe('pine:module')
    expect(t.refusal.message).toMatch(/written in Pine v6 and this script in v5/)
  })

  it('a block local with a top-level name, read again after the block', () => {
    const t = translatePine(`${HEAD}import tester/blockshadow/1 as s
plot(s.f(close))
`, { libraries: LIBS, mode: 'host' })
    expect(t.refusal.guard).toBe('pine:module')
    expect(t.refusal.message).toMatch(/declares `LEVEL` inside a block of `f`/)
  })

  it('a name the library does not EXPORT is not served', () => {
    const src = `${HEAD}import tester/fixturelib/1 as fx\nplot(fx.spread(high, low))\n`
    expect(hostRun(src).cols.length).toBe(0)
    expect(runtimeRun(src).b.ok).toBe(false)
  })

  it("a refusal inside the library's code points at the member's import line and names the library", () => {
    const src = `${HEAD}import tester/refuses/1 as r\nplot(r.g(close))\n`
    const b = buildRuntimeIr(src, { ...runtimeClockOpts(false), inputs: {}, libraries: LIBS })
    expect(b.ok).toBe(false)
    expect(b.refusal.line).toBe(3)
    expect(b.refusal.message).toMatch(/in the imported library `tester\/refuses\/1`, line 4/)
    expect(b.refusal.message).not.toMatch(/__lib\d/)
  })
})

describe('what the member is shown, and what does not move', () => {
  it('the linked libraries ride the result with their licence and attribution', () => {
    const t = translatePine(LINKED, { libraries: LIBS, mode: 'host' })
    expect(t.libraries).toEqual([{
      path: 'tester/fixturelib/1', alias: 'fx', licence: 'MPL-2.0',
      attribution: 'fixturelib v1 (test fixture)', url: null,
    }])
    const plain = translatePine(PASTED, { mode: 'host' })
    expect('libraries' in plain).toBe(false)
  })

  it("an input's parameter id is the input's place in the MEMBER's source, library or not", () => {
    // ⭐ the library adds no input call and is spliced AFTER the input here, so the
    // linked script mints exactly what the script with the function pasted in does.
    const linked = `${HEAD}len = input.int(5, "Len")
import tester/fixturelib/1 as fx
plot(fx.band(close, len))
`
    const pasted = `${HEAD}len = input.int(5, "Len")
FACTOR = 2.0
spread(float a, float b) => a - b
band(float src, int len) => ta.sma(src, len) + spread(high, low)
plot(band(close, len))
`
    const ids = (src) => (translatePine(src, { libraries: LIBS, mode: 'host', paramManifest: true }).inputParams || [])
      .map((p) => p.id)
    expect(ids(pasted)).toEqual(['__uct_param_1001'])
    expect(ids(linked)).toEqual(ids(pasted))
  })
})

describe('the client-side registry', () => {
  afterEach(() => clearPineLibraries())

  it('serves a registered library to a translation that is handed none', () => {
    expect(registerPineLibrary(LIBS['tester/fixturelib/1'])).not.toBe(null)
    const t = translatePine(LINKED, { mode: 'host' })
    expect(t.libraries && t.libraries[0].path).toBe('tester/fixturelib/1')
  })

  it('refuses an entry without a licence or a valid path', () => {
    expect(registerPineLibrary({ ...LIBS['tester/fixturelib/1'], licence: '' })).toBe(null)
    expect(registerPineLibrary({ ...LIBS['tester/fixturelib/1'], path: '../x/1' })).toBe(null)
    expect(pineLibraryEntry('tester/fixturelib/1')).toBe(null)
  })

  it('fetches what a script imports — and what those import — from the store', async () => {
    const asked = []
    const fetchImpl = async (url) => {
      asked.push(url)
      const path = url.replace('/api/pine/libraries/', '')
      return LIBS[path] ? { ok: true, json: async () => LIBS[path] } : { ok: false }
    }
    const res = await ensurePineLibraries(`${HEAD}import tester/outer/1 as o\nimport nobody/nothing/4\n`, { fetchImpl })
    expect(res.loaded.sort()).toEqual(['tester/fixturelib/1', 'tester/outer/1'])
    expect(res.missing).toEqual(['nobody/nothing/4'])
    expect(asked).toContain('/api/pine/libraries/tester/fixturelib/1')
    expect(importPathsOf('//@version=5\nimport a/b/1\n  import c/d/2\n')).toEqual(['a/b/1'])
  })
})
