// app/src/components/chart/engine/runtime/__tests__/history.test.js
//
// ─── ⭐⭐⭐ 2F-2A — RUNTIME SERIES AND MUTABLE HISTORY ────────────────────────
//
// The wall 2F-1 exposed. Six of the fourteen scripts it unblocked landed here,
// and the census says the real population is 35 of 169 — one script in five.
//
// ⛔⛔ THE ONE THING THIS FILE EXISTS TO PROVE IS THAT `x[1]` IS NOT `x`.
// Reading the slot and calling it history is the shortcut every implementation
// of this reaches for, it is right on the first bar and on the first statement,
// and it is silently one bar wrong everywhere else. On `trend := trend[1] * -1`
// — SuperTrend, Chandelier, Klinger, half the state machines in the corpus —
// that is not an approximation. It is a different indicator that still draws a
// plausible line, which is the only failure this program treats as fatal.
//
// So the runtime has THREE lifetimes now, not two:
//
//   locals    this bar, live, reset at the top of every bar
//   persist   across bars, live — what `var` means
//   history   across bars, COMMITTED — what each PAST bar finally held
//
// ⛔ AND THE THIRD IS WRITTEN BY A PHASE, NEVER BY AN ASSIGNMENT. Committing
// inside STORE would make `x[1]` mean "before the most recent write", so a bar
// that assigns twice would read its own first write as history. Pine's `[]`
// counts BARS. `vm.js`'s end-of-bar commit is the only thing that advances them,
// which is also what makes this survive loops (§26) and a forming bar (§27).

import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { RuntimeLimitError } from '../limits.js'
import { translatePine } from '../../ast/pine.js'
import { parseFormula } from '../../ast/parse.js'
import { interpret } from '../../ast/interpret.js'

const N = 30
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + i, h: 102 + i, l: 98 + i, c: 100 + i, v: 1000 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'

function build(src, inputs) {
  const built = buildRuntimeIr(src, { bars: BARS, inputs: inputs || {} })
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  return built
}
function runPine(src, inputs, limits) {
  const built = build(src, inputs)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true }, limits)
  return { out: Array.from(r.outputs[0]), outs: r.outputs.map((o) => Array.from(o)), program, budget: r.budget }
}
const refusalOf = (src) => {
  const b = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}
const naAt = (xs, i) => Number.isNaN(xs[i])

describe('⭐⭐ `x[1]` over a value the runtime mutated', () => {
  it('answers the PREVIOUS bar, and `na` before there is one', () => {
    const { out } = runPine(`${head}var x = 0.0\nx := close\nplot(x[1])\n`)
    expect(naAt(out, 0)).toBe(true)
    for (let i = 1; i < N; i += 1) expect(out[i], `bar ${i}`).toBe(BARS[i - 1].c)
  })

  it('⛔⛔ IT IS NOT THE CURRENT VALUE — the whole capability in one assertion', () => {
    // The shortcut this file exists to forbid would make these two equal.
    const lagged = runPine(`${head}var x = 0.0\nx := close\nplot(x[1])\n`).out
    const live = runPine(`${head}var x = 0.0\nx := close\nplot(x)\n`).out
    expect(live[5]).toBe(BARS[5].c)
    expect(lagged[5]).toBe(BARS[4].c)
    expect(lagged[5]).not.toBe(live[5])
  })

  it('⭐ `x[0]` is `x` — and allocates NO ring', () => {
    const { out, program } = runPine(`${head}var x = 0.0\nx := close\nplot(x[0])\n`)
    for (let i = 0; i < N; i += 1) expect(out[i]).toBe(BARS[i].c)
    expect(program.history).toEqual([])
  })

  it('⭐ deeper offsets, and the ring is sized to the deepest one asked for', () => {
    const { out, program } = runPine(`${head}var x = 0.0\nx := close\nplot(x[3])\n`)
    expect(program.history[0].depth).toBe(3)
    for (let i = 0; i < 3; i += 1) expect(naAt(out, i), `bar ${i}`).toBe(true)
    for (let i = 3; i < N; i += 1) expect(out[i], `bar ${i}`).toBe(BARS[i - 3].c)
  })

  it('⭐ two depths on ONE variable share one ring, sized to the deeper', () => {
    const { outs, program } = runPine(`${head}var x = 0.0\nx := close\nplot(x[1])\nplot(x[4])\n`)
    expect(program.history).toHaveLength(1)
    expect(program.history[0].depth).toBe(4)
    expect(outs[0][10]).toBe(BARS[9].c)
    expect(outs[1][10]).toBe(BARS[6].c)
  })

  it('⛔ NO OFF-BY-ONE, checked as a whole-series identity rather than at one bar', () => {
    // ⚰️ A one-bar spot check passes for a ring that is early AND for one that is
    // late — the two errors look identical anywhere except the ends. Comparing
    // the entire lagged series against the entire live series shifted by one is
    // what actually pins it.
    const live = runPine(`${head}var x = 0.0\nx := close * 3 - 1\nplot(x)\n`).out
    const lag1 = runPine(`${head}var x = 0.0\nx := close * 3 - 1\nplot(x[1])\n`).out
    const lag2 = runPine(`${head}var x = 0.0\nx := close * 3 - 1\nplot(x[2])\n`).out
    for (let i = 1; i < N; i += 1) expect(lag1[i], `lag1 bar ${i}`).toBe(live[i - 1])
    for (let i = 2; i < N; i += 1) expect(lag2[i], `lag2 bar ${i}`).toBe(live[i - 2])
    expect(naAt(lag1, 0)).toBe(true)
    expect(naAt(lag2, 0) && naAt(lag2, 1)).toBe(true)
  })
})

