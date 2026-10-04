// app/src/components/chart/engine/runtime/__tests__/rt15Presentation.test.js
//
// ─── ⭐⭐ RT15 — presentation, strategies and colour typing on the runtime lane ─
//
// The rules (`docs/pine/vendor-harness/objects-triage-2026-09-28.md` § RT15):
//
//   1. `plotcandle` / `plotbar` as a statement are SKIPPED and RECORDED (`undrawn`):
//      RT1's ruling — candles have no row on a runtime document and the door names
//      them. Every other output of the script is the program it was without them.
//      A script whose only output is candles refuses `runtime:presentation`.
//   2. An `if` chain made only of strategy ORDER calls (C50 / R1), effect-free tests
//      and effect-free locals is the order calls it holds: skipped whole.
//   3. `[var] color x = na` declares a COLOUR (Pine's declared type).
//   4. `nz(<colour>)` with no replacement is UNSETTLED and refused by name
//      (`runtime:colour-nz`, capture Q-RT15b); `nz(c, replacement)` is served.
//   5. A user function / method defined once whose body is one colour expression
//      returns a colour.
//   6. The door: a document whose only drawing is a paint is drawn (a pane script
//      with only a background is refused `pine:paint-pane`, the host's rule), and a
//      skipped candle is named even when the host translation lists none.
import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr, RUNTIME_UNDRAWN_CANDLE_CALLS } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import * as registry from '../../nativeRegistry'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { enterDoorState } from '../../__tests__/vendorHarness/harness'

const N = 60
const BARS = (() => {
  const out = []
  let p = 100
  for (let i = 0; i < N; i += 1) {
    p += Math.sin(i / 4) * 1.3 + Math.cos(i / 9) * 0.5
    out.push({ t: 1700000000 + i * 86400, o: p - 0.4, h: p + 1, l: p - 1, c: p, v: 1000 + i })
  }
  return out
})()
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))

const build = (src) => buildRuntimeIr(src, { bars: BARS, inputs: {} })
const run = (src) => {
  const built = build(src)
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return { outputs: outputs.map((o) => Array.from(o)), ir: built.ir, built }
}
const HEAD = '//@version=5\nindicator("x", overlay=true)\n'
const CORPUS = path.join(path.resolve(process.cwd(), '..'), 'corpus', 'committed')

describe('⭐⭐ 1 — `plotcandle` / `plotbar` are skipped, recorded, and change no other output', () => {
  const BODY = 'm = ta.sma(close, 5)\nplot(m)\n'
  for (const call of ['plotcandle', 'plotbar']) {
    it(`\`${call}\` beside a plot: the same program as the script without it`, () => {
      const without = run(`${HEAD}${BODY}`)
      const withIt = run(`${HEAD}${BODY}${call}(open, high, low, close, title = "c", color = m > close ? color.green : color.red)\n`)
      expect(JSON.stringify(withIt.ir)).toBe(JSON.stringify(without.ir))
      expect(withIt.outputs).toEqual(without.outputs)
      expect(withIt.built.undrawn).toEqual([{ call, line: 5 }])
      expect(withIt.built.diagnostics.families['runtime:undrawn-candles']).toBe(1)
      expect(without.built.undrawn).toEqual([])
      // non-vacuity: the plot moves
      expect(new Set(without.outputs[0].filter(Number.isFinite)).size).toBeGreaterThan(5)
    })
  }

  it('the set is exported and is exactly the two candle calls', () => {
    expect([...RUNTIME_UNDRAWN_CANDLE_CALLS].sort()).toEqual(['plotbar', 'plotcandle'])
  })

  it('an argument that could change something is still evaluated where the call stands', () => {
    const src = `${HEAD}var a = array.new_float()\nf() =>\n    array.push(a, close)\n    close\n`
      + 'plotcandle(open, high, low, f())\nplot(array.size(a))\n'
    const r = run(src)
    // every bar pushed once: the size counts the bars
    expect(r.outputs[0][N - 1]).toBe(N)
  })

  it('⛔ a script whose ONLY output is candles refuses `runtime:presentation`, at the call', () => {
    const b = build(`${HEAD}plotcandle(open, high, low, close)\n`)
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:presentation')
    expect(b.refusal.message).toMatch(/only output is `plotcandle\(\)`/)
    expect(b.refusal.line).toBe(3)
  })

  it('⛔ a user function NAMED plotcandle is not the builtin (no skip)', () => {
    const b = build(`${HEAD}plotcandle(a, b, c, d) => a + b + c + d\nx = plotcandle(open, high, low, close)\nplot(x)\n`)
    expect(b.ok, b.refusal && b.refusal.message).toBe(true)
    expect(b.undrawn).toEqual([])
  })
})

