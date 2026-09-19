// app/src/components/chart/engine/ast/pine.modulo.test.js
//
// ─── C4 PHASE 1 · H7/J5.1 — `%` REACHES THE ENGINE, AS A CALL ───────────────
//
// ⚰️ WHAT THIS CLOSES. C3B-CLOSE measured `bar_index % 50 == 0` refusing with
// `pine:operator` and filed it as a VALUE-lane grammar gap: an object coordinate
// using `%` failed for exactly the reason a plot using `%` failed. Pine's lexer
// and precedence table have carried `%` all along (`PINE_BINARY`) — the tree got
// built and then died at `PINE_OP_TO_TABLE`.
//
// ⛔⛔ THE FIX THAT WAS NOT MADE IS THE POINT OF THIS FILE. The obvious repair is
// to declare `%` in `closedTable.operators`, give it a precedence in `parse.js`,
// implement it in `interpret.js`, and implement it AGAIN in
// `api/services/ast_interpret.py`. That is four edits and a SECOND AUTHORITY OVER
// ONE ARITHMETIC — and `_guarded_mod`'s own docstring names the trap it would
// have walked into: `-7 % 2` is `-1` in JS and `1` in Python. A borrowed `%` in
// each lane would have made the chart and the screener disagree about every
// negative dividend, with every test green in both lanes, because each lane would
// have been consistent with itself.
//
// ⭐ SO `%` LOWERS ONTO `mod`, which this table has always owned: truncated
// toward zero, sign following the dividend, NaN on a zero divisor and NaN on a
// non-finite quotient — one implementation per lane, already cross-verified. The
// screener understands `%` the day the chart does, because it is reading a call
// it already knew.

import { describe, it, expect } from 'vitest'

import { translatePine, REFUSALS } from './pine.js'
import { parseFormula, TABLE } from './parse.js'
import { interpret } from './interpret.js'

const src = (body) => `//@version=5\nindicator("t")\n${body}\n`

/** Synthetic bars whose closes include a NEGATIVE value — the only input that
 *  can tell a truncated remainder from a floored one. Prices are never negative;
 *  an expression fed into `%` routinely is (`close - open`, a z-score, a delta). */
const CLOSES = [7, -7, 8.5, -8.5, 0, 3]
const BARS = CLOSES.map((c, i) => ({
  t: 1700000000 + i * 86400, o: c, h: c + 1, l: c - 1, c, v: 1000,
}))

const formulaOf = (out, i = 0) => {
  expect(out.ok, `translate failed: ${out.refusal && out.refusal.message}`).toBe(true)
  const row = (out.outputs || [])[i]
  expect(row, 'no output row').toBeTruthy()
  return row.formula
}

const evaluate = (formula) => {
  const parsed = parseFormula(formula)
  expect(parsed.ok, `${formula} did not parse: ${parsed.error}`).toBe(true)
  return interpret(parsed.ast, BARS, {})
}

describe('`%` translates, and it translates to the arithmetic the table already had', () => {
  it('⭐⭐ a script using `%` is ACCEPTED where it used to refuse', () => {
    const out = translatePine(src('plot(close % 3)'))
    expect(out.ok).toBe(true)
    expect(out.refusal).toBeFalsy()
  })

  it('⛔⛔ it lowers to a `mod` CALL — no `%` survives into the canonical formula', () => {
    const f = formulaOf(translatePine(src('plot(close % 3)')))
    expect(f).toContain('mod(')
    // The load-bearing half: if someone later "simplifies" this by declaring a
    // real `%` operator, this assertion is what goes red.
    expect(f).not.toContain('%')
  })

  it('⛔⛔ …and `closedTable.operators` still does NOT declare `%`', () => {
    // A second authority over one arithmetic is the defect this repo repeats
    // most. The absence IS the fix; assert the absence.
    expect(Object.keys(TABLE.operators)).not.toContain('%')
    expect(Object.keys(TABLE.functions)).toContain('mod')
  })

  it('⭐ the numbers are TRUNCATED — the sign follows the dividend', () => {
    const col = evaluate(formulaOf(translatePine(src('plot(close % 3)'))))
    // 7 % 3 = 1 ; -7 % 3 = -1 (NOT 2, which is what a floored `%` answers) ;
    // 8.5 % 3 = 2.5 ; -8.5 % 3 = -2.5 ; 0 % 3 = 0 ; 3 % 3 = 0
    expect(Array.from(col)).toEqual([1, -1, 2.5, -2.5, 0, 0])
  })

  it('⛔ a zero divisor is NOT computable, and says so as NaN', () => {
    const col = evaluate(formulaOf(translatePine(src('plot(close % 0)'))))
    for (const v of col) expect(Number.isNaN(v)).toBe(true)
  })

  it('⭐ it composes — the measured shape from the parity set works end to end', () => {
    // `bar_index % 50 == 0` is the exact expression C3B-CLOSE recorded refusing.
    const out = translatePine(src('plot(close % 5 == 0 ? 1 : 0)'))
    expect(out.ok).toBe(true)
    const col = evaluate(formulaOf(out))
    // closes 7,-7,8.5,-8.5,0,3 → remainders 2,-2,3.5,-3.5,0,3 → only bar 5 is 0
    expect(Array.from(col)).toEqual([0, 0, 0, 0, 1, 0])
  })

  it('⭐ `%` works on both sides of a binding, not only inline', () => {
    const out = translatePine(src('r = close % 4\nplot(r)'))
    expect(out.ok).toBe(true)
    expect(formulaOf(out)).toContain('mod(')
  })
})

describe('the refusal this did NOT delete', () => {
  it('⛔ NON-VACUITY — an operator the table really has no meaning for still refuses', () => {
    // Without this, the tests above would pass just as happily against a
    // translator that had stopped refusing anything at all.
    const out = translatePine(src('plot(close ^ 3)'))
    expect(out.ok).toBe(false)
    expect(out.refusal).toBeTruthy()
  })

  it('⚰️ AND IT REFUSES FOR THE WRONG REASON — the lexer answers before the operator guard', () => {
    // ⚰️ THIS TEST WAS WRITTEN TO ASSERT THE OPPOSITE and the run corrected the
    // author. `^` never reaches `pine:operator` at all: the character set in the
    // lexer rejects it first, and the message a member sees is "Pine has no
    // character like this one" — about a character Pine has.
    //
    // This is the SAME honesty defect OOS-2 booked against 4/60 real scripts,
    // where `f(...).field` (method / UDT access) trips the same guard and gets
    // told its valid Pine v6 is not Pine. It is recorded here rather than fixed
    // because it belongs to the lexer, not to `%`, and C4 Phase 1 is not the
    // place to widen a character set on the way past.
    //
    // ⛔ DO NOT "FIX" THIS TEST BY LOOSENING THE ASSERTION. When the lexer guard
    // is corrected, this goes red — which is exactly the notice wanted.
    const out = translatePine(src('plot(close ^ 3)'))
    expect(out.refusal.guard).toBe('pine:character')
    expect(String(out.refusal.message)).toContain('Pine has no character like this one')
  })

  it('⛔ and `pine:operator` is still a REACHABLE guard, not dead code', () => {
    // The lowering above removed the only binary spelling that reached this
    // guard, so the guard could now be unreachable — which would make deleting
    // it invisible. It is not: `PINE_OP_TO_TABLE` is consulted for every mapped
    // operator and the refusal fires for any that the table stops declaring.
    // Asserted through the module's own refusal vocabulary rather than by
    // reaching for a source string.
    expect(Object.keys(REFUSALS)).toContain('pine:operator')
  })
})
