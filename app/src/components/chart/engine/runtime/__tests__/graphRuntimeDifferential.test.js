// app/src/components/chart/engine/runtime/__tests__/graphRuntimeDifferential.test.js
//
// ─── ⭐⭐ THE GRAPH-vs-RUNTIME DIFFERENTIAL RAIL (Phase 2 §12) ───────────────
//
// THE HARD PREREQUISITE. Before the bar-by-bar runtime is authoritative for
// anything, every program representable in BOTH lanes must produce the same
// series. One canonical tree, two executions: `interpret.js` evaluates it as
// whole-series columns, `vm.js` walks it one bar at a time.
//
// ⛔ ITS PURPOSE IS NOT TO PROVE THE RUNTIME WORKS. It is to stop the runtime
// from quietly becoming a SECOND INTERPRETATION of Pine behaviour that is already
// settled and vendor-pinned — the same defect Phase 1's `%` lowering refused to
// create when it declined to mint a second `mod`.
//
// ⭐ WHAT IT CAN AND CANNOT CATCH, STATED PLAINLY. The scalar operators are
// IMPORTED by `vm.js` from `interpret.js`, so arithmetic and the NaN rules agree
// BY CONSTRUCTION rather than by test — that class of divergence was removed
// rather than measured. What remains genuinely different between a whole-series
// pass and a per-bar walk is what this file is pointed at: history indexing,
// warm-up NaN patterns, evaluation order, column alignment and emit placement.
// The mutation controls at the bottom prove it can see each of those.
//
// ⚠️ BARS ARE SYNTHETIC AND DETERMINISTIC. This rail is about two lanes agreeing
// on the same input, not about market realism; a fixture series would add a
// dependency without adding a question.

import { describe, it, expect } from 'vitest'

import { parseFormula } from '../../ast/parse.js'
import { interpret } from '../../ast/interpret.js'
import { lowerTree, contextForProgram } from '../lower.js'
import { execute } from '../vm.js'
import { makeProgram, OP } from '../program.js'

const N = 240
const BARS = (() => {
  const out = []
  let p = 100
  for (let i = 0; i < N; i += 1) {
    p += Math.sin(i / 7) * 0.9 + Math.cos(i / 13) * 0.35
    const o = p - 0.2, h = p + 0.6, l = p - 0.7, c = p
    out.push({ t: 1700000000 + i * 86400, o, h, l, c, v: 1000 + (i % 17) * 90 })
  }
  return out
})()

const treeOf = (formula) => {
  const r = parseFormula(formula)
  expect(r.ok, `${formula} did not parse: ${r.error}`).toBe(true)
  return r.ast
}

/** Run one formula down BOTH lanes. */
function bothLanes(formula, inputs) {
  const ast = treeOf(formula)
  const columnar = interpret(ast, BARS, inputs || {})
  const program = lowerTree(ast, BARS, inputs || {})
  const ctx = contextForProgram(program, BARS)
  const { outputs } = execute(program, ctx)
  return { columnar: Array.from(columnar), runtime: Array.from(outputs[0]), program }
}

/** ⛔ BIT-IDENTICAL, NOT 1e-9 — AND THAT IS THE STRONGER CLAIM ON PURPOSE.
 *  The lanes share their scalar operators, so any difference at all is a
 *  structural one (a shifted history read, a misaligned column, a bar the walk
 *  skipped). Accepting 1e-9 here would let a genuine off-by-one hide inside a
 *  slowly-varying series. The NaN pattern is compared separately because
 *  `NaN === NaN` is false and a mismatch there is the warm-up defect this rail
 *  most wants to catch. */
function expectLanesIdentical(formula, inputs) {
  const { columnar, runtime } = bothLanes(formula, inputs)
  expect(runtime.length).toBe(columnar.length)
  const nanA = columnar.map(Number.isNaN)
  const nanB = runtime.map(Number.isNaN)
  expect(nanB, `${formula}: NaN pattern differs`).toEqual(nanA)
  for (let i = 0; i < columnar.length; i += 1) {
    if (Number.isNaN(columnar[i])) continue
    expect(runtime[i], `${formula}: bar ${i}`).toBe(columnar[i])
  }
}

