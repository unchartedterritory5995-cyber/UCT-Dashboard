// app/src/components/chart/engine/runtime/__tests__/runtimeWalls3.test.js
//
// ─── THE RUNTIME LANE'S CHEAPEST MEASURED COMPLETIONS (pine/runtime-walls-3) ──
//
// Four capabilities, each chosen because the runtime-lane door census
// (`runtimeLaneDoor.census.measure.test.js`, 2026-09-28) showed it as the LAST
// wall — or the only wall left after another — standing between a corpus script
// and the member pane:
//
//   1. `#RRGGBBAA` — an 8-digit colour literal carries its own alpha
//      (kernel-channel-backquant: `input.color(#ffeb3b26, …)`).
//   2. a `,` ending a line whose next line sits at the statement's own indent
//      separates two statements (nonlinear-regression-zero-lag-moving-average-loxx).
//   3. `plotcandle` / `plotbar` compute their four values (kernel-channel).
//   4. `LOOP_ITERATIONS` is a PER-BAR ceiling (kernel-channel, and three scripts
//      that already attached — atr-stepped, nadaraya-watson, wyckoff — which died
//      `LOOP_ITERATIONS_EXCEEDED` on 3,000 daily bars).
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lexPine, blockStatements } from '../../ast/pine.js'
import { hexToPacked } from '../colours.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 4
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 103 + i, l: 97 + i, c: 100 + i * 2, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("t", overlay = true)\n'

function build(src) {
  return buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
}
function run(src, limits) {
  const built = build(src)
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const res = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
  }, limits)
  return { outputs: program.outputs, series: res.outputs.map((o) => Array.from(o)) }
}

// ─── 1. `#RRGGBBAA` ─────────────────────────────────────────────────────────
describe('⭐ an 8-digit colour literal carries its own alpha', () => {
  const bytes = (v) => ({
    t: (v >>> 24) & 0xff, b: (v >>> 16) & 0xff, g: (v >>> 8) & 0xff, r: v & 0xff,
  })

  it('⭐ the last byte is OPACITY, so the packed transparency byte is exactly 255 - AA', () => {
    // #ffeb3b26 — 0x26 = 38 opacity → transparency byte 217, byte-for-byte.
    expect(bytes(hexToPacked('#ffeb3b26', 0))).toEqual({ t: 255 - 0x26, r: 0xff, g: 0xeb, b: 0x3b })
    expect(bytes(hexToPacked('#00FF00FF', 0))).toEqual({ t: 0, r: 0, g: 0xff, b: 0 })
    expect(bytes(hexToPacked('#00ff0000', 0))).toEqual({ t: 255, r: 0, g: 0xff, b: 0 })
  })

  it('⛔ CONTROL: the 6-digit form is unchanged — opaque, same three channels', () => {
    expect(hexToPacked('#ffeb3b26', 0) & 0x00ffffff).toBe(hexToPacked('#ffeb3b', 0) & 0x00ffffff)
    expect(bytes(hexToPacked('#ffeb3b', 0)).t).toBe(0)
  })

  it('⛔ an 8-digit literal handed a transparency as well is refused, not resolved silently', () => {
    expect(() => hexToPacked('#ffeb3b26', 50)).toThrow(/already carries its own transparency/)
  })

  it('⭐ through the lane: `input.color(#RRGGBBAA)` paints a bgcolor with that alpha', () => {
    const r = run('color c = input.color(#ffeb3b26, "Squeeze")\n'
      + 'var float m = 0.0\nm := m + close\n'
      + 'bgcolor(m > 250 ? c : na)\nplot(m)\n')
    const bg = r.series[r.outputs.findIndex((o) => o.call === 'bgcolor')]
    expect(Number.isNaN(bg[0]) && Number.isNaN(bg[1])).toBe(true)
    expect([bg[2] >>> 0, bg[3] >>> 0]).toEqual([hexToPacked('#ffeb3b26', 0), hexToPacked('#ffeb3b26', 0)])
  })
})

