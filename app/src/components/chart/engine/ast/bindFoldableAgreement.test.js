// ─── ⭐⭐⭐ L2 — THREE GATES, ONE ANSWER, OR THE MEMBER GETS A NUMBER NOBODY MADE ──
//
// A bind-time window length passes THREE gates on its way to a member, and they
// must agree case for case:
//
//   1. THE SAVE DOOR   `pine.js` withholds `pine:window` when the predicate holds,
//                      letting a non-literal length through UNFOLDED.
//   2. THE BIND STAGE  `bind.js::foldScalar` settles it per binding.
//   3. THE LINTER      `lint.js::resolveDeclaration` bounds its lookback, or the
//                      formula is branded `repaints` and `canSaveFormula` refuses
//                      it outright.
//
// ⛔⛔ AND GATE 3 IS WHY THE FIRST ATTEMPT AT THIS CAME BACK OUT. On 2026-09-10 the
// door was wired on the predicate alone. Uncharted Volume line 233 duly stopped
// being refused — and `07-hull-suite.pine` moved from "refused at translate" to
// "translates but CANNOT BE SAVED", because the linter still answered UNKNOWN for
// a non-literal window. `doorScorecard.test.js` calls that gap a defect in its own
// words: "translating is not the finish line". A precise refusal was traded for a
// badge that names nothing. The wiring was reverted the same day.
//
// ⭐⭐ SO THE PREDICATE IS BOUNDED BY WHAT THE LINTER CAN BOUND, NOT BY WHAT THE
// FOLD CAN EVALUATE, and `FOLD_ONLY` below is the category that states it. That is
// the asymmetry this file exists to hold: the door may only defer a length all
// three gates can carry.
//
// ⛔ ONE WALK, THREE CALLERS. `bindFoldableWindow` lives in `parse.js` — NOT beside
// the fold — because `lint.test.js` asserts the linter's import graph is exactly
// `['./parse.js']`, since a linter that could reach an evaluator could reach a
// verdict by RUNNING a formula. `bind.js` imports `interpret.js`, so the predicate
// could not live there and still be visible to the linter. It reads the tree and
// never runs it, so that guarantee holds in the letter and in the purpose.

import { describe, it, expect } from 'vitest'
import {
  bindFoldableWindow, isBindFoldableLength, bindFoldableWindowMax, BIND_TIME_CLOCK,
} from './parse.js'
import { foldScalar, bindingConstants } from './bind.js'
import { lintRepaint } from './lint.js'

/** A binding supplying everything a length may read: the chart's timeframe and
 *  the definition's inputs. Deliberately NOT a symbol — a length may not depend
 *  on one, and if some future edit lets it, the FOLDABLE cases start throwing. */
const CONSTS = bindingConstants({
  timeframe: { isweekly: false, isdaily: true, ismonthly: false, isintraday: false },
  inputs: { lenDaily: 20, lenWeekly: 5, half: 7 },
})

const num = (v) => ({ type: 'num', value: v })
const clock = (name) => ({ type: 'series', name })
const input = (name, def) => ({ type: 'series', name, inputDefault: def })
const op = (name, ...args) => ({ type: 'op', name, args })
const call = (name, ...args) => ({ type: 'call', name, args })

/** ⭐ LINE 233 ITSELF. Referenced by three cases below, so the shape under test is
 *  written once. */
const LINE_233 = () =>
  op('?:', clock('isweekly'), input('lenWeekly', 5), input('lenDaily', 20))

// ── all three gates say YES, and the BOUND is asserted, not just its existence ──
const FOLDABLE = [
  ['a plain literal', num(20), 20],
  ['⭐ LINE 233 ITSELF — a timeframe ternary over two inputs', LINE_233(), 20],
  ['a timeframe ternary over two literals', op('?:', clock('isweekly'), num(5), num(20)), 20],
  ['…and the bound does NOT depend on arm order', op('?:', clock('isweekly'), num(20), num(5)), 20],
  ['a bare input default', input('lenDaily', 20), 20],
  ['a nested ternary bounds to the largest leaf',
    op('?:', clock('isdaily'), num(10), op('?:', clock('isweekly'), num(5), num(50))), 50],
  ['a bare clock name is 0-or-1, so it bounds at 1', clock('isweekly'), 1],
]

// ── all three say NO ───────────────────────────────────────────────────────────
const NOT_FOLDABLE = [
  ['a bar series', { type: 'series', name: 'close' }],
  ['a history offset', { type: 'offset', args: [{ type: 'series', name: 'close' }, num(1)] }],
  ['a clock name that is NOT bind-time (dayofweek reads the BAR)', clock('dayofweek')],
  ['a ternary with the wrong arity', op('?:', clock('isweekly'), num(5))],
  ['a ternary whose SELECTOR cannot fold',
    op('?:', { type: 'series', name: 'close' }, num(5), num(20))],
  ['a user variable the binding does not supply', { type: 'series', name: 'myLocal' }],
  ['text, which can fold but not predictably',
    { type: 'textop', name: 'length', args: [{ type: 'symtext', name: 'prefix' }] }],
  ['a request node', { type: 'tf', args: [num(1)] }],
  ['a bar series buried inside an otherwise-foldable ternary arm',
    op('?:', clock('isweekly'), num(5), op('+', num(2), { type: 'series', name: 'close' }))],
  ['null', null],
  ['a bare number, not a node', 20],
]

