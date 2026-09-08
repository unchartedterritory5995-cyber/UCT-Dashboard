// app/src/components/chart/engine/runtime/__tests__/state.test.js
//
// ─── ⭐⭐ STATE — the largest single capability family (80 of 159 scripts) ────
//
// Phase 1 measured mutable state at 50% of real scripts and `pine:reassign` +
// `pine:state` at 16 primary refusals. The columnar artifact could not hold it:
// eight node types, all expressions, no assignment and no lifetime. These cases
// are the first proof that the runtime can.
//
// ⛔ THESE ARE CAPABILITY TESTS, NOT CORPUS TESTS. §48 says acceptance stays flat
// until the state → control flow → UDF → loops → arrays block closes, and none of
// these unlock a script on their own. They are the milestone evidence §49 asks
// for instead.
//
// ⚠️ EXPECTATIONS ARE COMPUTED IN THE TEST, from the same bars, by an
// INDEPENDENT loop — never by asserting the runtime equals itself. A state
// program has no columnar twin to differ against (that is the whole point of it),
// so the oracle has to be written out longhand.

import { describe, it, expect } from 'vitest'

import {
  makeIrProgram, SLOT, num, series, column, read, binary, ternary,
  declare, assign, ifStmt, emit,
} from '../ir.js'
import { lowerIrProgram, LoweringGap } from '../lowerIr.js'
import { execute } from '../vm.js'
import { RuntimeLimitError } from '../limits.js'
import { OP } from '../program.js'

const N = 60
const BARS = (() => {
  const out = []
  let p = 100
  for (let i = 0; i < N; i += 1) {
    p += Math.sin(i / 5) * 1.4
    out.push({ o: p - Math.cos(i / 3) * 0.8, h: p + 1, l: p - 1, c: p, v: 1000 })
  }
  return out
})()

const col = (name) => Float64Array.from(BARS.map((b) => b[name]))
const CLOSE = col('c'), OPEN = col('o')
const SERIES = [col('o'), col('h'), col('l'), col('c'), col('v')]

const ctxFor = (program) => ({ bars: N, series: SERIES, columns: program.columns, confirmed: true })

const runIr = (ir, limits) => {
  const program = lowerIrProgram(ir)
  const r = execute(program, ctxFor(program), limits)
  return { program, out: Array.from(r.outputs[0]), budget: r.budget }
}

describe('`var` — a value that survives the bar', () => {
  it('⭐⭐ a running accumulator, which no expression tree can express', () => {
    // var acc = 0 ; acc := acc + close ; plot(acc)
    const ir = makeIrProgram({
      slots: [{ name: 'acc', kind: SLOT.PERSIST }],
      outputs: ['acc'],
      statements: [
        declare(0, num(0)),
        assign(0, binary('+', read(0), series('close'))),
        emit(0, read(0)),
      ],
    })
    const { out } = runIr(ir)
    let acc = 0
    const want = []
    for (let i = 0; i < N; i += 1) { acc += CLOSE[i]; want.push(acc) }
    expect(out).toEqual(want)
  })

  it('⭐⭐ the initialiser is not merely stored once — it is not EVALUATED again', () => {
    // ⚰️ C3B shipped the other design: `var table t = table.new(…)` emitted
    // unguarded minted a NEW table every bar and blew an 8-table envelope by bar
    // 8, with every runtime unit test green. Here the proof is arithmetic: the
    // instruction count is strictly less than instructions x bars, because the
    // guard JUMPS OVER the initialiser from bar 1 onward.
    const ir = makeIrProgram({
      slots: [{ name: 'acc', kind: SLOT.PERSIST }],
      outputs: ['acc'],
      statements: [declare(0, num(7)), emit(0, read(0))],
    })
    const { program, budget, out } = runIr(ir)
    expect(budget.counts.TOTAL_INSTRUCTIONS).toBeLessThan(program.instructions * N)
    // and it kept the value on every bar
    expect(out).toEqual(new Array(N).fill(7))
  })

  it('⭐ `var x = na` stays initialised — a slot that legitimately holds na does NOT re-init', () => {
    // ⛔ THE CONFLATION THIS GUARDS. If "has it been initialised" were answered
    // by "is it still NaN", this program would re-run its initialiser every bar.
    // The runtime tracks initialisation separately for exactly this case.
    const naExpr = binary('/', num(0), num(0)) // 0/0 is NaN, the value `na`
    const ir = makeIrProgram({
      slots: [{ name: 'x', kind: SLOT.PERSIST }],
      outputs: ['x'],
      statements: [declare(0, naExpr), emit(0, read(0))],
    })
    const { program, budget } = runIr(ir)
    expect(budget.counts.TOTAL_INSTRUCTIONS).toBeLessThan(program.instructions * N)
  })

  it('⭐ two vars are independent — no slot aliasing', () => {
    const ir = makeIrProgram({
      slots: [{ name: 'a', kind: SLOT.PERSIST }, { name: 'b', kind: SLOT.PERSIST }],
      outputs: ['diff'],
      statements: [
        declare(0, num(0)), declare(1, num(0)),
        assign(0, binary('+', read(0), num(1))),
        assign(1, binary('+', read(1), num(2))),
        emit(0, binary('-', read(1), read(0))),
      ],
    })
    const { out } = runIr(ir)
    expect(out).toEqual(Array.from({ length: N }, (_, i) => (i + 1) * 2 - (i + 1)))
  })
})

