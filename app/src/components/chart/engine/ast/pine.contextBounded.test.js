// app/src/components/chart/engine/ast/pine.contextBounded.test.js
//
// ─── ⭐⭐ A COMPARISON CAN BOUND WHAT ITS OPERAND CANNOT ───────────────────────
//
// Two of this engine's refusals were correct about a FUNCTION and too wide about
// an EXPRESSION, and they cost the two scripts that were left on the screener
// corpus's residual roster (`33-obv-rising`, `34-bars-since-signal`).
//
//   `ta.barssince(c)` is unbounded. `PINE_INEXPRESSIBLE.barssince` refused it
//   because mapping it onto our bounded `barssince(condition, n)` "would silently
//   cap the count — a different number wearing the same name". True of the CALL.
//   Inside `< 5` it is false: our form saturates AT the window and answers `n`
//   for "not true within the last n bars", so taking the window FROM the
//   comparison puts the cap exactly on the boundary the comparison already
//   collapses. Every count the cap destroys is one the comparison answered the
//   same way.
//
//   `ta.obv` accumulates without a bound, and `closedTable.json` owns the reason
//   its LEVEL is refused. That same ruling then blesses this rewrite in its own
//   words: "the LEVEL is refused, its CHANGE across a declared window is not,
//   because the arbitrary seed CANCELS in a difference".
//   ⛔ THE REASON IS NOT PARAPHRASED HERE ON PURPOSE. `test_ast_bounded_state`
//   sweeps the repo for a second copy of it and fails, because two agreeing
//   copies read as corroboration and the stale one never gets corrected.
//
// ⛔⛔ THE LICENCE IS THAT THESE ARE IDENTITIES, so this file MEASURES them
// against a reference computed here rather than asserting the rewrite looks
// right. A rewrite that is merely plausible is the "different number wearing the
// same name" the original ruling refused, and it would be invisible: the formula
// would translate, scan, and answer confidently.
//
// ⛔ AND THE UNBOUNDED NAMES MUST STILL BE REFUSED where nothing bounds them.
// Half this file is that direction; without it, "the rewrite fires" and "the
// vocabulary was widened" are indistinguishable.

import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'
import { parseFormula } from './parse.js'
import { interpret } from './interpret.js'

const S = (body) => `//@version=6\nindicator("s")\nplot(${body} ? 1 : 0)\n`

/** The formula a screener script translates to, or a refusal guard. */
function translate(body) {
  const out = translatePine(S(body))
  if (!out.ok) return { refused: out.refusal.guard, message: String(out.refusal.message) }
  return { formula: out.outputs[out.selected].formula }
}

/** Deterministic bars with plenty of up/down alternation and a flat close run
 *  (OBV's third case) so neither reference below is exercised on one branch. */
function bars(n = 120) {
  const out = []
  let c = 100
  for (let i = 0; i < n; i++) {
    const step = [1.5, -0.75, 0, 2.25, -1.5, -0.25, 0.5][i % 7]
    const prev = c
    c = Math.round((c + step) * 100) / 100
    out.push({
      t: 1700000000 + i * 86400,
      o: prev, h: Math.max(prev, c) + 0.5, l: Math.min(prev, c) - 0.5, c,
      v: 1000 + ((i * 37) % 500),
    })
  }
  return out
}

const run = (formula, rows) => interpret(parseFormula(formula).ast, rows)

describe('the rewrite fires, and produces the bounded form exactly', () => {
  it('⭐ an OBV difference becomes obvN, in every spelling', () => {
    expect(translate('ta.obv > ta.obv[1]').formula).toBe('obvN(1) > 0 ? 1 : 0')
    expect(translate('ta.obv < ta.obv[5]').formula).toBe('obvN(5) < 0 ? 1 : 0')
    expect(translate('ta.obv - ta.obv[3] > 0').formula).toBe('obvN(3) > 0 ? 1 : 0')
  })

  it('⭐⭐ the barssince WINDOW comes from the comparison, and it is not always K', () => {
    // `< K` and `>= K` split at K, so K bars put the sentinel on the boundary;
    // `<= K` and `> K` split at K+1 and need one bar more. Getting this wrong by
    // one is exactly the off-by-one that would make the rewrite a look-alike.
    expect(translate('ta.barssince(close > open) < 5').formula)
      .toBe('barssince(close > open, 5) < 5 ? 1 : 0')
    expect(translate('ta.barssince(close > open) >= 5').formula)
      .toBe('barssince(close > open, 5) >= 5 ? 1 : 0')
    expect(translate('ta.barssince(close > open) <= 3').formula)
      .toBe('barssince(close > open, 4) <= 3 ? 1 : 0')
    expect(translate('ta.barssince(close > open) > 10').formula)
      .toBe('barssince(close > open, 11) > 10 ? 1 : 0')
  })

  it('⭐ the operands may be written in either order', () => {
    // A member writes `5 > ta.barssince(x)` as readily as the other way round.
    expect(translate('5 > ta.barssince(close > open)').formula)
      .toBe('barssince(close > open, 5) < 5 ? 1 : 0')
  })

  it('⭐ a nested condition is translated, not just passed through', () => {
    expect(translate('ta.barssince(ta.crossover(close, ta.sma(close, 50))) < 5').formula)
      .toBe('barssince(crossOver(close, sma(close, 50)), 5) < 5 ? 1 : 0')
  })

  it('⛔ the two-argument form a member could already write is untouched', () => {
    expect(translate('barssince(close > open, 5) < 5').formula)
      .toBe('barssince(close > open, 5) < 5 ? 1 : 0')
  })
})