describe('⭐⭐ the shape the corpus actually asked for — self-referencing state machines', () => {
  it('a run-length counter that reads its own previous bar', () => {
    const src = `${head}var run = 0.0\nrun := close > open ? nz(run[1]) + 1 : 0\nplot(run)\n`
    const { out } = runPine(src)
    let prev = 0
    for (let i = 0; i < N; i += 1) {
      const want = BARS[i].c > BARS[i].o ? prev + 1 : 0
      expect(out[i], `bar ${i}`).toBe(want)
      prev = want
    }
  })

  it('⭐⭐ a direction flip — the SuperTrend/Chandelier shape', () => {
    const src = `${head}var dir = 1.0\ndir := close > 115 ? 1 : close < 105 ? -1 : nz(dir[1], 1)\nplot(dir)\n`
    const { out } = runPine(src)
    let prev = 1
    for (let i = 0; i < N; i += 1) {
      const c = BARS[i].c
      const want = c > 115 ? 1 : c < 105 ? -1 : prev
      expect(out[i], `bar ${i}`).toBe(want)
      prev = want
    }
    // non-vacuity: the fixture must actually exercise all three arms
    expect(out.includes(1) && out.includes(-1)).toBe(true)
  })

  it('⭐ a two-bar look-back state machine (the one script at depth 2)', () => {
    const src = `${head}var s = 0.0\ns := close + nz(s[2])\nplot(s)\n`
    const { out } = runPine(src)
    const want = []
    for (let i = 0; i < N; i += 1) want.push(BARS[i].c + (i >= 2 ? want[i - 2] : 0))
    expect(out).toEqual(want)
  })
})

describe('⭐⭐ end-of-bar commit — WHICH value a bar contributes', () => {
  it('⛔⛔ the bar\'s FINAL value, not the value at the moment `[1]` is written', () => {
    // Three writes on one bar. If the commit happened per-assignment, `x[1]`
    // would read 1 or 2 — program order masquerading as bar history.
    const { out } = runPine(`${head}var x = 0.0\nx := 1\nx := 2\nx := 3\nplot(x[1])\n`)
    expect(naAt(out, 0)).toBe(true)
    for (let i = 1; i < N; i += 1) expect(out[i], `bar ${i}`).toBe(3)
  })

  it('⛔ a mutation AFTER the history read still decides what that bar commits', () => {
    // `y` reads x[1] early, then x is written again. The read must see the
    // previous bar; the later write must be what the NEXT bar sees.
    const src = `${head}var x = 0.0\nx := 10\ny = nz(x[1], -1)\nx := 99\nplot(y)\n`
    const { out } = runPine(src)
    expect(out[0]).toBe(-1)
    for (let i = 1; i < N; i += 1) expect(out[i], `bar ${i}`).toBe(99)
  })

  it('⭐ a conditional write — a bar that does not assign still commits what it holds', () => {
    const src = `${head}var x = 0.0\nif close > 110\n    x := close\nplot(x[1])\n`
    const { out } = runPine(src)
    let held = 0
    const want = []
    for (let i = 0; i < N; i += 1) {
      want.push(i === 0 ? NaN : held)
      if (BARS[i].c > 110) held = BARS[i].c
    }
    for (let i = 0; i < N; i += 1) {
      if (Number.isNaN(want[i])) expect(naAt(out, i), `bar ${i}`).toBe(true)
      else expect(out[i], `bar ${i}`).toBe(want[i])
    }
  })
})

