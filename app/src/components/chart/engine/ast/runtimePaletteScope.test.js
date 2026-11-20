// app/src/components/chart/engine/ast/runtimePaletteScope.test.js
//
// ─── ⭐⭐ THE RUNTIME LANE OPENS THE PALETTE SCOPE (finding 4, 2026-11-20) ─────────────────────────────────────────
//
// A colour NAME is resolved at the script's own `//@version` (`pine.js` PALETTE_VERSION, `pinePalette.js`: `color.red`
// is #FF5252 at v5 and #F23645 at v6). The host lane's translation opens that scope; the runtime lane's front end
// reaches the same colour helpers through the shared `Resolver` and opened none, so every such read threw: a plain
// `plot(color.r(color.red))` stopped as `runtime:lower` ("a Pine colour name was resolved outside a translation"),
// an engine defect, never a value. Now `buildRuntimeIr` opens the scope at the script's version once it is lexed and
// restores the previous one however the build ends.
//
// What is newly drawn must be what the reference sentence states and what the host lane draws for the same script:
//   · Pine v6 reference, `color.r(color)`: "Retrieves the value of the color's red component." Returns "The value (0
//     to 255) of the color's red component." (`color.g` / `color.b` the same for green / blue);
//   · `color.t(color)`: "Retrieves the color's transparency." Returns "The value (0-100) of the color's transparency
//     component.";
//   · the palette's hex per version is `pinePalette.js` (measured on TradingView captures), never restated here;
//   · the host lane serves these forms from the C38 / C48 captures (`vw-gradient`, `vw-colour-components`), and the
//     runtime lane resolves them through the same `Resolver.colourComponentOf`, so its columns equal the host's.
import { describe, it, expect } from 'vitest'

import { translatePine, beginPaletteScope, endPaletteScope } from './pine.js'
import { interpret } from './interpret.js'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { runtimeClockOpts } from './pineRuntimeClock.js'
import { lowerIrProgram } from '../runtime/lowerIr.js'
import { execute } from '../runtime/vm.js'
import { pineColourHex } from '../pinePalette.js'
import { fixtureLibraries } from './__tests__/libraryFixture.js'
import { LIBRARY_VERSION } from './pineLibraryVersion.js'

const N = 40
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + Math.sin(i), h: 102 + Math.sin(i) + (i % 3), l: 98 - (i % 4),
  c: 100 + Math.cos(i) * 2 + i * 0.1, v: 1000 + i * 7,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = (v) => `//@version=${v}\nindicator("t")\n`
/** The palette's channel at a version (`pinePalette.js` is the one authority on the hex). */
const channel = (name, v, ch) => {
  const hex = pineColourHex(name, v)
  return parseInt(hex.slice({ r: 1, g: 3, b: 5 }[ch], { r: 3, g: 5, b: 7 }[ch]), 16)
}

function runtimeCols(src) {
  const b = buildRuntimeIr(src, { ...runtimeClockOpts(false), bars: BARS, inputs: {} })
  if (!b.ok) return { b, cols: null, why: `${b.refusal.guard}: ${b.refusal.message}` }
  const p = lowerIrProgram(b.ir)
  const { outputs } = execute(p, { bars: N, series: SERIES, columns: p.columns, confirmed: true })
  return { b, cols: outputs.map((o) => Array.from(o)) }
}
function hostCols(src) {
  const t = translatePine(src, { mode: 'host' })
  const cols = (t.outputs || []).filter((o) => o && o.ast && o.kind !== 'alertcondition')
    .map((o) => Array.from(interpret(o.ast, BARS, {})))
  return { t, cols, why: t.refusal ? `${t.refusal.guard}: ${t.refusal.message}` : null }
}
const same = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]))

// [name, body, the value the reference and the palette give, per version]
const CASES = [
  ['color.r of a constant', 'plot(color.r(color.red))\n', (v) => channel('color.red', v, 'r')],
  ['color.g of a constant', 'plot(color.g(color.teal))\n', (v) => channel('color.teal', v, 'g')],
  ['color.b of a constant', 'plot(color.b(color.yellow))\n', (v) => channel('color.yellow', v, 'b')],
  ['color.r of color.new', 'plot(color.r(color.new(color.red, 50)))\n', (v) => channel('color.red', v, 'r')],
  ['color.t of color.new', 'plot(color.t(color.new(color.blue, 30)))\n', () => 30],
  ['color.t of a constant', 'plot(color.t(color.green))\n', () => 0],
  ['color.r of a named variable', 'c = color.red\nplot(color.r(c))\n', (v) => channel('color.red', v, 'r')],
]