describe('one tree, two lanes, one answer', () => {
  const CASES = [
    ['arithmetic', 'close * 2 + open / 3 - low'],
    ['precedence and parens', '(high - low) * (close - open) / 2'],
    ['unary minus', '-close + 5'],
    ['comparison — and its NaN rule answers 0, not na', 'close > open'],
    ['boolean conjunction', 'close > open && high > low'],
    ['boolean disjunction', 'close < open || high > low'],
    ['negation', '!(close > open)'],
    ['ternary', 'close > open ? high : low'],
    ['nested ternary', 'close > open ? (high > low ? 1 : 2) : 3'],
    ['history — one bar', 'close[1]'],
    ['history — deep', 'close[20]'],
    ['history in arithmetic', '(close - close[1]) / close[1]'],
    ['history of two series', 'high[2] - low[3]'],
    ['a builtin, through the column seam', 'sma(close, 10)'],
    ['a warming builtin', 'rsi(close, 14)'],
    ['two builtins compared', 'sma(close, 10) > sma(close, 20)'],
    ['a builtin under an offset', 'sma(close, 10)[2]'],
    ['builtin inside arithmetic', 'close - sma(close, 30)'],
    ['a shared subtree, twice', 'sma(close, 10) + sma(close, 10)'],
    ['division by a zero it computes itself', 'close / (close - close)'],
    ['volume, the fifth series', 'volume / 1000'],
  ]

  for (const [label, formula] of CASES) {
    it(`⭐ ${label} — \`${formula}\``, () => {
      expectLanesIdentical(formula)
    })
  }

  it('⭐ a member input reaches both lanes as the SAME value', () => {
    // ⚰️ The C3B defect this guards against: one lane honoured a declared input
    // and the other folded its default, so a plot and a line disagreed about the
    // same knob. Here the input travels through the column seam, and the rail
    // asserts the two lanes read one value.
    expectLanesIdentical('close * len', { len: 3 })
    expectLanesIdentical('sma(close, 10) * mult', { mult: 2.5 })
  })

  it('⛔ the runtime really did walk bar by bar — it charges per-bar instructions', () => {
    const { program } = bothLanes('close * 2 + open')
    const ctx = contextForProgram(program, BARS)
    const { budget } = execute(program, ctx)
    expect(budget.counts.TOTAL_INSTRUCTIONS).toBe(program.instructions * N)
    expect(budget.counts.INSTRUCTIONS_PER_BAR).toBe(program.instructions)
  })
})

describe('⛔ NON-VACUITY — the rail can see each divergence it exists to catch', () => {
  /** Build the program for `formula`, then corrupt ONE thing about it. */
  const corrupt = (formula, fn) => {
    const ast = treeOf(formula)
    const columnar = Array.from(interpret(ast, BARS, {}))
    const good = lowerTree(ast, BARS, {})
    const code = Array.from(good.code)
    fn(code, good)
    const bad = makeProgram({
      code,
      consts: Array.from(good.consts),
      columns: good.columns,
      outputs: good.outputs.slice(),
    })
    const { outputs } = execute(bad, contextForProgram(bad, BARS))
    return { columnar, runtime: Array.from(outputs[0]) }
  }

  const differs = ({ columnar, runtime }) => {
    for (let i = 0; i < columnar.length; i += 1) {
      if (Number.isNaN(columnar[i]) !== Number.isNaN(runtime[i])) return true
      if (!Number.isNaN(columnar[i]) && columnar[i] !== runtime[i]) return true
    }
    return false
  }

  it('a history read shifted by one bar is CAUGHT', () => {
    const r = corrupt('close[3]', (code) => {
      for (let pc = 0; pc * 3 < code.length; pc += 1) {
        if (code[pc * 3] === OP.READ_HIST) code[pc * 3 + 2] += 1
      }
    })
    expect(differs(r)).toBe(true)
  })

  it('a history read that CLAMPS instead of answering na is CAUGHT', () => {
    // The most dangerous corruption in the set: it changes only the warm-up
    // bars, where a slowly-varying series makes the numbers look plausible.
    const ast = treeOf('close[20]')
    const columnar = Array.from(interpret(ast, BARS, {}))
    const p = lowerTree(ast, BARS, {})
    const ctx = contextForProgram(p, BARS)
    const { outputs } = execute(p, ctx)
    const clamped = Array.from(outputs[0]).map((v, i) => (Number.isNaN(v) ? p.columns[0][0] : v))
    expect(differs({ columnar, runtime: clamped })).toBe(true)
  })

  it('a swapped operator is CAUGHT', () => {
    const r = corrupt('close - open', (code) => {
      for (let pc = 0; pc * 3 < code.length; pc += 1) {
        if (code[pc * 3] === OP.SUB) code[pc * 3] = OP.ADD
      }
    })
    expect(differs(r)).toBe(true)
  })

  it('a ternary with its branches swapped is CAUGHT', () => {
    const r = corrupt('close > open ? high : low', (code, good) => {
      // swap the two READ_SERIES that feed SELECT
      const reads = []
      for (let pc = 0; pc * 3 < code.length; pc += 1) {
        if (code[pc * 3] === OP.READ_SERIES) reads.push(pc)
      }
      const a = reads[reads.length - 2], b = reads[reads.length - 1]
      const t = code[a * 3 + 1]; code[a * 3 + 1] = code[b * 3 + 1]; code[b * 3 + 1] = t
      expect(good.instructions).toBeGreaterThan(3)
    })
    expect(differs(r)).toBe(true)
  })

  it('⛔ and the CONTROL — an untouched program does NOT differ', () => {
    // Without this, every mutation above would "pass" against a comparison that
    // reports a difference no matter what it is handed.
    const r = corrupt('close - open', () => {})
    expect(differs(r)).toBe(false)
  })
})
