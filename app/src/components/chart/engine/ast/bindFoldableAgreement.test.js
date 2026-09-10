// ─── ⭐⭐⭐ D-2 — THE PREDICATE AND THE FOLD MUST AGREE, OR THE DOOR LIES ──────
//
// `isBindFoldableLength` is what the SAVE door now consults before refusing a
// window (`pine.js`, the `pine:window` site). If it says yes, the door lets a
// non-literal length through UNFOLDED and the bind stage settles it per binding.
// So the predicate is not advisory — a refusal is withheld on the strength of it.
//
// ⛔⛔ THE CONTRACT IS ONE-DIRECTIONAL AND THE TWO DIRECTIONS COST DIFFERENT
// THINGS. `true` must mean *"`foldScalar` succeeds for EVERY binding that supplies
// the clock and the inputs"*. A false TRUE is the expensive one: the door stops
// refusing, the member saves the script, and the failure surfaces later and
// somewhere else. A false FALSE costs only a refusal that was already being made
// — the pre-2026-09-10 behaviour — and can never produce a wrong number.
//
// ⭐ SO THE ASSERTIONS ARE ASYMMETRIC ON PURPOSE. Every `true` case is driven
// through the real `foldScalar` and must produce a finite number. Every `false`
// case is required to be genuinely unfoldable, which is what stops the predicate
// being made "safe" by simply answering false to everything.
//
// ⚠️ THIS IS NOT A TEST OF WHAT FOLDS. `bindStage.test.js` owns that. This file
// owns only the AGREEMENT between the predicate and the fold, which is the thing
// that can rot silently when someone adds a name to `FOLD_CALLS` or `BINARY` and
// not to the other.

import { describe, it, expect } from 'vitest'
import {
  isBindFoldableLength, foldScalar, bindingConstants, BIND_TIME_CLOCK,
} from './bind.js'

/** A binding that supplies everything a length is allowed to read: the chart's
 *  timeframe and the definition's inputs. Deliberately NOT a symbol — a length
 *  may not depend on one, and if some future edit lets it, the FOLDABLE cases
 *  below start throwing and this file says so. */
const CONSTS = bindingConstants({
  timeframe: { isweekly: false, isdaily: true, ismonthly: false, isintraday: false },
  inputs: { lenDaily: 20, lenWeekly: 5, half: 7 },
})

const num = (v) => ({ type: 'num', value: v })
const clock = (name) => ({ type: 'series', name })
const input = (name, def) => ({ type: 'series', name, inputDefault: def })
const op = (name, ...args) => ({ type: 'op', name, args })
const call = (name, ...args) => ({ type: 'call', name, args })

// ── cases the predicate must accept, and the fold must then honour ──────────
const FOLDABLE = [
  ['a plain literal', num(20)],
  ['⭐ LINE 233 ITSELF — a timeframe ternary over two inputs',
    op('?:', clock('isweekly'), input('lenWeekly', 5), input('lenDaily', 20))],
  ['a timeframe ternary over two literals', op('?:', clock('isweekly'), num(5), num(20))],
  ['a bare input default', input('lenDaily', 20)],
  ['arithmetic over inputs', op('+', input('lenDaily', 20), num(2))],
  ['a nested ternary', op('?:', clock('isdaily'), num(10),
    op('?:', clock('isweekly'), num(5), num(1)))],
  ['a declared scalar call', call('max', input('lenDaily', 20), num(5))],
  ['a comparison feeding a ternary',
    op('?:', op('>', input('lenDaily', 20), num(10)), num(50), num(2))],
  ['unary minus over a literal', op('u-', num(5))],
  ['negation over a clock name', op('!', clock('isintraday'))],
]

// ── cases the predicate must refuse ────────────────────────────────────────
const NOT_FOLDABLE = [
  ['a bar series', { type: 'series', name: 'close' }],
  ['a history offset', { type: 'offset', args: [{ type: 'series', name: 'close' }, num(1)] }],
  ['a clock name that is NOT bind-time (dayofweek reads the BAR)', clock('dayofweek')],
  ['an undeclared scalar call', call('log', num(5))],
  ['an operator the fold does not admit', op('%', num(5), num(2))],
  ['a ternary with the wrong arity', op('?:', clock('isweekly'), num(5))],
  ['a user variable the binding does not supply', { type: 'series', name: 'myLocal' }],
  ['⚠️ TEXT, WHICH CAN FOLD BUT NOT PREDICTABLY',
    { type: 'textop', name: 'length', args: [{ type: 'symtext', name: 'prefix' }] }],
  ['a request node', { type: 'tf', args: [num(1)] }],
  ['a bar series buried inside otherwise-foldable arithmetic',
    op('+', num(2), op('*', num(3), { type: 'series', name: 'close' }))],
  ['null', null],
  ['a bare number, not a node', 20],
]

