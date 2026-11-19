// app/src/components/chart/engine/runtime/__tests__/tcTextColour.test.js
//
// ─── TC (text-colour coverage unit, 2026-11-16) — COLOUR KINDS AND TICK TEXT ON THE RUNTIME LANE ─
//
// What this lane now serves, each on the sentence or witness named beside it:
//
//   · a parameter DECLARED `color` holds a colour (Pine v6 User Manual, User-defined functions >
//     Declaring parameter types > Type keywords: "If a parameter declaration includes a type
//     keyword, it accepts only arguments of that type, or arguments that Pine can automatically
//     cast to that type."), and a script's own `method` called in the dotted form is the call it
//     rewrites to (`coloring.transp(80)`);
//   · an UNTYPED parameter holds a colour in the copy compiled for a call site whose argument IS
//     one (same section: "In each separate call to the function, the parameter automatically
//     inherits the same type as its specified argument.");
//   · `==` / `!=` between two colours, a colour's past (`c[1]`), and v4's `iff` with colour arms
//     (Pine reference v4/v5: `==` "Equal to. Applicable to expressions of any type.", `[]`
//     "Series subscript. Provides access to previous values of series expr1", `iff` "does exactly
//     the same thing as ternary conditional operator ?:");
//   · `str.tostring(x, format.mintick)` at the binding's witnessed tick, through the host lane's one
//     tick formatter (CBC-FMT S10 T08-T12), and a literal pattern with text around it.
//
// ⛔ And what it still refuses BY NAME: a colour against the literal `na` (probe
// `vw-tc1-colour-na-compare`), a colour beside any other operator, a colour against a number, an
// untyped parameter whose call site passes a price, a tick no binding settles, a `%` pattern.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { colourHexByName, translatePine } from '../../ast/pine.js'
import { interpret } from '../../ast/interpret.js'
import { hexToPacked, objectHexToPacked } from '../colours.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { tickNumberText, tickNumberWhy } from '../../pineTextFormat.js'

// open and close cross, so a conditional colour is not one colour repeated
const BARS = [
  { t: 1700000000, o: 100, h: 105, l: 99, c: 103, v: 10 },   // up
  { t: 1700086400, o: 104, h: 106, l: 100, c: 101, v: 11 },  // down
  { t: 1700172800, o: 101, h: 108, l: 100, c: 107, v: 12 },  // up
  { t: 1700259200, o: 107, h: 109, l: 102, c: 104, v: 13 },  // down
]
const N = BARS.length
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const RDDT = Object.freeze({ ticker: 'RDDT', exchange: 'NYSE' })

function build(src, opts = {}) {
  return buildRuntimeIr(src, { bars: BARS, inputs: {}, ...opts })
}
function run(src, opts = {}) {
  const built = build(src, opts)
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const res = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true, barTimes: BARS.map((b) => b.t),
  })
  return program.outputs.map((o, i) => ({ call: o.call, values: Array.from(res.outputs[i]) }))
}
const refusalOf = (src, opts = {}) => {
  const built = build(src, opts)
  expect(built.ok, 'expected a refusal, got a program').toBe(false)
  return built.refusal
}
const packed = (name, version, t) => hexToPacked(colourHexByName(name, version), t)
const words = (vals) => vals.map((v) => (Number.isNaN(v) ? NaN : v >>> 0))

describe('⭐ a parameter declared `color`, and a method called in the dotted form', () => {
  const SRC = [
    '//@version=6', 'indicator("t")',
    'method transp(color x, int t) =>', '    color.new(x, t)',
    'var color coloring = na',
    'coloring := close > open ? color.green : color.red',
    'bgcolor(close > open ? coloring.transp(80) : na)',
    'plot(close)',
  ].join('\n')
  it('compiles and paints `color.new(coloring, 80)` on the up bars, `na` elsewhere', () => {
    const [bg] = run(SRC)
    expect(bg.call).toBe('bgcolor')
    const g = packed('color.green', 6, 80)
    expect(words(bg.values)).toEqual([g, NaN, g, NaN])
  })
  it('⛔ CONTROL: a receiver declared `float` is no colour, and `bgcolor` refuses it by name', () => {
    const src = SRC.replace('method transp(color x, int t) =>', 'method transp(float x, int t) =>')
      .replace('    color.new(x, t)', '    x + t')
      .replace('coloring.transp(80)', 'close.transp(80)')
    expect(refusalOf(src).guard).toBe('runtime:colour')
  })
})