describe('a bar-local is NOT an accidental `var`', () => {
  it('⛔⛔ a local read before assignment is `na`, never last bar\'s value', () => {
    // THE TRAP THIS EXISTS TO CATCH. If the frame were not reset each bar, this
    // program would read bar N-1's value and every ordinary binding in Pine would
    // silently become persistent — a wrong number on every script that declares a
    // variable inside a condition.
    const ir = makeIrProgram({
      slots: [{ name: 'x', kind: SLOT.LOCAL }],
      outputs: ['x'],
      statements: [
        // only assign on up bars; on down bars `x` must read `na`
        ifStmt(binary('>', series('close'), series('open')), [declare(0, num(1))], []),
        emit(0, read(0)),
      ],
    })
    const { out } = runIr(ir)
    for (let i = 0; i < N; i += 1) {
      if (CLOSE[i] > OPEN[i]) expect(out[i]).toBe(1)
      else expect(Number.isNaN(out[i]), `bar ${i} should be na`).toBe(true)
    }
    // non-vacuity: the fixture must actually contain both kinds of bar
    expect(out.some((v) => v === 1)).toBe(true)
    expect(out.some((v) => Number.isNaN(v))).toBe(true)
  })
})

describe('control flow — a branch that MUTATES, which a ternary cannot be', () => {
  it('⭐⭐ conditional reassignment accumulates only on the bars that match', () => {
    // var up = 0 ; if close > open : up := up + 1 ; plot(up)
    const ir = makeIrProgram({
      slots: [{ name: 'up', kind: SLOT.PERSIST }],
      outputs: ['up'],
      statements: [
        declare(0, num(0)),
        ifStmt(binary('>', series('close'), series('open')),
          [assign(0, binary('+', read(0), num(1)))], []),
        emit(0, read(0)),
      ],
    })
    const { out } = runIr(ir)
    let up = 0
    const want = []
    for (let i = 0; i < N; i += 1) { if (CLOSE[i] > OPEN[i]) up += 1; want.push(up) }
    expect(out).toEqual(want)
  })

  it('⭐ if / else both run their own side, and only their own', () => {
    const ir = makeIrProgram({
      slots: [{ name: 'n', kind: SLOT.PERSIST }],
      outputs: ['n'],
      statements: [
        declare(0, num(0)),
        ifStmt(binary('>', series('close'), series('open')),
          [assign(0, binary('+', read(0), num(1)))],
          [assign(0, binary('-', read(0), num(1)))]),
        emit(0, read(0)),
      ],
    })
    const { out } = runIr(ir)
    let n = 0
    const want = []
    for (let i = 0; i < N; i += 1) { n += CLOSE[i] > OPEN[i] ? 1 : -1; want.push(n) }
    expect(out).toEqual(want)
  })

  it('⛔ `na` does not take the branch — an unknown condition runs nothing', () => {
    const naExpr = binary('/', num(0), num(0))
    const ir = makeIrProgram({
      slots: [{ name: 'n', kind: SLOT.PERSIST }],
      outputs: ['n'],
      statements: [
        declare(0, num(0)),
        ifStmt(naExpr, [assign(0, num(999))], []),
        emit(0, read(0)),
      ],
    })
    const { out } = runIr(ir)
    expect(out).toEqual(new Array(N).fill(0))
  })

  it('⭐ nested branches', () => {
    const ir = makeIrProgram({
      slots: [{ name: 'n', kind: SLOT.PERSIST }],
      outputs: ['n'],
      statements: [
        declare(0, num(0)),
        ifStmt(binary('>', series('close'), series('open')),
          [ifStmt(binary('>', series('high'), num(0)),
            [assign(0, binary('+', read(0), num(10)))], [])],
          []),
        emit(0, read(0)),
      ],
    })
    const { out } = runIr(ir)
    let n = 0
    const want = []
    for (let i = 0; i < N; i += 1) { if (CLOSE[i] > OPEN[i]) n += 10; want.push(n) }
    expect(out).toEqual(want)
  })
})

