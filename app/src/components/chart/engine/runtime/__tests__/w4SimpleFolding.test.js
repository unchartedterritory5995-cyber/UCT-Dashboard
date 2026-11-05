// app/src/components/chart/engine/runtime/__tests__/w4SimpleFolding.test.js
//
// ─── ⭐⭐ W4-T2 — `simple` QUALIFIER FOLDING: VALUES FIXED BEFORE BAR 0 ──────
//
// Pine's qualifier hierarchy is `const < input < simple < series`, and a
// variable's qualifier is the strongest of every value written to it and of
// every test it is written under:
//   https://www.tradingview.com/pine-script-docs/language/type-system/#qualifiers
//   https://www.tradingview.com/pine-script-docs/language/execution-model/
// A root-level name whose every write is invariant is `simple`, and a
// `simple int` may size a window or bound an offset. This lane refused every such
// name as "only known while the bar is running", because a name it mutates is a
// slot and the frozen resolver never sees a slot.
//
// Each served shape is checked against the PURE lane's own answer at the folded
// length (one kernel, `interpret.js`), and against the member's text input,
// which the fold reads at the value in force. Every control keeps its refusal.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { translatePine } from '../../ast/pine.js'
import { parseFormula } from '../../ast/parse.js'
import { interpret } from '../../ast/interpret.js'

const N = 40
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + i,
  h: 102 + i + (i % 3),
  l: 98 + i - (i % 4),
  c: 100 + Math.sin(i / 2.3) * 12 + i * 0.7,
  v: 1000 + i * 13,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'
// ⭐ a value the RUN computes, so the window is the runtime's, never a column
const X = 'var x = 0.0\nx := close\n'

const build = (src, inputs = {}, extra = {}) => buildRuntimeIr(head + src, { bars: BARS, inputs, ...extra })
function runPine(src, inputs = {}, extra = {}) {
  const built = build(src, inputs, extra)
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return { outs: r.outputs.map((o) => Array.from(o)), program }
}
function pureLane(expr) {
  const t = translatePine(`${head}plot(${expr})\n`)
  expect(t.ok, JSON.stringify(t.refusal || {})).toBe(true)
  const parsed = parseFormula(t.outputs[0].formula)
  expect(parsed.ok).toBe(true)
  const col = interpret(parsed.ast, BARS, {})
  return Array.from({ length: N }, (_, i) => (typeof col === 'number' ? col : col[i]))
}
const sameSeries = (got, want, label) => {
  for (let i = 0; i < N; i += 1) {
    if (Number.isNaN(want[i])) expect(Number.isNaN(got[i]), `${label} bar ${i} should be na`).toBe(true)
    else expect(got[i], `${label} bar ${i}`).toBeCloseTo(want[i], 10)
  }
}
/** The runtime's window over `x` must be the pure lane's `ta.sma(close, len)`. */
const smaIs = (src, len, inputs = {}, extra = {}) => {
  const { outs, program } = runPine(src, inputs, extra)
  expect(program.windows.map((w) => w.span), 'the window is sized to the folded length').toEqual([len])
  sameSeries(outs[0], pureLane(`ta.sma(close, ${len})`), `sma ${len}`)
}
// ⭐ W4-T8 r1 - these controls are `//@version=5`, and v5 declares `length (series int)`: a length that does
// NOT fold is no longer refused, it is read PER BAR. The control survives as "the name did not FOLD": either
// the old refusal, or a program whose window is per-bar (a wrong fold would give a fixed window and fail).
const refuses = (src, inputs = {}, extra = {}) => {
  const b = build(src, inputs, extra)
  if (!b.ok) {
    expect(b.refusal.guard).toBe('runtime:history-dynamic-offset')
    return b.refusal
  }
  const program = lowerIrProgram(b.ir)
  expect(program.windows.length, 'a built program must hold the window').toBeGreaterThan(0)
  expect(program.windows.every((w) => w.dynamic === true), 'a name that does not fold is read per bar, never fixed').toBe(true)
  return null
}
const MODE = 'mode = input.string("A", "Mode", options = ["A", "B", "C"])\n'