describe('⭐⭐ 2 — an `if` that only places orders is skipped whole', () => {
  const S = '//@version=5\nstrategy("s", overlay=true)\n'
  const BASE = 'm = ta.sma(close, 5)\nif ta.crossover(close, m)\n    strategy.entry("L", strategy.long)\nplot(m)\n'
  const ORDER_IF = 'if strategy.position_size > 0\n    ep = strategy.position_avg_price\n'
    + '    if close < ep * 0.9\n        strategy.exit("SL", "L", stop = ep * 0.9)\n'
    + '    else if close > ep * 1.1\n        strategy.close("L")\n'
    + 'else\n    strategy.cancel_all()\n'

  it('a broker value read only by an order-only chain: the program is the one without the chain', () => {
    const without = run(`${S}${BASE}`)
    const withIt = run(`${S}${BASE}${ORDER_IF}`)
    expect(JSON.stringify(withIt.ir)).toBe(JSON.stringify(without.ir))
    expect(withIt.outputs).toEqual(without.outputs)
    expect(withIt.built.diagnostics.families['runtime:strategy-order']).toBe(4)
  })

  const refusesStrategyValue = (body) => {
    const b = build(`${S}${BASE}${body}`)
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('pine:strategy-call')
  }
  it('⛔ a reassignment inside the chain keeps it: the broker value refuses by name', () => {
    refusesStrategyValue('var n = 0\nif strategy.position_size > 0\n    n := n + 1\n    strategy.close("L")\nplot(n)\n')
  })
  it('⛔ a drawing inside the chain keeps it', () => {
    refusesStrategyValue('if strategy.position_size > 0\n    label.new(bar_index, high, "in")\n    strategy.close("L")\n')
  })
  it('⛔ a chain with NO order call is lowered as before', () => {
    refusesStrategyValue('if strategy.position_size > 0\n    ep = strategy.position_avg_price\n')
  })
  it('⛔ a broker value read OUTSIDE an order-only chain still refuses', () => {
    refusesStrategyValue('plot(strategy.position_size)\n')
  })
  it('⛔ `runtime.error` inside the chain keeps it (it can stop the script)', () => {
    refusesStrategyValue('if strategy.position_size > 0\n    runtime.error("x")\n    strategy.close("L")\n')
  })
  it('⛔ a call that could have an effect in the TEST keeps the chain', () => {
    const b = build(`${S}var a = array.new_float()\ng() =>\n    array.push(a, 1)\n    true\n`
      + 'if g() and strategy.position_size > 0\n    strategy.close("L")\nplot(array.size(a))\n')
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('pine:strategy-call')
  })
})

describe('⭐⭐ 3 — `[var] color x = na` declares a colour', () => {
  it('`var color c = na` then `:=` colours: `barcolor(c)` paints', () => {
    const r = run(`${HEAD}var color c = na\nc := close > open ? color.green : color.red\nbarcolor(c)\nplot(close)\n`)
    expect(r.outputs[0].every((v) => Number.isFinite(v))).toBe(true)
  })
  it('`color c = na` (no var, never reassigned) is a colour: the same program as `na` written in place', () => {
    const typed = run(`${HEAD}color c = na\nbgcolor(close > open ? c : color.blue)\nplot(close)\n`)
    const inPlace = run(`${HEAD}bgcolor(close > open ? na : color.blue)\nplot(close)\n`)
    expect(JSON.stringify(typed.ir)).toBe(JSON.stringify(inPlace.ir))
    expect(typed.outputs).toEqual(inPlace.outputs)
  })
  it('⛔ CONTROL: the untyped `var c = na` keeps its refusal', () => {
    const b = build(`${HEAD}var c = na\nc := close > open ? color.green : color.red\nbarcolor(c)\nplot(close)\n`)
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:colour')
  })
  it('⛔ CONTROL: a `color` keyword over a NUMBER is not admitted on the keyword', () => {
    const b = build(`${HEAD}var color c = 0\nc := close > open ? color.green : color.red\nbarcolor(c)\nplot(close)\n`)
    expect(b.ok).toBe(false)
  })
})

describe('⭐⭐ 4 — `nz(<colour>)` with no replacement is refused by name', () => {
  const PRE = `${HEAD}var color c = na\nc := close > open ? color.green : close < open ? color.red : `
  it('⛔ `nz(c[1])`: refused `runtime:colour-nz`, at the call', () => {
    const b = build(`${PRE}nz(c[1])\nbarcolor(c)\nplot(close)\n`)
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:colour-nz')
    expect(b.refusal.line).toBe(4)
  })
  it('`nz(c[1], color.gray)` names its answer and is served', () => {
    const r = run(`${PRE}nz(c[1], color.gray)\nbarcolor(c)\nplot(close)\n`)
    expect(r.outputs[0].every(Number.isFinite)).toBe(true)
  })
  it('⛔ CONTROL: a numeric `nz(x[1])` is untouched', () => {
    const r = run(`${HEAD}var x = 0.0\nx := nz(x[1]) + 1\nplot(x)\n`)
    expect(r.outputs[0][N - 1]).toBe(N)
  })
})