describe('⭐ an untyped parameter takes the type of its argument, per call site', () => {
  const HEAD = '//@version=4\nstudy("t")\nf_c(_c, _t) =>\n    color.new(_c, _t)\n'
  it('two call sites, two colours, each the call\'s own', () => {
    const out = run(`${HEAD}c1 = f_c(color.green, 50)\nbgcolor(c1)\nbgcolor(f_c(color.red, 20))\nplot(close)\n`)
    expect(words(out[0].values)).toEqual(Array(N).fill(packed('color.green', 4, 50)))
    expect(words(out[1].values)).toEqual(Array(N).fill(packed('color.red', 4, 20)))
  })
  it('a helper whose value is a `var color` it reassigns is a colour (the name is typed `color`)', () => {
    const src = '//@version=4\nstudy("t")\nf_c(_c, _t) =>\n    var color _r = na\n    _r := color.new(_c, _t)\n'
      + 'bgcolor(f_c(color.red, 20))\nplot(close)\n'
    expect(words(run(src)[0].values)).toEqual(Array(N).fill(packed('color.red', 4, 20)))
  })
  it('a colour helper in one arm of `?:` is pointwise (no history is held for its body)', () => {
    const src = '//@version=5\nindicator("t")\nf(c, t) =>\n    color.new(c, t)\n'
      + 'bgcolor(close > open ? f(color.red, 90) : na)\nplot(close)\n'
    const r = packed('color.red', 5, 90)
    expect(words(run(src)[0].values)).toEqual([r, NaN, r, NaN])
  })
  it('⛔ CONTROL: the same helper handed a PRICE stays refused (`runtime:colour`)', () => {
    expect(refusalOf(`${HEAD}bgcolor(f_c(close, 90))\n`).guard).toBe('runtime:colour')
  })
})

