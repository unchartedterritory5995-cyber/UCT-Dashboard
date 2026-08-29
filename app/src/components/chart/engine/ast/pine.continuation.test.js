import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine, printFormula } from './pine.js'

/**
 * ⭐⭐ A LINE ENDING IN A BINARY OPERATOR IS HALF A STATEMENT, NOT A STATEMENT.
 *
 * The splitter tells a block's BODY from a CONTINUATION by INDENT plus a closed
 * list of block-opening words, and it is right about both. What it could not see
 * was a continuation at the SAME indent — which is how the ternary chain in a
 * function body is published, and it is the shape `07-hull-suite` refused on:
 *
 *     Mode(sw, src, len) =>
 *           sw == "Hma"  ? HMA(src, len) :
 *           sw == "Ehma" ? EHMA(src, len) :
 *           sw == "Thma" ? THMA(src, len / 2) : na
 *
 * All three lines sit at one indent, so it read them as THREE statements and
 * refused the first — `pine:statement`, with `line: null` and `token: null`,
 * about a line the member never wrote. That is the least useful refusal this door
 * can produce, and it was the only thing between a published script and its real
 * first wall.
 *
 * ⛔ THIS IS NOT THE "DOES THE PREVIOUS LINE END IN AN OPERATOR" GUESS THAT
 * `BLOCK_OPENERS` WARNS ABOUT, and the difference is which question it answers.
 * That guess was proposed for telling a BODY from a CONTINUATION, where it is
 * wrong. This answers a different question — may a statement END here — and there
 * it is not a guess at all: a dangling binary operator has no right operand, so
 * Pine itself rejects the line and no statement can legally follow it.
 */
describe('a dangling binary operator continues onto the next line', () => {
  const pine = (body) => translatePine(`//@version=4
study("t")
${body}
`)

  it('⭐⭐ THE PUBLISHED SHAPE: a ternary chain across a function body`s own indent', () => {
    // Reduced from `07-hull-suite`'s `Mode(…)`: three lines, one indent, each of
    // the first two ending on the ternary's `:`.
    const out = pine(`pick(s) =>
      close > open ? sma(s, 10) :
      close < open ? ema(s, 10) : na
plot(pick(close))`)
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    expect(out.outputs.length).toBe(1)
    // ⭐ THE WHOLE CHAIN, not its first arm — a splitter that glued only the
    // second line would still translate and would draw a different indicator.
    expect(printFormula(out.outputs[0].ast))
      .toBe('close > open ? sma(close, 10) : close < open ? ema(close, 10) : 0 / 0')
  })

  it('⭐ and the same chain at top level, which already worked, still does', () => {
    // The deeper-indent path — the splitter has always continued onto an indented
    // line while no block is open. The control that this change did not disturb it.
    const out = pine(`x = close > open ? high :
    close < open ? low : hl2
plot(x)`)
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    expect(printFormula(out.outputs[0].ast))
      .toBe('close > open ? high : close < open ? low : (high + low) / 2')
  })

  it('⛔⛔ `=>` IS NOT DANGLING — a function`s body must not fold into its header', () => {
    // `=>` is the one trailing token that OPENS something rather than leaving
    // something unfinished. If it were treated as dangling, this header would
    // swallow `a = close * 2` and the body would be a lone `a + 1` with `a`
    // undefined. ⭐ The multi-STATEMENT body is what makes this discriminate: a
    // one-line body would translate either way.
    const out = pine(`f(x) =>
    a = x * 2
    a + 1
plot(f(close))`)
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    expect(printFormula(out.outputs[0].ast)).toBe('close * 2 + 1')
  })

  it('⛔ two finished statements at one indent are still TWO statements', () => {
    // The over-gluing direction. Neither line dangles, so neither may be absorbed
    // into the other — and a `plot` that vanished into the line above is an output
    // a member declared and never received.
    const out = pine('plot(close)\nplot(open)')
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    expect(out.outputs.length).toBe(2)
    expect(out.outputs.map((o) => printFormula(o.ast))).toEqual(['close', 'open'])
  })

  it('⛔ a block body is still a BODY — `BLOCK_OPENERS` still decides that', () => {
    // `if close > open` ends on a name, not an operator, so nothing here changed.
    // Asserted anyway because this is the rule the new clause sits beside, and a
    // conditional reassignment folding to a ternary is what would break first.
    const out = pine(`v = 0.0
if close > open
    v := high
else
    v := low
plot(v)`)
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    expect(printFormula(out.outputs[0].ast)).toBe('close > open ? high : low')
  })

  it('⭐ several operator kinds, at the end of a line, all continue', () => {
    // ⚠️ REPRESENTATIVES, NOT A SWEEP, AND SAYING SO IS THE POINT: the set is
    // DERIVED from `PINE_BINARY` in `pine.js` (plus `? : , = :=`), so an operator
    // added to the grammar is covered the day it lands — but `PINE_BINARY` is not
    // exported, so this file cannot enumerate it without typing a second copy of
    // the list, which is the defect the derivation exists to avoid. These are the
    // shapes published scripts actually break lines on.
    const cases = [
      ['+', 'g() =>\n      close +\n      open\nplot(g())', 'close + open'],
      ['-', 'g() =>\n      high -\n      low\nplot(g())', 'high - low'],
      ['*', 'g() =>\n      close *\n      2\nplot(g())', 'close * 2'],
      ['and', 'g() =>\n      close > open and\n      high > low\nplot(g() ? 1 : 0)',
        'close > open && high > low ? 1 : 0'],
      ['?', 'g() =>\n      close > open ?\n      high : low\nplot(g())',
        'close > open ? high : low'],
    ]
    for (const [label, src, want] of cases) {
      const out = pine(src)
      expect(out.refusal, `${label}: ${out.refusal && out.refusal.message}`).toBe(null)
      expect(printFormula(out.outputs[0].ast), label).toBe(want)
    }
  })

  it('🏁 and the published script itself reaches a wall a member can act on', () => {
    // ⛔ THE ONLY CLAIM WORTH MAKING ABOUT `07-hull-suite` IS THE ONE THAT IS TRUE:
    // it still refuses. What changed is WHAT IT SAYS. It used to answer
    // `pine:statement` with no line and no token; it now names `int`, at line 35,
    // on `_hull = Mode(modeSwitch, src, int(length * lengthMult))` — a numeric type
    // cast this door reads as an unknown function.
    // ⚠️ AND AT LEAST ONE MORE WALL STANDS BEHIND IT, measured rather than guessed:
    // translating `int(x)` as `idiv(x, 1)` in a scratch build moved this to
    // `pine:window` at line 22 (`wma(_src, _length / 2)` reduces to 27.5). That
    // build is NOT shipped — see the `⚰️` note at the numeric-cast site in
    // `pine.js` — so this assertion pins the wall the door ACTUALLY reaches today.
    // ⚠️ Pinned here as well as in `pine.community.guards.test.js` because that
    // file pins the whole corpus at once; this one says why THIS script moved.
    const src = fs.readFileSync(path.resolve(process.cwd(),
      '../tests/fixtures/pine_community/07-hull-suite.pine'), 'utf8')
    const r = translatePine(src).refusal
    expect(r).toBeTruthy()
    expect(r.guard).toBe('pine:function')
    expect(r.token).toBe('int')
    expect(r.line).toBe(35)
  })
})