describe('⭐⭐ 5 — a user function / method whose one body expression is a colour', () => {
  it('a method `=> color.new(x, t)` (block body) paints `bgcolor(c.transp(80))`', () => {
    const r = run(`${HEAD}method transp(color x, int t) =>\n    color.new(x, t)\n`
      + 'c = close > open ? color.green : color.red\nbgcolor(c.transp(80))\nplot(close)\n')
    expect(r.outputs[0].every(Number.isFinite)).toBe(true)
  })
  it('a one-line function `f(x) => color.new(x, 50)` paints `barcolor(f(color.red))`', () => {
    const r = run(`${HEAD}f(color x) => color.new(x, 50)\nbarcolor(f(color.red))\nplot(close)\n`)
    expect(r.outputs[0].every(Number.isFinite)).toBe(true)
  })
  it('⛔ CONTROL: a function whose body is a NUMBER is not a colour', () => {
    const b = build(`${HEAD}f(x) => x * 2\nbarcolor(f(close))\nplot(close)\n`)
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:colour')
  })
  it('⛔ CONTROL: a block body with a binding first is not read as one expression', () => {
    const b = build(`${HEAD}f(color x) =>\n    y = 50\n    color.new(x, y)\nbarcolor(f(color.red))\nplot(close)\n`)
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:colour')
  })
  it('⛔ CONTROL: a method declared twice (an overload) is not typed by either body', () => {
    const b = build(`${HEAD}method transp(color x, int t) =>\n    color.new(x, t)\n`
      + 'method transp(float x, int t) =>\n    x + t\n'
      + 'c = close > open ? color.green : color.red\nbgcolor(c.transp(80))\nplot(close)\n')
    expect(b.ok).toBe(false)
  })
})

describe('⭐⭐ 6 — the member door', () => {
  const DEF_ID = 'u_member-pane-rt15'
  afterEach(() => {
    registry.uninstallUserDefinition(DEF_ID)
    vi.unstubAllEnvs()
  })
  // a loop the host translator refuses and the runtime lane runs
  const LOOP = 's = 0.0\nfor i = 0 to 2\n    s += close[i]\n'

  it('a skipped candle is NAMED on the runtime document', () => {
    enterDoorState('runtime')
    const src = `//@version=5\nindicator("x", overlay=true)\n${LOOP}plot(s / 3)\nplotcandle(open, high, low, s / 3)\n`
    const d = memberPaneDefinition({ source: src, id: DEF_ID })
    expect(d.ok, d.reason).toBe(true)
    expect(d.lane).toBe('runtime')
    const note = (d.notes || []).find((n) => n.name === 'Not drawn by this pane')
    expect(note && note.note, JSON.stringify(d.notes)).toMatch(/candles/)
  })

  it('a document whose only drawing is a `barcolor` is drawn (overlay)', () => {
    enterDoorState('runtime')
    const src = `//@version=5\nindicator("x", overlay=true)\n${LOOP}barcolor(s > 3 * close ? color.green : na)\n`
    const d = memberPaneDefinition({ source: src, id: DEF_ID })
    expect(d.ok, d.reason).toBe(true)
    expect(d.lane).toBe('runtime')
    expect((d.definition.paints || []).map((p) => p.kind)).toEqual(['barcolor'])
    // the anchor row only: never offered, never drawn
    expect(d.definition.plots.filter((p) => !p.hidden)).toEqual([])
  })

  it('⛔ a PANE script whose only drawing is a background is refused `pine:paint-pane`', () => {
    enterDoorState('runtime')
    const src = `//@version=5\nindicator("x", overlay=false)\n${LOOP}bgcolor(s > 3 * close ? color.green : na)\n`
    const d = memberPaneDefinition({ source: src, id: DEF_ID })
    expect(d.ok).toBe(false)
    expect(d.runtimeDeclined && d.runtimeDeclined.code).toBe('pine:paint-pane')
  })

  it('a drawing-only script whose drawing build refused names THAT wall, not "nothing to plot"', () => {
    // strong-start-rvol-dashboard: a table-only dashboard (the owner's acceptance script)
    const file = fs.readdirSync(CORPUS).find((f) => f.startsWith('strong-start-rvol-dashboard__'))
    enterDoorState('runtime')
    const d = memberPaneDefinition({ source: fs.readFileSync(path.join(CORPUS, file), 'utf8'), id: DEF_ID })
    expect(d.ok).toBe(false)
    expect(d.runtimeDeclined && d.runtimeDeclined.code).toBe('runtime:history-dynamic-offset')
    expect(d.runtimeDeclined.why).toMatch(/ta\.sma/)
  })

  it('⛔ a paint the host withholds leaves nothing drawn: `runtime:withheld-all`, with its reason', () => {
    enterDoorState('runtime')
    const src = `//@version=5\nindicator("x", overlay=true)\nflag = input.bool(true, "f")\n${LOOP}`
      + 'barcolor(s > 3 * close ? color.green : na, offset = flag ? -1 : na)\n'
    const d = memberPaneDefinition({ source: src, id: DEF_ID })
    expect(d.ok).toBe(false)
    expect(d.runtimeDeclined && d.runtimeDeclined.code).toBe('runtime:withheld-all')
    expect(d.runtimeDeclined.why).toMatch(/offset/)
  })
})
