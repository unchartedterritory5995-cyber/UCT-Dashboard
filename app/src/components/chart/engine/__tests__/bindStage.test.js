// ─── THE BIND STAGE — a symbolic definition folds PER BINDING, and only there ──
//
// ⛔⛔ THE FOLD IS BIND-TIME, NOT SAVE-TIME, AND THE DIFFERENCE IS A WRONG NUMBER.
// `translatePine` runs at SAVE time: there is no symbol and no timeframe yet, so
// it cannot fold `timeframe.isweekly ? 5 : 20` and its refusal there is CORRECT.
// Folding at the door would bake one binding's answer into a shared definition,
// and `foldBound`'s own header names the consequence: the next symbol folds it
// differently, so a pass that rewrote in place would let the second symbol of a
// sweep inherit the first's lengths — "a defect that shows as a WRONG NUMBER, not
// an error." That is why this stage sits between save and compute.
//
// ⭐ THE VENDOR HALF IS SETTLED, so what is asserted here is placement, not
// behaviour. Measured on a live chart 2026-09-10 (job B,
// `tests/fixtures/vendor/fold-numeric-spy-1d-1w-2026-09-10.json`): a
// timeframe-conditional length folds to a plain integer at bind time —
// `fold == sma20` on 400/400 daily bars and `fold == sma5` on 400/400 weekly.
// These numbers are that reading, not a guess about it.
//
// ⛔ AND NOTHING FOLDED IS EVER PERSISTED. `foldBound` returns a NEW tree and
// mutates nothing; the test below holds it to that against a pristine deep copy,
// because the saved definition must go on meaning what it said.

import { describe, it, expect } from 'vitest'
import { foldBound, bindingConstants, intSlots, BIND_TIME_CLOCK } from '../ast/bind'
import { computeFor } from '../nativeRegistry'

/** `ta.sma(close, timeframe.isweekly ? 5 : 20)` — Uncharted Volume line 233's
 *  shape, which is the refusal this whole stage exists to clear. */
const symbolic = () => ({
  type: 'call',
  name: 'sma',
  args: [
    { type: 'series', name: 'close' },
    {
      type: 'op',
      name: '?:',
      args: [
        { type: 'series', name: 'isweekly' },
        { type: 'num', value: 5 },
        { type: 'num', value: 20 },
      ],
    },
  ],
})

const lengthOf = (tree) => tree.args[1]