/** ⭐⭐⭐ THE CATEGORY THAT STATES THE ASYMMETRY. `foldScalar` CAN settle every one
 *  of these — it handles arithmetic, comparisons, unary operators and the declared
 *  scalar calls — and the predicate declines them anyway, because bounding them by
 *  READING would need a premise this engine will not make. Bounding `a + b` needs
 *  "both arms non-negative"; bounding `min(a, b)` needs its own argument. A bound
 *  resting on an unstated premise is how an UNDER-stated window ships, and an
 *  under-stated window is the one direction a budget cannot absorb.
 *
 *  ⛔ THESE FIVE WERE `FOLDABLE` UNTIL THE LINTER WAS WIRED, and moving them is the
 *  whole content of that change. The cost is a refusal that was already being made
 *  before 2026-09-10; the alternative was a door that defers what the linter then
 *  brands `repaints`. */
const FOLD_ONLY = [
  ['arithmetic over inputs', op('+', input('lenDaily', 20), num(2)), 22],
  ['a declared scalar call', call('max', input('lenDaily', 20), num(5)), 20],
  ['a comparison feeding a ternary',
    op('?:', op('>', input('lenDaily', 20), num(10)), num(50), num(2)), 50],
  ['unary minus over a literal', op('u-', num(5)), -5],
  ['negation over a clock name', op('!', clock('isintraday')), 1],
]