describe('⭐⭐ the runtime lane resolves a colour name at the script\'s version (it opened no palette scope: runtime:lower)', () => {
  for (const v of [5, 6]) {
    for (const [name, body, want] of CASES) {
      it(`v${v}, ${name}: drawn, the reference's value, and the host lane's column`, () => {
        const src = `${head(v)}${body}`
        const r = runtimeCols(src)
        expect(r.cols, r.why).not.toBe(null)
        expect(r.cols.length).toBe(1)
        expect(r.cols[0].every((x) => x === want(v)), `${r.cols[0].slice(0, 3)} vs ${want(v)}`).toBe(true)
        const h = hostCols(src)
        expect(h.cols.length, h.why || '').toBe(1)
        expect(same(r.cols[0], h.cols[0]), 'the runtime lane and the host lane draw different columns').toBe(true)
      })
    }
  }

  it('non-vacuous: v5 and v6 give different answers for a colour v6 changed (the version decides, not a default)', () => {
    expect(channel('color.red', 5, 'r')).not.toBe(channel('color.red', 6, 'r'))
    const v5 = runtimeCols(`${head(5)}plot(color.r(color.red))\n`)
    const v6 = runtimeCols(`${head(6)}plot(color.r(color.red))\n`)
    expect(v5.cols[0][0]).toBe(channel('color.red', 5, 'r'))
    expect(v6.cols[0][0]).toBe(channel('color.red', 6, 'r'))
  })

  it('a colour per bar (a ternary of two colours) is served on both lanes, column for column', () => {
    const src = `${head(6)}c = close > open ? color.red : color.teal\nplot(color.r(c))\nplot(color.g(c))\n`
    const r = runtimeCols(src)
    const h = hostCols(src)
    expect(r.cols, r.why).not.toBe(null)
    expect(h.cols.length, h.why || '').toBe(2)
    r.cols.forEach((col, i) => expect(same(col, h.cols[i]), `column ${i}`).toBe(true))
    expect(new Set(r.cols[0]).size).toBe(2)
  })

  it('the scope is the build\'s alone: none before, none after, and an outer one is given back, refused or not', () => {
    const probe = () => { const now = beginPaletteScope(1); endPaletteScope(now); return now }
    expect(typeof probe()).toBe('symbol')     // no scope open
    runtimeCols(`${head(6)}plot(color.r(color.red))\n`)
    expect(typeof probe()).toBe('symbol')
    const outer = beginPaletteScope(4)
    try {
      runtimeCols(`${head(6)}plot(color.r(color.red))\n`)
      expect(probe()).toBe(4)
      const refused = runtimeCols(`${head(6)}plot(nosuchfunction(close))\n`)
      expect(refused.cols).toBe(null)
      expect(probe()).toBe(4)
    } finally {
      endPaletteScope(outer)
    }
    expect(typeof probe()).toBe('symbol')
  })
})

// ─── ⭐⭐ AND INSIDE THE VERSION ISLAND (#2106): a v5 library's colour name is resolved at v5 ────────────────────────
// With the scope open, the runtime lane resolves a colour component through `pine.js::colourHexOf`, which reads the
// version of the code that writes the name (`versionAt`). A v5 library's `color.r(color.red)` inside a v6 script is
// therefore v5's #FF5252, exactly what the same library computes inside a v5 script; read at the program's palette it
// would be v6's #F23645 (before the scope it stopped as runtime:lower).
const MPL = '// This Pine Script code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/'
const PALETTE_LIB = `${MPL}
//@version=5
library("palettelib")
export red(float x) => color.r(color.red) + x * 0
export teal(float x) => color.g(color.teal) + x * 0
`
const LIBS = fixtureLibraries({ 'tester/palettelib/1': { path: 'tester/palettelib/1', source: PALETTE_LIB, licence: 'MPL-2.0', attribution: 'palettelib (test fixture)' } })
const ADMIT = { admit: [{ path: 'tester/palettelib/1' }] }
function islandCols(src) {
  const b = buildRuntimeIr(src, { ...runtimeClockOpts(false), bars: BARS, inputs: {}, libraries: LIBS, libraryCrossVersion: ADMIT })
  if (!b.ok) return { b, cols: null, why: `${b.refusal.guard}: ${b.refusal.message}` }
  const p = lowerIrProgram(b.ir)
  const { outputs } = execute(p, { bars: N, series: SERIES, columns: p.columns, confirmed: true })
  return { b, cols: outputs.map((o) => Array.from(o)) }
}

describe('⭐⭐ the palette scope inside the version island: a v5 library\'s colour component is v5\'s', () => {
  const use = 'import tester/palettelib/1 as pl\nplot(pl.red(close))\nplot(pl.teal(close))\n'
  it('a v5 library in a v6 script draws the v5 palette\'s components, the same library in a v5 script\'s columns', () => {
    const inV6 = islandCols(`${head(6)}${use}`)
    const inV5 = islandCols(`${head(5)}${use}`)
    expect(inV6.cols, inV6.why).not.toBe(null)
    expect(inV5.cols, inV5.why).not.toBe(null)
    expect(inV6.cols[0].every((x) => x === channel('color.red', 5, 'r'))).toBe(true)
    expect(inV6.cols[1].every((x) => x === channel('color.teal', 5, 'g'))).toBe(true)
    inV6.cols.forEach((col, i) => expect(same(col, inV5.cols[i]), `column ${i}`).toBe(true))
    // non-vacuous: the same functions pasted into the v6 script draw v6's components
    const pastedFns = PALETTE_LIB.split('\n').slice(3).join('\n').replace(/^export /gm, '')
    const pasted = runtimeCols(`${head(6)}${pastedFns}plot(red(close))\nplot(teal(close))\n`)
    expect(pasted.cols, pasted.why).not.toBe(null)
    expect(pasted.cols[0][0]).toBe(channel('color.red', 6, 'r'))
    expect(pasted.cols[0][0]).not.toBe(inV6.cols[0][0])
    // the host lane does not judge per token: it refuses the import by name
    const t = translatePine(`${head(6)}${use}`, { libraries: LIBS, libraryCrossVersion: ADMIT, mode: 'host' })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe(LIBRARY_VERSION)
  })
})
