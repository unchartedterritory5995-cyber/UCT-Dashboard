// app/src/components/chart/engine/ast/pineClockUnits.test.js
//
// ─── ⛔⛔ PINE'S `time` IS MILLISECONDS. OURS IS SECONDS. ───────────────────
//
// `closedTable.json::clock.time` is SECONDS since 1970. Pine's `time` is
// MILLISECONDS since 1970. This engine held the column, held it under the same
// spelling, and REFUSED to bind it — correctly, and the refusal says why:
//
//     "a thousand-fold difference that would compare true against no literal a
//      member wrote, on every bar, without ever looking wrong"
//
// ⭐⭐ THAT REFUSAL WAS THE RIGHT CALL AND IS NOT WHAT CHANGES HERE. Binding on
// SPELLING alone would have been a silent mistranslation, which is the one
// outcome worse than a refusal. What changes is that the difference is EXACTLY
// RECONCILABLE — our seconds are whole seconds, so `time * 1000` is Pine's
// value with nothing lost — and this file is the proof that the reconciliation
// is applied where Pine is spoken and nowhere else.
//
// ⛔ AND THAT BOUNDARY IS THE WHOLE RISK. `time` is a name in BOTH vocabularies:
// a member typing `time` in the formula box means OUR column, in seconds. The
// transform is therefore gated on the script declaring a `//@version`, which is
// the same discriminator `legacyBareNamespace.test.js` established for bare
// `pivothigh` — one name table, two languages, and the version pragma is what
// says which one is being spoken.
import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'
import { buildObjectLane } from '../runtime/objectLane.js'

const LF = String.fromCharCode(10)
const Q = String.fromCharCode(34)
const head = (v) => `//@version=${v}${LF}${v >= 5 ? 'indicator' : 'study'}(${Q}t${Q})${LF}`

/** The selected output's formula, or the refusal that stopped it. */
function formula(src) {
  const out = translatePine(src, { strict: true })
  if (!out.ok) return `REFUSED ${(out.refusal || {}).guard}: ${(out.refusal || {}).message}`
  return String(out.outputs[out.selected].formula)
}

describe('⛔⛔ a Pine script\'s `time` is MILLISECONDS, ours is SECONDS', () => {
  it('⭐⭐ a v5 script binds `time`, reconciled to Pine\'s unit', () => {
    const f = formula(`${head(5)}plot(time)${LF}`)
    expect(f.startsWith('REFUSED'), f).toBe(false)
    // ⛔ THE COLUMN AND THE FACTOR, BOTH. Asserting only that it stopped
    // refusing would pass for a binding that hands back seconds under Pine's
    // name — which is the silent mistranslation the old refusal existed to
    // prevent, arriving through the fix for it.
    expect(f).toContain('time')
    expect(f).toContain('1000')
  })

  it('⭐ every Pine version means milliseconds — this is not a v5 rule', () => {
    // Pine's `time` has been milliseconds since v1, so the reconciliation is
    // not version-conditional the way the bare-`ta.` spelling is.
    for (const v of [4, 5, 6]) {
      const f = formula(`${head(v)}plot(time)${LF}`)
      expect(f.startsWith('REFUSED'), `v${v}: ${f}`).toBe(false)
      expect(f, `v${v} did not reconcile the unit`).toContain('1000')
    }
  })

  it('⛔⛔ THE VERSIONLESS PATH IS UNTOUCHED — it still refuses, exactly as before', () => {
    // ⭐ THE BOUND ON THE FIX, and it is deliberately narrower than it could be.
    //
    // A source with no `//@version` is the formula box, where `time` is OUR
    // name and means SECONDS. Two things could be done there and only one is
    // done here:
    //
    //   ⛔ NOT the transform — multiplying a member's own column by a thousand
    //      under their own vocabulary is the exact mistranslation this guard
    //      exists to prevent, arriving through its fix.
    //   ⚠️ NOT a seconds binding either, though we do hold the column and it
    //      would probably be right. That is a CHANGE TO THE BOX, with the
    //      screener and every other formula consumer downstream of it, and it
    //      is not what was measured here. Measured: 5 corpus scripts refused
    //      because a PINE script could not read `time`. Nothing in that
    //      measurement says anything about the box.
    //
    // So the versionless path keeps the refusal it has today, and this case
    // pins that — a fix is only as wide as the lane you measured it in.
    const boxed = formula(`indicator(${Q}t${Q})${LF}plot(time)${LF}`)
    expect(boxed.startsWith('REFUSED'), 'the versionless path changed — that is '
      + 'a decision about the formula box, not about Pine').toBe(true)
    expect(boxed).toContain('MILLISECONDS')
  })

  it('⛔ a millisecond literal now compares against it, which is the point', () => {
    // ⚰️ THE FAILURE THE OLD REFUSAL DESCRIBED, in one line: a second-count
    // compared against a millisecond literal answers false on every bar,
    // forever, without ever looking wrong.
    const f = formula(`${head(5)}plot(time > 1600000000000 ? 1 : 0)${LF}`)
    expect(f.startsWith('REFUSED'), f).toBe(false)
    expect(f).toContain('1000')
  })

  it('⛔⛔ AND THE DRAWING LANE GETS IT TOO — a transform must reach BOTH lanes', () => {
    // ⚰️⚰️ THIS IS RC-E, AND IT IS WHY THIS CASE EXISTS RATHER THAN BEING
    // ASSUMED. RC-A taught the resolver that a bare `pivothigh` in a v4 script
    // is Pine's shifted column, verified it through `translatePine`, and
    // shipped. The lane that DRAWS never got it: `pineRuntimeFrontend.js`
    // builds its own resolver with `new Resolver(env, TABLE, new Map(), {})` —
    // an EMPTY options object, so `pineVersion` is null and every
    // version-conditional rule silently answers "not Pine".
    //
    // ⛔ The same omission swallowed this fix on its first run: the columnar
    // lane bound `time` correctly and the object lane still refused, with the
    // corpus census moving by exactly zero. A fix is only as wide as the lane
    // you measured it in.
    const LF2 = LF
    const src = `//@version=5${LF2}indicator(${Q}t${Q}, overlay = true)${LF2}`
      + `label.new(bar_index, high, str.tostring(time))${LF2}`
    const lane = buildObjectLane(src, { tf: 'D', newestBarIsForming: false })
    expect(lane.ok, lane.ok ? '' : `${lane.lane}/${(lane.refusal || {}).guard}: `
      + `${String((lane.refusal || {}).message).slice(0, 120)}`).toBe(true)
  })

  it('⛔ CONTROL — a clock name whose meaning ALREADY matches is untouched', () => {
    // ⭐ The transform must move only the name whose unit differs. `bar_index`
    // is the same integer in both vocabularies and must not acquire a factor.
    const f = formula(`${head(5)}plot(bar_index)${LF}`)
    expect(f.startsWith('REFUSED'), f).toBe(false)
    expect(f, '`bar_index` was given a unit conversion it does not need')
      .not.toContain('1000')
  })
})