describe('⭐⭐ history is NOT persistence (§21)', () => {
  it('a bar-local variable has history AND still resets every bar', () => {
    // `x` is not `var`. It is re-declared each bar, so its live value on a bar
    // where the branch does not fire is the declaration's 0 — while `x[1]`
    // still reports what the PREVIOUS bar finally held.
    const src = `${head}x = 0.0\nif close > 110\n    x := close\nplot(x)\nplot(nz(x[1], -1))\n`
    const { outs, program } = runPine(src)
    expect(program.history).toHaveLength(1)
    expect(program.history[0].persist).toBe(false)   // a LOCAL bears history
    let prev = -1
    for (let i = 0; i < N; i += 1) {
      const live = BARS[i].c > 110 ? BARS[i].c : 0
      expect(outs[0][i], `live bar ${i}`).toBe(live)
      expect(outs[1][i], `hist bar ${i}`).toBe(prev)
      prev = live
    }
    // ⛔ NON-VACUITY: the local must actually have fallen back to 0 somewhere.
    // Without that, "it reset" and "it persisted" produce the same series and the
    // assertion above would pass for the defect it exists to catch.
    expect(outs[0].includes(0)).toBe(true)
  })

  it('⛔ a `var` and a bar-local diverge — on a bar chosen so they CAN', () => {
    // ⚰️ The first version compared the LAST bar of a `close > 110` condition
    // that is true at the end, so both lanes read the same number and the
    // assertion passed for the wrong reason on the way to failing for it. The
    // condition here fires EARLY and stops, so after bar 9 the `var` still holds
    // its last write and the bar-local is back to its declaration.
    const cond = `${head}%%x = 0.0\nif close < 110\n    x := close\nplot(x)\n`
    const local = runPine(cond.replace('%%', '')).out
    const kept = runPine(cond.replace('%%', 'var ')).out
    for (let i = 0; i < 10; i += 1) expect(local[i], `both, bar ${i}`).toBe(kept[i])
    for (let i = 10; i < N; i += 1) {
      expect(local[i], `local, bar ${i}`).toBe(0)
      expect(kept[i], `var, bar ${i}`).toBe(109)
    }
  })
})

describe('⭐ historical `na` is a real value, not an absent bar', () => {
  it('a bar that committed `na` reads back as `na`', () => {
    const src = `${head}var x = 0.0\nx := close > 110 ? close : na\nplot(x[1])\n`
    const { out } = runPine(src)
    for (let i = 1; i < N; i += 1) {
      const prev = BARS[i - 1].c > 110 ? BARS[i - 1].c : NaN
      if (Number.isNaN(prev)) expect(naAt(out, i), `bar ${i}`).toBe(true)
      else expect(out[i], `bar ${i}`).toBe(prev)
    }
    // the fixture must contain both kinds of historical bar
    expect(out.some((v) => Number.isNaN(v))).toBe(true)
    expect(out.some((v) => !Number.isNaN(v))).toBe(true)
  })

  it('⭐ `nz` over history distinguishes nothing — which is Pine, and is the point', () => {
    // Warm-up and a committed `na` both read `na`, so `nz` answers 0 for both.
    // The runtime tracks them apart anyway (`histPresent`), because a finite
    // window's warm-up needs the difference and NaN cannot carry it.
    const { out } = runPine(`${head}var x = 0.0\nx := close > 110 ? close : na\nplot(nz(x[1], -7))\n`)
    expect(out[0]).toBe(-7)
    expect(out[1]).toBe(-7)
  })
})

describe('⭐⭐ graph-vs-runtime differential for history (§30)', () => {
  // Where the SAME history is expressible in both lanes, they must agree — this
  // is what proves the ring did not acquire its own idea of what `[n]` means.
  const CASES = ['close * 2', 'close - open', '(high + low) / 2', 'close * close']
  for (const e of CASES) {
    for (const back of [1, 2]) {
      it(`⭐ (${e})[${back}] agrees with the columnar lane`, () => {
        // runtime lane: force it off the pure path by routing through state
        const { out } = runPine(`${head}var x = 0.0\nx := ${e}\nplot(x[${back}])\n`)
        // columnar lane: the SHIPPED door's own translation of the same thing
        const t = translatePine(`${head}plot((${e})[${back}])\n`)
        expect(t.ok, JSON.stringify(t.refusal || {})).toBe(true)
        const parsed = parseFormula(t.outputs[0].formula)
        expect(parsed.ok).toBe(true)
        const col = interpret(parsed.ast, BARS, {})
        for (let i = 0; i < N; i += 1) {
          const a = typeof col === 'number' ? col : col[i]
          if (Number.isNaN(a)) expect(naAt(out, i), `bar ${i}`).toBe(true)
          else expect(out[i], `bar ${i}`).toBeCloseTo(a, 12)
        }
      })
    }
  }
})