describe('⛔⛔ L2 — the door, the fold and the linter agree case for case', () => {
  it('⭐ NON-VACUITY — the manifest gives the clock names this rests on', () => {
    expect(BIND_TIME_CLOCK, 'the bind-time clock roster is empty — every timeframe '
      + 'case below is vacuous').toContain('isweekly')
  })

  it('⭐ NON-VACUITY — the corpus exercises all THREE answers', () => {
    expect(FOLDABLE.length).toBeGreaterThan(4)
    expect(NOT_FOLDABLE.length).toBeGreaterThan(4)
    expect(FOLD_ONLY.length, 'the FOLD_ONLY category is empty — either the predicate '
      + 'now admits everything the fold can evaluate (check the linter can bound it '
      + 'all) or the asymmetry this file documents has gone').toBeGreaterThan(0)
  })

  for (const [label, node, bound] of FOLDABLE) {
    it(`⭐ ALL THREE GATES — ${label}`, () => {
      // 1. the save door's predicate
      expect(isBindFoldableLength(node), 'the door would go on refusing this').toBe(true)

      // 2. the bind stage actually settles it
      let value = null
      let threw = null
      try { value = foldScalar(node, CONSTS) } catch (err) { threw = err }
      expect(threw, `the predicate promised this folds and foldScalar THREW `
        + `(${threw && threw.what}) — a false TRUE is the expensive direction: the `
        + `door stops refusing and the failure surfaces later and elsewhere`).toBeNull()
      expect(Number.isFinite(value), `folded to a non-finite ${value}`).toBe(true)

      // 3. ⭐⭐ THE LINTER PUTS A NUMBER ON IT, AND THE NUMBER IS ASSERTED.
      // "it returned something" would pass for a bound of 1 on a 200-bar window.
      expect(bindFoldableWindowMax(node), `the linter bounds this at a DIFFERENT `
        + `number than the corpus declares — an under-stated bound lets a formula `
        + `read a bar the budget never paid for`).toBe(bound)

      // ⛔ AND THE BOUND IS AN UPPER BOUND ON WHAT THE FOLD ACTUALLY PRODUCES,
      // for the binding under test. This is the property the whole design rests
      // on; asserting the number alone would not catch a bound that is exact for
      // the corpus and too small for a real binding.
      expect(bindFoldableWindowMax(node)).toBeGreaterThanOrEqual(value)
    })
  }

  for (const [label, node] of NOT_FOLDABLE) {
    it(`⛔ NO GATE — ${label}`, () => {
      expect(isBindFoldableLength(node), 'the predicate promised a fold for a node '
        + 'that reads a bar, a request or a symbol').toBe(false)
      expect(bindFoldableWindowMax(node), 'the linter put a number on a length it '
        + 'cannot read').toBeNull()
    })
  }

  for (const [label, node, foldsTo] of FOLD_ONLY) {
    it(`⚠️ FOLD-ONLY — the stage can settle it, the linter cannot bound it — ${label}`, () => {
      // ⛔ THE CONTROL. If foldScalar could NOT settle this, the case would belong
      // in NOT_FOLDABLE and would prove nothing about the asymmetry.
      expect(foldScalar(node, CONSTS), 'foldScalar can no longer settle this, so it '
        + 'is not a FOLD-ONLY case at all').toBe(foldsTo)

      // …and both the door and the linter decline it, together.
      expect(isBindFoldableLength(node), 'the predicate now admits a shape the '
        + 'linter cannot bound — the door will defer a length that then brands the '
        + 'formula `repaints`, which is the exact regression of 2026-09-10').toBe(false)
      expect(bindFoldableWindowMax(node)).toBeNull()
    })
  }

  it('⭐⭐ LINE 233 FOLDS TO A DIFFERENT INTEGER PER TIMEFRAME, and bounds at the larger', () => {
    const daily = foldScalar(LINE_233(), bindingConstants({
      timeframe: { isweekly: false, isdaily: true }, inputs: { lenDaily: 20, lenWeekly: 5 },
    }))
    const weekly = foldScalar(LINE_233(), bindingConstants({
      timeframe: { isweekly: true, isdaily: false }, inputs: { lenDaily: 20, lenWeekly: 5 },
    }))
    expect([daily, weekly]).toEqual([20, 5])
    expect(daily, 'both timeframes folded to the SAME length — the deferral buys '
      + 'nothing and the save-time refusal was right').not.toBe(weekly)
    // ⛔ 20, NOT 5 AND NOT "WHICHEVER MATCHES THE CHART".
    expect(bindFoldableWindowMax(LINE_233())).toBe(Math.max(daily, weekly))
  })

  it('⛔ AN ABSENT BINDING STILL REFUSES — the predicate is about the TREE', () => {
    expect(isBindFoldableLength(LINE_233())).toBe(true)
    let threw = null
    try { foldScalar(LINE_233(), bindingConstants({})) } catch (err) { threw = err }
    expect(threw, 'a binding that knows no timeframe folded the length anyway — '
      + 'something defaulted, and a guessed timeframe is a confident wrong length')
      .not.toBeNull()
  })

  /** ⚠️ THE DEFINITION'S DECLARED INPUT KEYS, as `lintDefinition` supplies them:
   *  it calls `lintRepaint(ast, { ...opts, inputs: declaredInputs(def) })`. Omitting
   *  them makes the linter answer `repaints` for a REASON THAT HAS NOTHING TO DO
   *  WITH THE WINDOW — "`lenWeekly` is not a series this table declares" — and a
   *  test that omitted them would read as "the wiring does not work" while
   *  measuring an unrepresentative call. Cost me a debugging round; written down
   *  so it costs the next reader none. */
  const INPUTS = Object.assign(Object.create(null), { lenWeekly: true, lenDaily: true })

  it('⭐⭐ END TO END — the LINTER BOUNDS line 233 AT THE LARGER ARM', () => {
    // ⛔ THE ONE THAT PROVES THE WIRE. Every assertion above holds if
    // `bindFoldableWindowMax` is perfect and `resolveDeclaration` never calls it —
    // which was this repo's state until today. `sma`'s lookback is declared `arg1`,
    // so an unbounded window here is what produced the `repaints` badge that made
    // the script unsaveable even after the save door stopped refusing it.
    const ast = { type: 'call', name: 'sma', args: [{ type: 'series', name: 'close' }, LINE_233()] }
    const verdict = lintRepaint(ast, { inputs: INPUTS })
    expect(verdict.mode, 'the linter still cannot bound a bind-foldable window, so '
      + 'the formula is branded repainting and canSaveFormula refuses it — the door '
      + 'may not be wired until this passes').toBe('non-repainting')
    // ⛔⛔ AND THE BOUND IS 20, THE WEEKLY-ARM MAXIMUM — not 5, and not "whichever
    // arm matches today's chart". A verdict alone would pass for a linter that
    // bounded this at 5 and let a 20-bar window read bars nothing paid for.
    expect(verdict.back, 'the lookback is not the largest arm').toBe(20)
    expect(verdict.forward).toBe(0)
  })

  it('⛔ …and a FOLD-ONLY length is still branded repainting, by NAME', () => {
    // The discriminator for the case above. Without it, that test passes for a
    // linter that bounds everything — a far worse defect than the one being fixed.
    const ast = {
      type: 'call',
      name: 'sma',
      args: [{ type: 'series', name: 'close' },
        op('+', input('lenDaily', 20), num(2))],
    }
    const verdict = lintRepaint(ast, { inputs: INPUTS })
    expect(verdict.mode, 'the linter bounded a length the predicate declines — the '
      + 'two have come apart, and the door will now defer what this then brands')
      .not.toBe('non-repainting')
    // ⭐ AND IT REFUSES FOR THE RIGHT REASON. With the inputs declared, "unknown
    // series" is off the table, so the only remaining objection must be the window
    // itself — which is what makes this a test of the window rule rather than of
    // input resolution.
    expect(verdict.reasons.join(' ')).toMatch(/window this linter cannot bound/)
  })
})
