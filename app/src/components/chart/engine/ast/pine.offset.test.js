// 🔴 THE BAR OFFSET — `close[1]`, the most-used construct in Pine.
//
// ⭐⭐ TWO LANES HAD TO MEET FOR THIS TO WORK AND NEITHER OWNS THE OTHER. The
// engine owns the node: `parse.js` declares a FIFTH canonical type,
// `{type: 'offset', value: <integer ≥ 0>, args: [child]}`, and the bar count IS
// the node rather than an argument to it — which is what makes "the offset is a
// constant" true BY CONSTRUCTION and keeps `maxLookback(ast)` a TREE SUM. This
// module owns the Pine side: reading `[n]`, refusing a variable or a negative
// index at parse, and emitting that node.
//
// ⛔ AND THE SEAM BETWEEN THEM IS DISCOVERED, NOT ASSUMED. `barOffsetNode` asks
// `NODE_TYPES` whether the engine has an offset at all, so this module carried a
// named refusal that pointed at its own dependency for as long as the node did
// not exist, and lit up the moment it did — with no version check, no flag and no
// `try/catch`. The last case in this file asserts that seam is still a seam.
//
// ⛔ THE CONSTRAINTS ARE ASSERTED ON BOTH SIDES ON PURPOSE. Pine's own rules and
// the engine's are not the same rules — Pine forbids `close[1][2]` and the engine
// permits it — so a case that only checked one lane would let a divergence
// through in whichever direction nobody looked.

import { describe, it, expect } from 'vitest'
import { translatePine, treeYieldsBool } from './pine.js'
import { parseFormula, astHash, NODE_TYPES } from './parse.js'
import { maxLookback, lintRepaint } from './lint.js'

const wrap = (body) => `//@version=5\nindicator("t")\nplot(${body})\n`
const translate = (body) => translatePine(wrap(body))

function formula(body) {
  const out = translate(body)
  const row = out.outputs[out.selected]
  expect(row && row.formula, JSON.stringify(out.refusal)).toBeTruthy()
  return row
}

function refusal(body) {
  const out = translate(body)
  expect(out.ok, `expected a refusal, got ${out.outputs[out.selected]?.formula}`).toBe(false)
  return out.refusal
}

// --------------------------------------------------------------------------- //
// what a member may write
// --------------------------------------------------------------------------- //

describe('the offset a member may write', () => {
  it('a variable index is refused — a window that moves cannot be bounded', () => {
    const out = translatePine('//@version=5\nindicator("t")\nn = 3\nplot(close[n])\n')
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:offset-literal')
    expect(out.refusal.line).toBe(4)
    expect(out.refusal.column).toBe(12)
    expect(out.refusal.token).toBe('n')
  })

  it('a computed index is refused for the same reason, and names the OFFSET rule', () => {
    // ⚠️ The literal is the first token of `1 + 1`, so a guard that only looked at
    // the first token would report "this line is not a shape the translator reads"
    // and send a member hunting for a typo.
    expect(refusal('close[1 + 1]').guard).toBe('pine:offset-literal')
  })

  it('a fractional index is refused', () => {
    expect(refusal('close[1.5]').guard).toBe('pine:offset-literal')
  })

  it('⭐ a NEGATIVE index is refused by its OWN name — it reads a bar that has not happened', () => {
    const r = refusal('close[-1]')
    expect(r.guard).toBe('pine:offset-negative')
    expect(r.message).toContain('[-1]')
    // ⛔ THE POINT OF THE SEPARATE GUARD: this is the construction the repaint
    // record names, and it must be INEXPRESSIBLE rather than merely discouraged.
    expect(r.message).toContain('forwards')
  })

  it('...and the ENGINE refuses it independently, so neither lane is the only guard', () => {
    const direct = parseFormula('close[-1]')
    expect(direct.ok).toBe(false)
    expect(direct.guard).toBe('canonicalise:offset-forward')
  })

  it('two applications on one value are refused, exactly as Pine itself rules', () => {
    // ⚠️ A PINE RULE, NOT AN ENGINE RULE. `close[1][2]` is a compile error in Pine
    // and the engine happily represents it, so this refusal exists to keep the
    // translator honest about the language it claims to read.
    expect(refusal('close[1][2]').guard).toBe('pine:offset-literal')
    expect(parseFormula('close[1][2]').ok).toBe(true)
  })

  it('`x[0]` is `x`, and it emits no node at all', () => {
    expect(formula('close[0]').formula).toBe('close')
    expect(formula('ta.sma(close, 20)[0]').formula).toBe('sma(close, 20)')
  })
})

// --------------------------------------------------------------------------- //
// the node
// --------------------------------------------------------------------------- //