describe('⭐ static demand analysis and resource accounting (§16/§28)', () => {
  it('only a value somebody looks back at gets a ring', () => {
    const { program } = runPine(`${head}var a = 0.0\nvar b = 0.0\na := close\nb := close * 2\nplot(a[1] + b)\n`)
    expect(program.history.map((h) => h.name)).toEqual(['a'])
  })

  it('⭐ HISTORY_SLOTS and HISTORY_VALUES are charged, and VALUES is the product', () => {
    const { budget } = runPine(`${head}var a = 0.0\nvar b = 0.0\na := close\nb := open\nplot(a[3] + b[2])\n`)
    expect(budget.counts.HISTORY_SLOTS).toBe(2)
    expect(budget.counts.HISTORY_VALUES).toBe(5)   // 3 + 2, not 2 slots and not 6
  })

  it('⛔ a history ceiling stops BY NAME, never by quietly answering `na`', () => {
    let err = null
    try { runPine(`${head}var x = 0.0\nx := close\nplot(x[5])\n`, {}, { HISTORY_VALUES: 4 }) } catch (e) { err = e }
    expect(err).toBeInstanceOf(RuntimeLimitError)
    expect(err.limit).toBe('HISTORY_VALUES')
    // the control: one more cell of headroom and the same script runs
    expect(() => runPine(`${head}var x = 0.0\nx := close\nplot(x[5])\n`, {}, { HISTORY_VALUES: 5 })).not.toThrow()
  })
})

describe('⭐⭐ the three offset tiers (§18) — measured, not assumed', () => {
  it('a LITERAL offset works', () => {
    expect(runPine(`${head}var x = 0.0\nx := close\nplot(x[2])\n`).out[5]).toBe(BARS[3].c)
  })

  it('⭐⭐ an INPUT-DERIVED offset folds to a constant, as it already does in the pure lane', () => {
    // `currentState[fwdBars]` is a real shape in the corpus. A knob is a constant
    // the moment inputs are bound, and folding it here is what keeps a member's
    // setting meaning the same thing in a column and in the runtime.
    const src = `${head}n = input.int(3, "Look back")\nvar x = 0.0\nx := close\nplot(x[n])\n`
    const { out, program } = runPine(src)
    expect(program.history[0].depth).toBe(3)
    expect(out[10]).toBe(BARS[7].c)

    // ⚠️⚠️ AND WHAT IS FROZEN IS THE INPUT'S **DEFAULT**, NOT A LATER OVERRIDE —
    // which is `pine.js`'s existing, deliberate behaviour, not a gap this wave
    // introduced. Its `parseOffsetIndex` records the owner decision of
    // 2026-08-11 verbatim: folding an input "freezes its default into the saved
    // definition — and that is ALREADY true of every length, so folding the
    // offset makes the two agree rather than introducing a new surprise."
    //
    // ⚰️ THIS TEST FIRST ASSERTED THE OPPOSITE and failed, which is the useful
    // outcome: an override that silently changed a ring's depth would make a
    // knob mean one thing in a column and another in the runtime — the exact
    // divergence the frozen-default rule exists to prevent. Pinning the real
    // behaviour here is what stops someone "fixing" it on one side only.
    const { out: out5, program: p5 } = runPine(src, { n: 5 })
    expect(p5.history[0].depth).toBe(3)
    expect(out5[10]).toBe(BARS[7].c)
  })

  it('⛔ a RUNTIME-DERIVED offset refuses by name rather than answering `na`', () => {
    const r = refusalOf(`${head}var x = 0.0\nx := close\nplot(x[bar_index % 3])\n`)
    expect(r.guard).toBe('runtime:history-dynamic-offset')
    expect(r.message).toMatch(/bounded/)
  })
})

describe('⛔ what 2F-2A does NOT do — every wall named', () => {
  it('history over an EXPRESSION containing state', () => {
    expect(refusalOf(`${head}var x = 0.0\nx := close\nplot((x + 1)[1])\n`).guard)
      .toBe('runtime:history-expression')
  })

  it('⭐ history over a FUNCTION-LOCAL value now EXECUTES — see udfHistory.test.js', () => {
    // ⚰️ This was a refusal until P7.2. The wall it named is gone; what remains
    // in THIS file is top-level history, and the frame case has its own suite.
    expect(() => runPine(`${head}f(v) =>\n    var c = 0.0\n    c := c + v\n    c[1]\nplot(f(1))\n`)).not.toThrow()
    expect(() => runPine(`${head}var c = 0.0\nc := c + 1\nplot(c[1])\n`)).not.toThrow()
  })

  it('a WINDOWED builtin over runtime state is still refused — no fake column', () => {
    // ⛔ THE RING IS NOT A SERIES BRIDGE. `sma(x, 5)` needs the window semantics
    // the closed table already owns, fed by a real runtime series — 2F-2B. Feeding
    // it a synthetic column materialised from the ring would be a second
    // implementation of a settled builtin, which is the one thing this
    // architecture refuses on principle.
    expect(refusalOf(`${head}var x = 0.0\nx := close\nplot(ta.sma(x, 5))\n`).guard)
      .toBe('runtime:call-windowed-state')
  })
})