describe('⭐ colours compared, and a colour\'s past', () => {
  const SRC = [
    '//@version=4', 'study("t")',
    'bcolor = iff(close > open, iff(close > close[1], color.lime, color.green), color.red)',
    'scolor = close > open ? color.blue : color.aqua',
    'plot(scolor[1] == color.aqua ? 1 : 0)',
    'plot(bcolor[1] != bcolor[0] ? 1 : 0)',
    'plot(scolor == color.aqua and bcolor == color.red ? 1 : 0)',
  ].join('\n')
  it('`==` / `!=`, `[1]` and `iff` over colours answer bar by bar (`na` before bar 0 reads false)', () => {
    const out = run(SRC)
    // scolor: blue aqua blue aqua; bcolor: green (close[1] is na on bar 0) red lime red
    expect(out[0].values).toEqual([0, 0, 1, 0])
    expect(out[1].values).toEqual([0, 1, 1, 1])
    expect(out[2].values).toEqual([0, 1, 0, 1])
  })
  // ⚰️ THIS ASSERTED THE v4 FORM REFUSED until probe vw-tc1-colour-na-compare was captured. It is
  // (RDDT 1D, 2026-11-16: `c != na` and `c == na` read 0 on every bar, as a number's do), and since
  // engine NUMBER PENDING (CO-1, `colourNaCompareV4.test.js`) v4 is served. Every other version keeps
  // the refusal by name.
  it('a v4 colour against the literal `na` reads false on every bar; any other version is refused by name', () => {
    const out = run('//@version=4\nstudy("t")\nc = close > open ? color.yellow : na\nplot(c != na ? 1 : 0)\nplot(c == na ? 1 : 0)\n')
    expect(out[0].values).toEqual([0, 0, 0, 0])
    expect(out[1].values).toEqual([0, 0, 0, 0])
    const r = refusalOf('//@version=5\nindicator("t")\nc = close > open ? color.yellow : na\nplot(c != na ? 1 : 0)\n')
    expect(r.guard).toBe('runtime:colour')
    expect(r.message).toMatch(/compared with `na`/)
    expect(r.message).toMatch(/vw-tc1-colour-na-compare/)
  })
  it('a colour written with a WHOLE transparency compares; a fractional one is refused by name (rows E1-E2)', () => {
    const head = '//@version=5\nindicator("t")\n'
    const whole = run(`${head}a = color.new(color.red, 50)\nb = close > open ? color.new(color.red, 50) : color.blue\nplot(a == b ? 1 : 0)\n`)
    expect(whole[0].values).toEqual([1, 0, 1, 0])
    const r = refusalOf(`${head}a = color.new(color.red, 50.1)\nb = color.new(color.red, 50.2)\nplot(a == b ? 1 : 0)\n`)
    expect(r.guard).toBe('runtime:colour')
    expect(r.message).toMatch(/not a whole number/)
  })
  it('⛔ any other operator over a colour, and a colour against a number, are refused by name', () => {
    const head = '//@version=5\nindicator("t")\nc = close > open ? color.red : color.blue\n'
    expect(refusalOf(`${head}plot(c > color.red ? 1 : 0)\n`).message).toMatch(/compares colours with `==` and `!=` only/)
    expect(refusalOf(`${head}plot(c == 5 ? 1 : 0)\n`).message).toMatch(/between a colour and a value/)
  })
})