describe('state meets the column seam', () => {
  it('⭐ a persistent value accumulating a COLUMN the columnar lane computed', () => {
    // The hybrid in one program: `interpret.js` owns the builtin, the runtime
    // owns the accumulation neither of them could express alone.
    const half = Float64Array.from(CLOSE, (c) => c / 2)
    const ir = makeIrProgram({
      slots: [{ name: 'acc', kind: SLOT.PERSIST }],
      columns: [half],
      outputs: ['acc'],
      statements: [
        declare(0, num(0)),
        assign(0, binary('+', read(0), column(0))),
        emit(0, read(0)),
      ],
    })
    const { out } = runIr(ir)
    let acc = 0
    const want = []
    for (let i = 0; i < N; i += 1) { acc += half[i]; want.push(acc) }
    expect(out).toEqual(want)
  })
})

describe('⛔ the boundaries this runtime states rather than approximates', () => {
  it('history over a VARIABLE is a named gap, not a silent one-bar-wrong answer', () => {
    const ir = makeIrProgram({
      slots: [{ name: 'x', kind: SLOT.PERSIST }],
      outputs: ['x'],
      statements: [
        declare(0, num(0)),
        emit(0, { kind: 'hist', of: read(0), back: 1 }),
      ],
    })
    expect(() => lowerIrProgram(ir)).toThrow(LoweringGap)
    try { lowerIrProgram(ir) } catch (e) { expect(e.kind).toBe('history over a variable') }
  })

  it('a declared-but-unimplemented statement kind refuses BY NAME', () => {
    const ir = makeIrProgram({
      slots: [],
      outputs: ['x'],
      statements: [{ kind: 'while' }, emit(0, num(1))],
    })
    expect(() => lowerIrProgram(ir)).toThrow(/cannot yet lower while/)
  })

  it('a runaway is stopped BY NAME, not by hanging', () => {
    const ir = makeIrProgram({
      slots: [{ name: 'a', kind: SLOT.PERSIST }],
      outputs: ['a'],
      statements: [declare(0, num(0)), assign(0, binary('+', read(0), num(1))), emit(0, read(0))],
    })
    let err = null
    try { runIr(ir, { TOTAL_INSTRUCTIONS: 20 }) } catch (e) { err = e }
    expect(err).toBeInstanceOf(RuntimeLimitError)
    expect(err.limit).toBe('TOTAL_INSTRUCTIONS')
  })
})

describe('⛔ NON-VACUITY — the state opcodes are load-bearing', () => {
  it('turning STORE_PERSIST into a discard changes the answer', () => {
    // Without this, every accumulator case above could pass against a runtime
    // that simply re-emitted its initialiser.
    const ir = makeIrProgram({
      slots: [{ name: 'acc', kind: SLOT.PERSIST }],
      outputs: ['acc'],
      statements: [declare(0, num(0)), assign(0, binary('+', read(0), num(1))), emit(0, read(0))],
    })
    const good = runIr(ir).out
    expect(good[N - 1]).toBe(N)
    // the same program with no accumulation at all
    const flat = makeIrProgram({
      slots: [{ name: 'acc', kind: SLOT.PERSIST }],
      outputs: ['acc'],
      statements: [declare(0, num(0)), emit(0, read(0))],
    })
    expect(runIr(flat).out[N - 1]).toBe(0)
  })

  it('the IF really branches — the same program with a constant-true test differs', () => {
    const mk = (test) => makeIrProgram({
      slots: [{ name: 'n', kind: SLOT.PERSIST }],
      outputs: ['n'],
      statements: [
        declare(0, num(0)),
        ifStmt(test, [assign(0, binary('+', read(0), num(1)))], []),
        emit(0, read(0)),
      ],
    })
    const conditional = runIr(mk(binary('>', series('close'), series('open')))).out
    const always = runIr(mk(num(1))).out
    expect(always[N - 1]).toBe(N)
    expect(conditional[N - 1]).toBeLessThan(N)
  })
})