describe('⛔⛔ D-2 — isBindFoldableLength agrees with foldScalar', () => {
  it('⭐ NON-VACUITY — the manifest gives the clock names this rests on', () => {
    // Without a clock roster every FOLDABLE case below degenerates to literals
    // and arithmetic, and the file would prove nothing about bind-time constants.
    expect(BIND_TIME_CLOCK, 'the bind-time clock roster is empty — every '
      + 'timeframe case below is vacuous').toContain('isweekly')
  })

  it('⭐ NON-VACUITY — the corpus exercises BOTH answers', () => {
    expect(FOLDABLE.length).toBeGreaterThan(5)
    expect(NOT_FOLDABLE.length).toBeGreaterThan(5)
  })

  for (const [label, node] of FOLDABLE) {
    it(`⭐ FOLDABLE, and the fold honours it — ${label}`, () => {
      expect(isBindFoldableLength(node),
        `the predicate refused a length the fold can settle; the door would go on `
        + `refusing this script for a reason that is false of it`).toBe(true)

      // ⛔⛔ THE HALF THAT MAKES THIS A RAIL. The predicate saying yes is worth
      // nothing unless the fold then delivers — that gap is precisely what a
      // door withholding a refusal is betting on.
      let value = null
      let threw = null
      try { value = foldScalar(node, CONSTS) } catch (err) { threw = err }
      expect(threw, `the predicate promised this folds and foldScalar THREW `
        + `(${threw && threw.what}) — a false TRUE is the expensive direction: the `
        + `door stops refusing and the failure surfaces later and elsewhere`)
        .toBeNull()
      expect(Number.isFinite(value),
        `folded to a non-finite ${value}`).toBe(true)
    })
  }

  for (const [label, node] of NOT_FOLDABLE) {
    it(`⛔ NOT foldable, and genuinely so — ${label}`, () => {
      expect(isBindFoldableLength(node),
        'the predicate promised a fold for a node that reads a bar, a request or a '
        + 'symbol').toBe(false)

      // ⛔ THE CONTROL THAT STOPS "SAFE" MEANING "ALWAYS FALSE". If foldScalar
      // could settle this after all, the predicate is needlessly refusing and the
      // door is refusing scripts the engine could run — which is the exact defect
      // this whole change exists to remove, pointing the other way.
      let threw = null
      try { foldScalar(node, CONSTS) } catch (err) { threw = err }
      expect(threw, 'the predicate said NO but foldScalar settled it anyway — the '
        + 'predicate is stricter than the fold, so the door is still refusing '
        + 'scripts this engine can already run').not.toBeNull()
    })
  }

  it('⭐⭐ LINE 233 FOLDS TO A DIFFERENT INTEGER PER TIMEFRAME, end to end', () => {
    // The whole ruling in one assertion: the door defers this shape, and the
    // stage then answers a DIFFERENT number for each binding. If it answered the
    // same number both ways the deferral would be pointless and the save-time
    // refusal would have been right after all.
    const line233 = op('?:', clock('isweekly'), input('lenWeekly', 5), input('lenDaily', 20))
    expect(isBindFoldableLength(line233)).toBe(true)

    const daily = foldScalar(line233, bindingConstants({
      timeframe: { isweekly: false, isdaily: true },
      inputs: { lenDaily: 20, lenWeekly: 5 },
    }))
    const weekly = foldScalar(line233, bindingConstants({
      timeframe: { isweekly: true, isdaily: false },
      inputs: { lenDaily: 20, lenWeekly: 5 },
    }))
    expect(daily).toBe(20)
    expect(weekly).toBe(5)
    expect(daily, 'both timeframes folded to the SAME length — the deferral buys '
      + 'nothing and the save-time refusal was right').not.toBe(weekly)
  })

  it('⭐⭐ THE PERMITTED ASYMMETRY, STATED AND PINNED — stricter is SAFE', () => {
    // ⛔ THIS CASE WAS WRITTEN AS AN EQUALITY ASSERTION AND WENT RED, CORRECTLY.
    // `foldScalar` settles a `series` node whenever the BINDING happens to carry
    // that name; the predicate accepts one only when the NODE carries an
    // `inputDefault`. So the fold is broader here, and the predicate declines
    // something the fold would have settled.
    //
    // ⭐ THAT DIRECTION IS THE SAFE ONE AND IT IS DELIBERATE. The door withholds
    // a refusal on a TRUE, so a false TRUE ships a wrong promise; a false FALSE
    // costs only the refusal that was already being made. The predicate must
    // therefore be a SUBSET of what the fold can do, never a superset.
    //
    // ⚠️ AND IT COSTS NOTHING AT THE REAL DOOR: an `input.*` reaches
    // `translatePine` as a `series` node CARRYING `inputDefault` (that is what
    // `constantValueOf` folds), so the shape below is a user variable or a bar
    // series in practice, and neither may set a window.
    const bare = { type: 'series', name: 'lenDaily' }
    expect(isBindFoldableLength(bare), 'the predicate accepted a bare series with '
      + 'no inputDefault — it is now a SUPERSET of the fold, and the door can '
      + 'withhold a refusal for a length nothing will settle').toBe(false)
    expect(foldScalar(bare, CONSTS), 'the fold no longer settles a bound name, so '
      + 'the asymmetry this test documents has disappeared and the comment above '
      + 'is stale').toBe(20)
  })

  it('⛔ AN ABSENT BINDING STILL REFUSES — the predicate is about the TREE', () => {
    // ⚠️ `isBindFoldableLength` says "this CAN fold given a binding", never "it
    // folds right now". A door that read it as the latter would defer a length
    // into a stage that has nothing to fold it with.
    const line233 = op('?:', clock('isweekly'), input('lenWeekly', 5), input('lenDaily', 20))
    expect(isBindFoldableLength(line233)).toBe(true)
    let threw = null
    try { foldScalar(line233, bindingConstants({})) } catch (err) { threw = err }
    expect(threw, 'a binding that knows no timeframe folded the length anyway — '
      + 'something defaulted, and a guessed timeframe is a confident wrong length')
      .not.toBeNull()
  })
})