describe('⭐⭐ a never-reassigned `var` is simple', () => {
  it('⭐ `var L = 7` sizes a window', () => {
    smaIs(`${X}var L = 7\nplot(ta.sma(x, L))\n`, 7)
  })

  it('⭐ its initialiser follows the member\'s text input (the value in force)', () => {
    const src = `${MODE}${X}var L = mode == "A" ? 3 : 8\nplot(ta.sma(x, L))\n`
    smaIs(src, 3)
    smaIs(src, 8, { mode: 'B' })
  })

  it('⭐ it bounds a history offset', () => {
    const { outs, program } = runPine(`${X}var n = 3\nplot(x[n])\n`)
    expect(program.history[0].depth).toBe(3)
    expect(outs[0][10]).toBe(BARS[7].c)
  })

  it('⭐ it bounds a `for` counter, so `x[i]` sizes its ring (`constValueOf`)', () => {
    const { outs, program } = runPine(`${X}var n = 3\ns = 0.0\nfor i = 0 to n\n    s += x[i]\nplot(s)\n`)
    expect(program.history[0].depth).toBe(3)
    expect(outs[0][10]).toBeCloseTo(BARS[10].c + BARS[9].c + BARS[8].c + BARS[7].c, 10)
  })

  it('⭐⭐ TradingView\'s RSI: `var enableMA = maTypeInput != "None"` is an invariant test', () => {
    const src = 'maTypeInput = input.string("SMA", "MA", options = ["None", "SMA"])\n'
      + `${X}var enableMA = maTypeInput != "None"\nm = enableMA ? ta.sma(x, 5) : na\nplot(m)\n`
    const { outs } = runPine(src)
    sameSeries(outs[0], pureLane('ta.sma(close, 5)'), 'MA on')
    const off = runPine(src, { maTypeInput: 'None' }).outs[0]
    expect(off.every((v) => Number.isNaN(v)), 'MA off draws na on every bar').toBe(true)
  })
})

describe('⭐⭐ a reassignment under an invariant test is simple', () => {
  it('⭐ under `if` on a text input — and it changes with the member\'s choice', () => {
    const src = `${MODE}${X}len = 10\nif mode == "A"\n    len := 5\nplot(ta.sma(x, len))\n`
    smaIs(src, 5)
    smaIs(src, 10, { mode: 'B' })
  })

  it('⭐ under `if timeframe.isintraday` — read off the build\'s own timeframe, never guessed', () => {
    const src = `${X}len = 10\nif timeframe.isintraday\n    len := 5\nplot(ta.sma(x, len))\n`
    smaIs(src, 5, {}, { tf: '60' })
    smaIs(src, 10, {}, { tf: 'D' })
    // ⛔ no timeframe given: nothing to fold the test with, so it still refuses
    refuses(src)
  })

  it('⭐ an `if` / `else if` / `else` chain with the compound forms', () => {
    const src = `${MODE}${X}len = 4\nif mode == "A"\n    len := 6\nelse if mode == "B"\n    len += 3\nelse\n    len *= 3\nplot(ta.sma(x, len))\n`
    smaIs(src, 6)
    smaIs(src, 7, { mode: 'B' })
    smaIs(src, 12, { mode: 'C' })
  })

  it('⭐ the value at a read is the value AT THAT READ (straight-line, as Pine runs it)', () => {
    const src = `${X}len = 4\na = ta.sma(x, len)\nlen := 6\nb = ta.sma(x, len)\nplot(a)\nplot(b)\n`
    const { outs, program } = runPine(src)
    expect(program.windows.map((w) => w.span)).toEqual([4, 6])
    sameSeries(outs[0], pureLane('ta.sma(close, 4)'), 'before the write')
    sameSeries(outs[1], pureLane('ta.sma(close, 6)'), 'after the write')
  })

  it('⭐ a write that reads its own name reads the value BEFORE it', () => {
    smaIs(`${MODE}${X}len = 2\nif mode == "A"\n    len := len + 3\nplot(ta.sma(x, len))\n`, 5)
  })

  it('⭐ a test that reads the name it guards reads the value before the chain', () => {
    smaIs(`${MODE}${X}len = 10\nif mode == "A" and len > 3\n    len := 5\nplot(ta.sma(x, len))\n`, 5)
  })

  it('⭐ an `if` that writes nothing to the name does not stop the fold, whatever its test', () => {
    smaIs(`${MODE}${X}len = 10\ny = 0\nif close > open\n    y := 1\nif mode == "A"\n    len := 5\nplot(ta.sma(x, len))\nplot(y)\n`, 5)
  })

  it('⭐ a named argument after the read (`linewidth = 2`) is not a write', () => {
    smaIs(`${MODE}${X}len = 10\nif mode == "A"\n    len := 5\nplot(ta.sma(x, len), linewidth = 2)\n`, 5)
  })

  it('⭐ a simple name read by another simple name\'s value', () => {
    smaIs(`${MODE}${X}a = 2\nif mode == "A"\n    a := 3\nb = 1\nb := a * 2 + 1\nplot(ta.sma(x, b))\n`, 7)
  })
})

