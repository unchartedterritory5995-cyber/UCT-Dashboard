// app/src/components/chart/engine/runtime/__tests__/runtimeStrategy.test.js
//
// ─── ⭐⭐ R1 — A STRATEGY DRAWS LIKE AN INDICATOR IN THE RUNTIME LANE TOO ─────
//
// C50 (`pine.js`, 2026-10-02) made the HOST lane read `strategy(...)` like
// `indicator(...)` and skip the simulated broker's order calls with a note,
// keeping every `strategy.*` VALUE refused by name. Until R1 the RUNTIME lane
// still refused the whole script at its first line (`runtime:declaration`, 26
// of the 266 committed scripts). These rails hold the same rule here:
//
//   1. `strategy(...)` is a declaration this lane skips, exactly as it skips
//      `indicator(...)` — the program it builds is byte-for-byte the indicator's;
//   2. an ORDER call (`STRATEGY_ORDER_CALLS`, imported from `pine.js` — ONE
//      authority over which calls are the broker's) is skipped as a statement;
//   3. a `strategy.*` VALUE still refuses, by name;
//   4. only the CALL form is a declaration — a VARIABLE named `strategy` in an
//      indicator binds like any other name (vendor-grounded in
//      `runtimeStrategyWord.vendor.test.js`).
//
// ⚠️ NO VENDOR CAPTURE OF A STRATEGY EXISTS YET. Rule 1 is the integrator's C50
// ruling, live in the host lane; the capture that would witness it is queued in
// `docs/pine/capture-queue-2026-10-02-r1-strategy.md` (probe
// `tools/visual_conformance/probes/r1-strategy-draws.pine`).
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { STRATEGY_ORDER_CALLS } from '../../ast/pine.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

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
  return { outputs: outputs.map((o) => Array.from(o)), ir: built.ir, diagnostics: built.diagnostics }
}

const BODY = `fast = ta.sma(close, 3)
slow = ta.sma(close, 8)
var crosses = 0
if ta.crossover(fast, slow)
    crosses := crosses + 1
plot(fast)
plot(crosses)
`

describe('⭐⭐ the declaration', () => {
  it('a strategy builds the SAME program as the indicator with the same body', () => {
    const asIndicator = run(`//@version=5\nindicator("x", overlay=true)\n${BODY}`)
    const asStrategy = run(`//@version=5\nstrategy("x", overlay=true, initial_capital=1000)\n${BODY}`)
    expect(JSON.stringify(asStrategy.ir)).toBe(JSON.stringify(asIndicator.ir))
    expect(asStrategy.outputs).toEqual(asIndicator.outputs)
    // ⛔ NON-VACUITY: the program draws something that moves.
    expect(Math.max(...asIndicator.outputs[1])).toBeGreaterThan(0)
    expect(asStrategy.diagnostics.families['runtime:strategy-chart']).toBe(1)
  })

  it('⛔ a `library(...)` still refuses as a declaration', () => {
    const built = build('//@version=5\nlibrary("L")\nplot(close)\n')
    expect(built.ok).toBe(false)
    expect(built.refusal.guard).toBe('runtime:declaration')
    expect(built.refusal.message).toMatch(/not an indicator/)
  })
})

describe('⭐⭐ the order calls — the simulated broker is left out', () => {
  const ORDERS = `if ta.crossover(fast, slow)
    strategy.entry("L", strategy.long, comment = "go")
if ta.crossunder(fast, slow)
    strategy.close("L")
    strategy.exit("x", "L", stop = low, limit = high)
strategy.risk.allow_entry_in(strategy.direction.long)
`

  it('every order call is skipped, and the drawing is what it would be without them', () => {
    const without = run(`//@version=5\nstrategy("x")\n${BODY}`)
    const withOrders = run(`//@version=5\nstrategy("x")\n${BODY}${ORDERS}`)
    expect(withOrders.outputs).toEqual(without.outputs)
    expect(withOrders.diagnostics.families['runtime:strategy-order']).toBe(4)
  })

  it('⭐ ONE AUTHORITY: every member of the host lane\'s set is skipped here, and nothing else is', () => {
    // The set is IMPORTED from `pine.js`; a second copy in this lane would be a
    // second authority over which calls belong to the broker.
    expect(STRATEGY_ORDER_CALLS.size).toBeGreaterThan(10)
    for (const word of STRATEGY_ORDER_CALLS) {
      const built = build(`//@version=5\nstrategy("x")\n${word}("a")\nplot(close)\n`)
      expect(built.ok, `${word}: ${JSON.stringify(built.refusal)}`).toBe(true)
    }
    // ⛔ CONTROL: a `strategy.*` call OUTSIDE the set is not skipped.
    const other = build('//@version=5\nstrategy("x")\nstrategy.closedtrades.entry_price(0)\nplot(close)\n')
    // (A call used as a statement is refused as such; what matters is that it is
    // not silently skipped as if it were the broker's.)
    expect(other.ok).toBe(false)
    expect(other.diagnostics.families['runtime:strategy-order']).toBeUndefined()
  })
})

describe('⛔ a `strategy.*` VALUE stays refused, by name', () => {
  for (const name of ['strategy.position_size', 'strategy.equity', 'strategy.opentrades']) {
    it(`\`${name}\``, () => {
      const built = build(`//@version=5\nstrategy("x")\nplot(${name})\n`)
      expect(built.ok).toBe(false)
      expect(built.refusal.guard).toBe('pine:strategy-call')
      expect(built.refusal.message).toContain(name)
    })
  }

  // ⭐⭐ RT15 (2026-10-04) — SUPERSEDES R1's "…including inside a condition the order
  // call would have hidden". An `if` made ONLY of order calls is the order calls it
  // holds (C50: the broker is not run), so its test reads nothing a drawing reads and
  // the chain is skipped whole (`rt15Presentation.test.js` § 2). A broker value that
  // reaches anything ELSE — a reassignment, a drawing, a plot — still refuses here.
  it('…a condition that guards an order AND something else still refuses', () => {
    const built = build(`//@version=5\nstrategy("x")\nvar n = 0\nif strategy.position_size > 0\n    strategy.close("L")\n    n := n + 1\nplot(n)\n`)
    expect(built.ok).toBe(false)
    expect(built.refusal.guard).toBe('pine:strategy-call')
  })
  it('…and a condition that guards ONLY orders is skipped with them (RT15)', () => {
    const built = build(`//@version=5\nstrategy("x")\nif strategy.position_size > 0\n    strategy.close("L")\nplot(close)\n`)
    expect(built.ok, JSON.stringify(built.refusal)).toBe(true)
    expect(built.diagnostics.families['runtime:strategy-order']).toBe(1)
  })
})

describe('⛔ only the CALL form `strategy(` is a declaration', () => {
  it('an indicator may keep a VARIABLE named `strategy`', () => {
    const { outputs } = run(`//@version=5\nindicator("x")\nstrategy = 0\nif close > open\n    strategy := 1\nplot(strategy)\n`)
    expect(outputs[0]).toEqual(BARS.map((b) => (b.c > b.o ? 1 : 0)))
  })
})