describe("Pine's [n] emits the engine's own fifth node type", () => {
  it('close[3] is an offset node, and the printed text reads back to it', () => {
    const row = formula('close[3]')
    expect(row.formula).toBe('close[3]')
    expect(row.ast).toEqual({ type: 'offset', value: 3, args: [{ type: 'series', name: 'close' }] })
    expect(astHash(parseFormula(row.formula).ast)).toBe(astHash(row.ast))
  })

  it('the idiom the whole corpus is full of', () => {
    expect(formula('close - close[1]').formula).toBe('close - close[1]')
    expect(formula('close > close[1] and volume > volume[1]').formula)
      .toBe('close > close[1] && volume > volume[1]')
  })

  it('it composes onto a call, and onto a binding, and inside an argument', () => {
    expect(formula('ta.sma(close, 20)[2]').formula).toBe('sma(close, 20)[2]')
    expect(formula('ta.sma(close[5], 20)').formula).toBe('sma(close[5], 20)')
    const out = translatePine('//@version=5\nindicator("t")\nr = ta.rsi(close, 14)\nplot(r - r[1])\n')
    expect(out.outputs[0].formula).toBe('rsi(close, 14) - rsi(close, 14)[1]')
  })

  it('⭐ the printer parenthesises an operand, because [n] binds tighter than unary minus', () => {
    // `(-close)[1]` printed as `-close[1]` would re-parse as `-(close[1])`.
    const row = formula('(-close)[1]')
    expect(row.formula).toBe('(-close)[1]')
    expect(astHash(parseFormula(row.formula).ast)).toBe(astHash(row.ast))
    const sum = formula('(close + open)[1]')
    expect(sum.formula).toBe('(close + open)[1]')
    expect(astHash(parseFormula(sum.formula).ast)).toBe(astHash(sum.ast))
  })

  it('⭐⭐ maxLookback IS A TREE SUM through it — the linter needed no change', () => {
    // ⚠️ THE NUMBERS ARE THE MANIFEST'S CONVENTION, NOT ARITHMETIC THIS FILE
    // CHOSE: `sma(x, 20)` declares `lookback: "arg1"`, so its own window is 20
    // and the offset adds on top. An expectation computed from first principles
    // would be a second authority over a number `closedTable.json` owns — and the
    // first draft of this list got it wrong in exactly that way.
    for (const [body, want] of [
      ['close[3]', 3],
      ['ta.sma(close, 20)[2]', 22],
      ['ta.sma(close[5], 20)', 25],
      ['ta.sma(close, 20)[2] - ta.ema(close, 50)[1]', 51],
    ]) {
      expect(maxLookback(parseFormula(formula(body).formula).ast), body).toBe(want)
    }
  })

  it('...and the repaint verdict stays clean, because the reach is BACKWARD', () => {
    const verdict = lintRepaint(parseFormula(formula('close - close[1]').formula).ast)
    expect(verdict.mode).toBe('non-repainting')
    expect(verdict.forward).toBe(0)
    expect(verdict.back).toBe(1)
  })

  it('an offset changes WHEN a value is read, never WHAT KIND it is', () => {
    // The child is a comparison, so the shifted column is still a 0/1 column and
    // still screens. Deriving that any other way would be a second opinion about
    // one declaration.
    const cond = formula('(close > open)[1]')
    expect(cond.ast.type).toBe('offset')
    expect(treeYieldsBool(cond.ast)).toBe(true)
    expect(treeYieldsBool(formula('close[1]').ast)).toBe(false)

    // ⭐ AND IT DECIDES SOMETHING A MEMBER SEES: which column is offered first.
    // ⛔ THE SECOND PLOT MUST NOT BE A TERNARY. `x ? 1 : 0` is bool through the
    // `passthrough` arms and never consults the offset at all — a case written
    // that way passed with this branch deleted, which is how the mutation harness
    // found that this assertion was decorative.
    const out = translatePine('//@version=5\nindicator("t")\n'
      + 'plot(ta.rsi(close, 14), "RSI")\n'
      + 'plot((close > open)[1], "Prev bar was up")\n')
    expect(out.outputs[1].formula).toBe('(close > open)[1]')
    expect(out.selected).toBe(1)
  })
})

// --------------------------------------------------------------------------- //
// the seam
// --------------------------------------------------------------------------- //

describe('the seam between the two lanes', () => {
  it('the emission is DISCOVERED from NODE_TYPES, never assumed', () => {
    // ⛔ THIS IS WHAT LET THE PINE SIDE SHIP BEFORE THE NODE DID. If the engine
    // ever withdraws the fifth type, this module refuses by name at the bracket
    // instead of emitting a node no walker has a case for.
    expect(NODE_TYPES).toContain('offset')
    expect(NODE_TYPES.length).toBe(5)
  })

  it('the two lanes agree on which offsets are legal, in both directions', () => {
    // ⭐ ONE TABLE, WALKED BOTH WAYS. A Pine script the translator accepts must
    // produce a formula the engine accepts, and one it refuses must not.
    const legal = ['close[1]', 'close[0]', 'close[26]', 'ta.sma(close, 5)[2]']
    for (const body of legal) {
      const row = formula(body)
      expect(parseFormula(row.formula).ok, body).toBe(true)
    }
    for (const body of ['close[-1]', 'close[1.5]']) {
      expect(translate(body).ok, body).toBe(false)
      expect(parseFormula(body.replace('ta.', '')).ok, body).toBe(false)
    }
  })
})