describe('⛔ the bind stage folds per binding, and only per binding', () => {
  it('⭐ NON-VACUITY — the manifest declares an int slot for sma at all', () => {
    // Without an int slot nothing folds, every assertion below passes trivially,
    // and this file would be measuring the absence of an opportunity.
    expect(intSlots('sma'), 'the manifest declares no int slot for `sma`, so '
      + 'foldBound has nothing to rewrite and this file proves nothing')
      .toContain(1)
  })

  it('⭐ NON-VACUITY — the clock names this binds on are read off the manifest', () => {
    expect(BIND_TIME_CLOCK, 'BIND_TIME_CLOCK is empty — the bind-time constant '
      + 'roster is not being read, so no timeframe can ever fold')
      .toContain('isweekly')
  })

  it('⛔⛔ THE RULING — one symbolic tree, two timeframes, two integers', () => {
    const daily = foldBound(symbolic(), bindingConstants({
      timeframe: { isweekly: false, isdaily: true },
    }))
    const weekly = foldBound(symbolic(), bindingConstants({
      timeframe: { isweekly: true, isdaily: false },
    }))

    expect(lengthOf(daily), 'the daily binding did not fold to a plain integer — '
      + 'this is the refusal at Uncharted Volume line 233 and the whole point of '
      + 'the stage').toEqual({ type: 'num', value: 20 })
    expect(lengthOf(weekly), 'the weekly binding did not fold to a plain integer')
      .toEqual({ type: 'num', value: 5 })

    // ⛔ THE DISCRIMINATOR. Without it this passes for a stage that folds to one
    // constant regardless of the binding — which is exactly the save-time bug.
    expect(lengthOf(daily).value, 'both bindings folded to the SAME length, so '
      + 'the fold is not reading the binding — that is the save-time defect '
      + 'wearing a bind-time name').not.toBe(lengthOf(weekly).value)

    // The measured vendor answer, from job B. 20 on daily, 5 on weekly.
    expect([lengthOf(daily).value, lengthOf(weekly).value]).toEqual([20, 5])
  })

  it('⛔ AN UNFOLDABLE LENGTH IS LEFT IN PLACE so the check downstream names it', () => {
    // `x[1]` reads bars, so it is not bind-time knowable. The stage must NOT
    // guess and must NOT throw here — it leaves the node exactly as it was, and
    // the window check refuses the member's own expression by name.
    const tree = symbolic()
    tree.args[1] = { type: 'offset', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 1 }] }
    const bound = foldBound(tree, bindingConstants({ timeframe: { isweekly: true } }))
    expect(lengthOf(bound).type, 'an unfoldable length was rewritten — the stage '
      + 'guessed instead of leaving the refusal to name the field')
      .toBe('offset')
  })

  it('⛔ AN ABSENT TIMEFRAME FOLDS NOTHING — it does not default', () => {
    const bound = foldBound(symbolic(), bindingConstants({}))
    expect(lengthOf(bound).type, 'a binding that knows no timeframe still folded '
      + 'the length — a guessed timeframe is a confident wrong length')
      .toBe('op')
  })

  it('⛔⛔ R-c — THE INPUT TREE IS NOT MUTATED, so nothing folded can be saved', () => {
    const tree = symbolic()
    const pristine = JSON.parse(JSON.stringify(tree))
    const bound = foldBound(tree, bindingConstants({ timeframe: { isweekly: true } }))
    expect(tree, 'foldBound MUTATED its input. The saved definition must go on '
      + 'meaning what it said — an in-place rewrite lets the second symbol of a '
      + 'sweep inherit the first symbol\'s lengths, which shows as a wrong '
      + 'number rather than an error.').toEqual(pristine)
    expect(bound).not.toBe(tree)
    expect(lengthOf(bound)).toEqual({ type: 'num', value: 5 })
  })

  it('⭐ a second fold of the SAME saved tree is unaffected by the first', () => {
    // The sweep case, stated directly: fold for weekly, then for daily, off one
    // saved tree. If the first leaked, the second would answer 5.
    const saved = symbolic()
    foldBound(saved, bindingConstants({ timeframe: { isweekly: true } }))
    const second = foldBound(saved, bindingConstants({ timeframe: { isweekly: false, isdaily: true } }))
    expect(lengthOf(second).value, 'the second binding inherited the first '
      + 'binding\'s length — this is the sweep defect the stage exists to avoid')
      .toBe(20)
  })

  // ── THE WIRING, not just the function ─────────────────────────────────────

  /** 30 bars of a rising close, so a 5-length and a 20-length average are far
   *  apart and cannot coincide by luck. */
  const BARS = Array.from({ length: 30 }, (_, i) => ({
    t: 1761811200 + i * 86400, o: 100 + i, h: 100 + i, l: 100 + i, c: 100 + i, v: 1,
  }))

  const defWithConditionalLength = () => ({
    id: 'bind-stage-e2e',
    compute: { kind: 'ast', ast: symbolic() },
    plots: [{ key: 'v', style: 'line' }],
  })

  it('⭐⭐ END TO END — computeFor folds the length from the ctx timeframe', () => {
    // ⛔ THIS IS THE ONE THAT PROVES THE WIRING. Every assertion above holds if
    // `foldBound` is perfect and NOTHING CALLS IT — which was the state of this
    // repo until today: bind.js had zero live importers.
    const daily = Array.from(computeFor(defWithConditionalLength(), BARS, {}, { tf: 'D' }).v)
    const weekly = Array.from(computeFor(defWithConditionalLength(), BARS, {}, { tf: 'W' }).v)

    const last = (a) => a[a.length - 1]
    expect(Number.isFinite(last(daily)), 'the daily binding produced no number — '
      + 'the length never folded, so the column refused').toBe(true)
    expect(Number.isFinite(last(weekly)), 'the weekly binding produced no number')
      .toBe(true)

    // A 5-bar mean of a rising series sits ABOVE a 20-bar mean of the same
    // series, and by a wide margin over 30 bars. Same definition, same bars,
    // two bindings, two answers.
    expect(last(weekly), 'the two bindings computed the SAME column, so the ctx '
      + 'timeframe is not reaching the fold — the wire is cut')
      .not.toBeCloseTo(last(daily), 6)
    expect(last(weekly), 'the 5-length mean of a rising series should exceed the '
      + '20-length mean; got weekly=' + last(weekly) + ' daily=' + last(daily))
      .toBeGreaterThan(last(daily))
  })

  it('⛔ an UNKNOWN ctx timeframe folds nothing and REFUSES BY NAME', () => {
    // ⭐⭐ R-b, EXACTLY. An unresolvable length is not passed through as a guess
    // and is not quietly blanked — it REFUSES, and the refusal names the window.
    // `timeframeFlags('4h')` returns null (never a default), so the ternary stays
    // symbolic and the window check downstream has a non-literal length to name.
    let caught = null
    try {
      computeFor(defWithConditionalLength(), BARS, {}, { tf: '4h' })
    } catch (err) { caught = err }
    expect(caught, 'an unknown timeframe produced a COLUMN. Something defaulted, '
      + 'and a guessed length is a confident wrong answer — the one outcome this '
      + 'stage exists to prevent').toBeTruthy()
    expect(String(caught.guard || caught.message), 'the refusal does not name the '
      + 'window, so a member cannot tell which length stopped them')
      .toMatch(/window/i)
  })
})