describe('⭐⭐ the same identity, reached through a BINDING', () => {
  // ⚰️ THE SHAPE PEOPLE ACTUALLY WRITE. Measured on a corpus authored blind to
  // this engine: every `ta.barssince` script named the count on one line and
  // compared it on another, and the window was an `input`, not a literal —
  //     within = input.int(3, "Max bars since cross")
  //     age    = ta.barssince(cross)
  //     ... age <= within
  // The first version of the rewrite required the call and the number to sit in
  // ONE expression, so it saw none of them and the blind score did not move.
  const script = (body) => translatePine(`//@version=6\nindicator("s")\n${body}\n`)

  it('⭐ a bound count compared against a literal', () => {
    const out = script('age = ta.barssince(close > open)\nplot(age <= 5 ? 1 : 0)')
    expect(out.ok, out.ok ? '' : out.refusal.message).toBe(true)
    // ⛔ THE SAME FORMULA THE DIRECT SPELLING PRODUCES — not merely "it worked".
    // Two ways of writing one screen must reach one tree, or they are two
    // definitions with two hashes and two cache entries.
    expect(out.outputs[out.selected].formula)
      .toBe(translate('ta.barssince(close > open) <= 5').formula)
  })

  it('⭐⭐ …and against an INPUT, folded to its default', () => {
    const out = script('within = input.int(3, \'Max bars\')\nage = ta.barssince(close > open)\nplot(age <= within ? 1 : 0)')
    expect(out.ok, out.ok ? '' : out.refusal.message).toBe(true)
    expect(out.outputs[out.selected].formula)
      .toBe(translate('ta.barssince(close > open) <= 3').formula)
  })

  it('⭐ the condition is resolved in the BINDING’s own scope', () => {
    // ⛔ WHY THE WHOLE REWRITE RUNS INSIDE `throughBinding`. The condition here
    // is written in terms of `gc`, a name that exists only where `age` was bound.
    // Asking for the node and resolving it at the comparison would translate the
    // right shape against the wrong scope.
    const out = script('gc = ta.crossover(close, ta.sma(close, 50))\nage = ta.barssince(gc)\nplot(age < 10 ? 1 : 0)')
    expect(out.ok, out.ok ? '' : out.refusal.message).toBe(true)
    expect(out.outputs[out.selected].formula)
      .toBe('barssince(crossOver(close, sma(close, 50)), 10) < 10 ? 1 : 0')
  })

  it('⛔ a bound count used as a VALUE is still refused', () => {
    // ⚠️ THE HONEST LIMIT, AND IT IS WHY THE BLIND CORPUS DID NOT MOVE. Those
    // scripts also ask `not na(age)` — the raw count as a value, not as one side
    // of a bounding comparison. The saturating form cannot answer that: its
    // sentinel means "not within n bars" and its NaN means "not enough bars read
    // yet", which are different facts from Pine's `na`. Refusing is correct.
    const out = script('age = ta.barssince(close > open)\nplot(age > close ? 1 : 0)')
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:function')
  })
})

