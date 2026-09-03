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
//   `ta.obv` is cumulative from the first bar. `closedTable.json`'s ruling
//   refuses its LEVEL — the seed "is a fact about where the fetch started" — and
//   then blesses this rewrite in its own words: "the LEVEL is refused, its CHANGE
//   across a declared window is not, because the arbitrary seed CANCELS in a
//   difference".
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