describe('⭐⭐ graph-vs-runtime differential: a paint colour BOTH lanes serve is the same colour on every bar', () => {
  // The host lane carries a paint as a palette + an index tree, or `colorUp` / `colorDown` + a condition tree;
  // the index / condition is evaluated here by the columnar interpreter on the same bars, and each bar's host
  // colour is packed the way the runtime packs one (`#RRGGBBAA` through `objectHexToPacked`, a 6-digit hex at
  // its transparency through `hexToPacked`), then compared WORD FOR WORD with the run's own column.
  const hostWords = (src) => {
    const [p] = (translatePine(src, { strict: true }).presentation || {}).paints || []
    expect(p && !p.withheld, JSON.stringify(p)).toBe(true)
    const word = (hex, opacity) => {
      if (/^rgba\(0, 0, 0, 0\)$/.test(hex)) return NaN
      if (/^#[0-9a-f]{8}$/i.test(hex)) return objectHexToPacked(hex)
      return hexToPacked(hex, Math.round((1 - (opacity === undefined ? 1 : opacity)) * 100))
    }
    if (p.colorPalette) {
      const idx = Array.from(interpret(p.colorIndex.ast, BARS, {}))
      return idx.map((k) => word(p.colorPalette[k], p.opacity))
    }
    const cond = Array.from(interpret(p.colorCondition.ast, BARS, {}))
    return cond.map((c) => word(c ? p.colorUp : p.colorDown, p.opacity))
  }
  const SHAPES = [
    // R35c's helper fold on the host, the colour specialisation (untyped parameter) on the run
    ['a colour helper over an untyped parameter', '//@version=5\nindicator("t", overlay=true)\nf(c, t) =>\n    color.new(c, t)\nplot(close)\nbgcolor(close > open ? f(color.red, 90) : na)\n'],
    ['two `color.new` arms', '//@version=5\nindicator("t", overlay=true)\nplot(close)\nbgcolor(close > open ? color.new(color.green, 80) : color.new(color.red, 70))\n'],
    ['a v6 palette constant at a literal transparency', '//@version=6\nindicator("t", overlay=true)\nplot(close)\nbgcolor(close > open ? color.new(color.yellow, 40) : color.new(color.teal, 60))\n'],
  ]
  for (const [label, src] of SHAPES) {
    it(`⭐ ${label}`, () => {
      const host = hostWords(src)
      const bg = run(src).find((o) => o.call === 'bgcolor')
      expect(words(bg.values)).toEqual(host.map((w) => (Number.isNaN(w) ? NaN : w >>> 0)))
    })
  }
})

describe('⭐ the colour constants follow the script\'s version (Pine v6 migration guide, Color changes)', () => {
  // "The color values behind some of the `color.*` constants have changed in Pine v6 to better
  //  reflect the TradingView palette": color.red #FF5252 → #F23645, color.teal #00897B → #089981,
  //  color.yellow #FFEB3B → #FDD835 (and the capture readings: red r = 242, yellow g = 216 in v6).
  it('v5 red / yellow / teal, v6 red / yellow / teal, packed from each version\'s own palette', () => {
    for (const [v, red, yellow, teal] of [[5, 0xff5252, 0xffeb3b, 0x00897b], [6, 0xf23645, 0xfdd835, 0x089981]]) {
      const head = v === 5 ? '//@version=5\nindicator("t")\n' : '//@version=6\nindicator("t")\n'
      const out = run(`${head}bgcolor(color.red)\nbgcolor(color.yellow)\nbgcolor(color.teal)\nplot(close)\n`)
      const rgbOf = (w) => ((w & 0xff) << 16) | (w & 0xff00) | ((w >> 16) & 0xff)
      expect(rgbOf(out[0].values[0] >>> 0), `v${v} red`).toBe(red)
      expect(rgbOf(out[1].values[0] >>> 0), `v${v} yellow`).toBe(yellow)
      expect(rgbOf(out[2].values[0] >>> 0), `v${v} teal`).toBe(teal)
    }
  })
})

describe('⭐ `str.tostring(x, format.mintick)` at the binding\'s tick, and a literal pattern with text', () => {
  const SRC = [
    '//@version=5', 'indicator("t")',
    'var float acc = 0.0',
    'acc := acc + close / 3',
    's = str.tostring(acc, format.mintick) + "|" + str.tostring(acc, "#.# X")',
    'plot(s == "34.33|34.3 X" ? 1 : 0)',
    'plot(s == "68.00|68 X" ? 1 : 0)',
  ].join('\n')
  it('RDDT (NYSE, tick 0.01): the one tick formatter\'s text, trailing zeros kept', () => {
    // the texts below ARE the formatter's (CBC-FMT, `tickNumberText`), asked directly
    expect(tickNumberText(103 / 3, '0.01')).toBe('34.33')
    expect(tickNumberText(103 / 3 + 101 / 3, '0.01')).toBe('68.00')
    const out = run(SRC, { symbol: RDDT })
    expect(out[0].values).toEqual([1, 0, 0, 0])
    expect(out[1].values).toEqual([0, 1, 0, 0])
  })
  it('⛔ no symbol, no witnessed tick: the run stops BY NAME (`format:tick-unsettled`), never a guessed 0.01', () => {
    expect(tickNumberWhy(1.5, '')).toBe('format:tick-unsettled')
    expect(() => run(SRC)).toThrow(/format:tick-unsettled/)
  })
  it('⛔ a tie no capture shows stays withheld by name (`format:tick-tie-uncaptured`)', () => {
    expect(tickNumberText(-0.125, '0.01')).toBeNull()
    expect(tickNumberWhy(-0.125, '0.01')).toBe('format:tick-tie-uncaptured')
  })
  it('⛔ CONTROL: a `%` pattern is not one this lane prints (`runtime:call-text-state`)', () => {
    const r = refusalOf(SRC.replace('"#.# X"', '"#.#%"'), { symbol: RDDT })
    expect(r.guard).toBe('runtime:call-text-state')
  })
})