describe('⛔ the unbounded names are still refused where nothing bounds them', () => {
  it('the OBV LEVEL is refused, and it gets the table ruling', () => {
    const r = translate('ta.obv > 0')
    expect(r.refused).toBe('pine:function')
    expect(r.message).toContain('CUMULATIVE FROM THE FIRST BAR')
  })

  it('an OBV difference against a NON-obv term is not a difference at all', () => {
    // ⚠️ THE SEED ONLY CANCELS BETWEEN TWO OBVs. `obv > close` keeps it.
    expect(translate('ta.obv > close').refused).toBe('pine:function')
  })

  it('⛔⛔ …INCLUDING an offset term, which is the shape that nearly slipped', () => {
    // ⚰️ THE FIRST VERSION OF THE TEST ABOVE COULD NOT SEE THIS. `close` is a
    // NAME, so it never reached the `right.type === 'offset'` guard at all —
    // deleting the check that the right side is also OBV left every test green.
    // `ta.obv > close[1]` is the input that separates them: it IS an offset, it
    // is NOT an OBV, and rewriting it to `obvN(1) > 0` would silently answer a
    // completely different question. `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`.
    expect(translate('ta.obv > close[1]').refused).toBe('pine:function')
    expect(translate('ta.obv > high[3]').refused).toBe('pine:function')
  })

  it('barssince compared against something that is not a whole number', () => {
    // Nothing here caps the count, so the original ruling still applies — and
    // the refusal now says which shape WOULD have been read.
    const r = translate('ta.barssince(close > open) > close')
    expect(r.refused).toBe('pine:function')
    expect(r.message).toContain('UNBOUNDED')
  })

  it('⭐ and the refusal TEACHES the shape that works', () => {
    // ⛔ THE DOOR'S TEXT AND THE DOOR'S BEHAVIOUR MUST NOT DISAGREE. While that
    // sentence said the one-argument form was simply refused, it was a second
    // authority over a rule the code no longer followed.
    const r = translate('ta.barssince(close > open) > close')
    expect(r.message).toContain('barssince(cond, 5) < 5')
  })

  it('a bare barssince with no comparison at all', () => {
    expect(translate('ta.barssince(close > open)').refused).toBe('pine:function')
  })
})

describe('⭐⭐ the identities, MEASURED against a reference', () => {
  it('obvN(k) really is the change in cumulative OBV across k bars', () => {
    const rows = bars()
    // A cumulative OBV computed here, seeded at zero. The SEED IS ARBITRARY on
    // purpose — if the difference did not cancel it, this test would fail, which
    // is the property the whole rewrite rests on.
    const level = [0]
    for (let i = 1; i < rows.length; i++) {
      const d = rows[i].c > rows[i - 1].c ? rows[i].v : rows[i].c < rows[i - 1].c ? -rows[i].v : 0
      level.push(level[i - 1] + d)
    }

    let compared = 0
    for (const k of [1, 3, 5]) {
      const got = run(`obvN(${k})`, rows)
      for (let i = 0; i < rows.length; i++) {
        const v = typeof got[i] === 'number' ? got[i] : (got[i] && got[i].value)
        if (!Number.isFinite(v)) continue
        expect(v, `obvN(${k}) at bar ${i}`).toBeCloseTo(level[i] - level[i - k], 6)
        compared += 1
      }
    }
    // ⛔ NON-VACUITY: a run that compared nothing (all NaN) would pass silently.
    expect(compared).toBeGreaterThan(200)
  })

  it('⭐⭐ the bounded barssince answers the UNBOUNDED question, bar for bar', () => {
    const rows = bars()
    // The reference is Pine's semantics: count back as far as the condition
    // requires, with no window at all.
    const cond = rows.map((b) => (b.c > b.o ? 1 : 0))
    const unbounded = []
    let since = null
    for (let i = 0; i < rows.length; i++) {
      if (cond[i]) since = 0
      else if (since !== null) since += 1
      unbounded.push(since)
    }

    let compared = 0
    for (const K of [1, 3, 5, 10]) {
      // Exactly what the door builds for `ta.barssince(close > open) < K`.
      const got = run(`barssince(close > open, ${K}) < ${K} ? 1 : 0`, rows)
      for (let i = 0; i < rows.length; i++) {
        const v = typeof got[i] === 'number' ? got[i] : (got[i] && got[i].value)
        if (!Number.isFinite(v)) continue
        const want = (unbounded[i] !== null && unbounded[i] < K) ? 1 : 0
        expect(v, `bar ${i}, K=${K}`).toBe(want)
        compared += 1
      }
    }
    expect(compared).toBeGreaterThan(300)
  })
})