// ─── 2. a line-ending `,` before a line at the same indent ──────────────────
describe('⭐ a comma that ends a line separates it from a same-indent line below', () => {
  const headers = (src) => {
    const lx = lexPine(src)
    return blockStatements(lx.tokens, lx.indents, 0).map((s) => s.header.map((t) => t.value).join(' '))
  }

  it('⭐ `binding,` then an unindented `plot(…)` are TWO statements (the loxx line)', () => {
    expect(headers('c = close > open ? 1 : 2,\nplot(close, "a", color = c)\n'))
      .toEqual(['c = close > open ? 1 : 2', 'plot ( close , a , color = c )'])
  })

  it('⛔ CONTROL: a comma inside ONE line is left exactly as before', () => {
    // `a = 1, plot(close)` is not an all-bindings run, so the existing rule keeps
    // the line whole — this change only cuts at a LINE BREAK.
    expect(headers('a = 1, plot(close)\n')).toEqual(['a = 1 , plot ( close )'])
    expect(headers('a = 1, b = 2\n')).toEqual(['a = 1', 'b = 2'])
  })

  it('⛔ CONTROL: a comma followed by an INDENTED line is still a continuation', () => {
    expect(headers('f = math.max(1,\n     2)\nplot(f)\n'))
      .toEqual(['f = math.max ( 1 , 2 )', 'plot ( f )'])
    expect(headers('a = 1,\n     b = 2\n')).toEqual(['a = 1', 'b = 2'])
  })

  it('⭐ through the lane: the plot on the line after the comma is drawn', () => {
    const r = run('float out = close\nfloat sig = out[1]\n'
      + 'color colorout = out > sig ? color.green : color.red,\n'
      + 'plot(out, "o", color = colorout)\n')
    expect(r.outputs.map((o) => o.call)).toEqual(['plot'])
    expect(r.series[0]).toEqual(BARS.map((b) => b.c))
  })
})

// ─── 3. `plotcandle` / `plotbar` ───────────────────────────────────────────
describe('⭐ plotcandle and plotbar compute their four values', () => {
  it('⭐ four outputs, one per role, in Pine\'s own order', () => {
    const r = run('plotcandle(open, high, low, (open + close) / 2, "c")\nplot(close)\n')
    expect(r.outputs.slice(0, 4).map((o) => [o.call, o.role]))
      .toEqual([['plotcandle', 'open'], ['plotcandle', 'high'], ['plotcandle', 'low'], ['plotcandle', 'close']])
    expect(r.series[0]).toEqual(BARS.map((b) => b.o))
    expect(r.series[1]).toEqual(BARS.map((b) => b.h))
    expect(r.series[2]).toEqual(BARS.map((b) => b.l))
    expect(r.series[3]).toEqual(BARS.map((b) => (b.o + b.c) / 2))
  })

  it('⭐ a NAMED role wins over position — a reordered call is not a swapped candle', () => {
    const r = run('plotbar(close = open, open = close, high = high, low = low)\nplot(close)\n')
    expect(r.series[0]).toEqual(BARS.map((b) => b.c))   // open = close
    expect(r.series[3]).toEqual(BARS.map((b) => b.o))   // close = open
  })

  it('⭐ the kernel-channel shape: colours, a `display` ternary on an input, `bordercolor =`', () => {
    const built = build('bool useBarColor = input.bool(false, "c")\nvar color barCol = na\n'
      + 'barCol := close > open ? color.lime : color.red\n'
      + 'plotcandle(open, high, low, close, "Bar Coloring", barCol, barCol, true, '
      + 'bordercolor = barCol, display = useBarColor ? display.all : display.none)\nplot(close)\n')
    expect(built.ok, built.refusal && built.refusal.message).toBe(true)
  })

  it('⛔ a missing role is refused by name, not drawn as a three-quarter candle', () => {
    const b = build('plotcandle(open, high, low)\nplot(close)\n')
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:statement')
    expect(b.refusal.message).toMatch(/`close` was not given/)
  })

  it('⛔ a colour handed to a role is refused exactly as `plot` refuses it', () => {
    const b = build('plotcandle(open, high, low, color.red)\nplot(close)\n')
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:colour')
  })
})

// ─── 4. LOOP_ITERATIONS is per bar ─────────────────────────────────────────
describe('⭐ LOOP_ITERATIONS is a PER-BAR ceiling', () => {
  const LOOP = 'float s = 0.0\nfor i = 1 to 30\n    s := s + 1.0\nplot(s)\n'

  it('⭐ 30 iterations a bar over 4 bars (120 in all) fits a ceiling of 40', () => {
    // A total-over-the-run ceiling of 40 would stop this at bar 2.
    expect(run(LOOP, { LOOP_ITERATIONS: 40 }).series[0]).toEqual(new Array(N).fill(30))
  })

  it('⛔ CONTROL: one bar that needs more than the ceiling is still stopped by name', () => {
    expect(() => run(LOOP, { LOOP_ITERATIONS: 29 })).toThrow(/LOOP_ITERATIONS_EXCEEDED/)
  })
})