describe('⭐⭐ pointwise arithmetic over simple values folds', () => {
  it('⭐ `math.max(len, 3)` over an input', () => {
    smaIs(`len = input.int(2, "L")\n${X}plot(ta.sma(x, math.max(len, 3)))\n`, 3)
    smaIs(`len = input.int(5, "L")\n${X}plot(ta.sma(x, math.max(len, 3)))\n`, 5)
  })

  it('⭐ `math.max(len, 3)` over a reassigned simple name', () => {
    smaIs(`${MODE}${X}len = 2\nif mode == "B"\n    len := 9\nplot(ta.sma(x, math.max(len, 3)))\n`, 3)
    smaIs(`${MODE}${X}len = 2\nif mode == "B"\n    len := 9\nplot(ta.sma(x, math.max(len, 3)))\n`, 9, { mode: 'B' })
  })

  it('⚠️ a NUMERIC input still folds at the author\'s default (owner rule 2026-08-11, `history.test.js`)', () => {
    smaIs(`len = input.int(5, "L")\n${X}plot(ta.sma(x, math.max(len, 3)))\n`, 5, { len: 8 })
  })
})

describe('⛔ CONTROLS — what is not simple keeps its refusal', () => {
  it('⛔ a reassignment under a PER-BAR test', () => {
    refuses(`${X}len = 10\nif close > open\n    len := 5\nplot(ta.sma(x, len))\n`)
  })

  it('⛔ a `var` written inside a block, even under an invariant test', () => {
    refuses(`${MODE}${X}var L = 7\nif mode == "A"\n    L := 5\nplot(ta.sma(x, L))\n`)
  })

  it('⛔ a `var` reassigned at the root (bar 1 reads the write of bar 0)', () => {
    refuses(`${X}var L = 7\nL := 5\nplot(ta.sma(x, L))\n`)
  })

  it('⛔ a write inside a loop, a `switch` arm, or with a block-valued right side', () => {
    refuses(`${X}len = 3\nfor i = 0 to 2\n    len += 1\nplot(ta.sma(x, len))\n`)
    refuses(`${MODE}${X}len = 3\nswitch mode\n    "A" => len := 5\nplot(ta.sma(x, len))\n`)
    refuses(`${MODE}${X}len = 3\nlen := if mode == "A"\n    5\nelse\n    6\nplot(ta.sma(x, len))\n`)
  })

  it('⛔ a `series`-declared name, and `/` (T17)', () => {
    refuses(`${MODE}${X}series int len = 5\nif mode == "A"\n    len := 6\nplot(ta.sma(x, len))\n`)
    // (a literal `10 / 2` is the Resolver's own version-aware answer, F1; an
    // input's quotient is not, and that is T17's)
    refuses(`${MODE}n = input.int(10, "N")\n${X}len = 10\nif mode == "A"\n    len := n / 2\nplot(ta.sma(x, len))\n`)
  })

  it('⛔ a block that declares its OWN `len` is not the root\'s writes', () => {
    refuses(`${MODE}${X}len = 10\nif mode == "A"\n    len = 3\n    len := 4\nplot(ta.sma(x, len))\n`)
  })

  it('⛔ a function body reads a global at the CALL\'s moment, so it does not fold there', () => {
    // Pine: `f` reads `len` when it is called (5 here on an intraday chart); the
    // body's own text position would say 10. Nothing folds inside the body.
    const b = build(`${X}len = 10\nf(s) => ta.sma(s, len)\nif timeframe.isintraday\n    len := 5\nplot(f(x))\n`, {}, { tf: '60' })
    expect(b.ok).toBe(false)
  })

  it('⛔ a value that does not fold makes the name per-bar', () => {
    refuses(`${X}len = 4\nlen := bar_index % 3 + 1\nplot(ta.sma(x, len))\n`)
    // a per-bar DECLARATION makes the name series, whatever a later write says
    refuses(`${MODE}${X}len = bar_index\nif mode == "A"\n    len := 5\nplot(ta.sma(x, len))\n`)
  })

  it('⛔ a chain of simple names deeper than the ceiling refuses, one below it folds', () => {
    const chain = (n) => {
      let s = 'a0 = 1\na0 := 2\n'
      for (let k = 1; k <= n; k += 1) s += `a${k} = 0\na${k} := a${k - 1}\n`
      return `${X}${s}plot(ta.sma(x, a${n}))\n`
    }
    smaIs(chain(30), 2)
    refuses(chain(40))
  })
})