// ─── ⭐⭐⭐ RULING C — THE VENDOR READING, AND WHAT IT CONFIRMS ───────────────
//
// On 2026-09-10 `ta.barssince` was read off a live TradingView chart, twice, and
// the readings SETTLE the premise this whole file rests on rather than moving it.
//
//   ⭐ THE ARITY. `groupb-barssince-2arg.pine` was saved and added; TradingView
//   answered `CE10115: Too many arguments passed into the "ta.barssince()"
//   function call. Passed 2 arguments but expected 1.` Its 1-arg pair compiled on
//   the same symbol in the same session, 400 bars, so the failure is the arity and
//   not the harness. Pine's `ta.barssince` takes EXACTLY ONE argument.
//
//   ⭐ THE NEVER-TRUE CASE. `ta.barssince` on a condition that is never true
//   answers `na` — measured, not inferred, in
//   `tests/fixtures/vendor/groupb-barssince-arity-spy-1d-2026-09-10.json::N04`.
//   Ours answers the SENTINEL `n`. Two different answers to "it never happened".
//
// ⚰️⚰️ AND THE OBVIOUS CONCLUSION FROM THE FIRST READING IS WRONG. "Pine takes one
// argument, we declare two, therefore our table is wrong and must NARROW" was
// written down on the day of the capture and it does not survive reading the
// engine: `barssince(condition, n)` is not a mis-transcribed `ta.barssince`, it is
// one of the FIVE BOUNDED STATE entries, and `n` is the declared window that makes
// its state bounded at all. Narrowing it to one argument would delete the bound
// the budget is priced on — `tests/test_ast_bounded_state.py` owns that design.
//
// ⭐⭐ SO THE TWO FUNCTIONS ARE DIFFERENT ON PURPOSE, AND THE ENGINE ALREADY SAID
// SO. `PINE_INEXPRESSIBLE.barssince` refuses the bare Pine call precisely because
// mapping it onto ours "would silently cap the count — a different number wearing
// the same name". The vendor readings CONFIRM that refusal instead of prompting a
// change; the only thing that moves is that the premise is now measured.

describe('⛔ RULING C — the vendor readings pin the door, and the door was right', () => {
  it('⭐ the BARE one-argument call is still refused, and the reason names the cap', () => {
    // ⛔ NOT "it refuses" — WHY it refuses. A member told "the engine grammar does
    // not hold this name" would go away; one told the count would be silently
    // capped can act, and the sentence hands them the spelling that works.
    // ⚠️ THE BARE CALL, WITH NOTHING TO TAKE A WINDOW FROM. Measured while
    // writing this: `ta.barssince(c) > 0` DOES rewrite — to `barssince(c, 1) > 0`
    // — so "compared against a literal" is not the boundary; "compared against
    // something that bounds it" is. A first draft of this test used `> 0` as the
    // refused case and went red for that reason, which is worth the two lines.
    const out = translate('ta.barssince(close > open)')
    expect(out.formula, 'the unbounded call translated with nothing to bound it — '
      + 'mapping it onto our bounded form silently caps the count, a different '
      + 'number wearing the same name').toBeUndefined()
    expect(String(out.message), 'the refusal no longer explains the cap, so a '
      + 'member cannot tell which spelling would work')
      .toMatch(/UNBOUNDED|cap|window you actually mean/i)
  })

  it('⭐⭐ …while the COMPARED form still rewrites to the bounded one', () => {
    // The discriminator. Without it the test above passes for a door that refuses
    // every spelling, which would be a capability lost rather than a cap avoided.
    expect(translate('ta.barssince(close > open) < 5').formula)
      .toBe('barssince(close > open, 5) < 5 ? 1 : 0')
  })

  it('⛔⛔ OURS SATURATES AT n WHERE THE VENDOR ANSWERS na — and that is WHY the '
     + 'bare form is refused rather than mapped', () => {
    // ⭐ THE MEASURED DIVERGENCE, DRIVEN. On a condition that is NEVER true the
    // vendor returns `na` (capture N04) and ours returns the sentinel `n`. If ours
    // ever stopped saturating, the refusal above would be arguing against a
    // difference that no longer existed — and the rewrite's exactness argument,
    // which depends on the cap sitting exactly on the comparison's boundary, would
    // be false at the same moment.
    // `close` is ~100 on every bar of this series, so `close < 0` is never true —
    // the vendor's `na` case, asked of ours.
    const col = run('barssince(close < 0, 10)', bars())
    const tail = Array.from(col).slice(-1)[0]
    expect(tail, 'our barssince stopped answering the sentinel on a never-true '
      + 'condition; the vendor answers na, and the whole reason the bare Pine call '
      + 'is refused is that these two are different answers').toBe(10)
  })
})
