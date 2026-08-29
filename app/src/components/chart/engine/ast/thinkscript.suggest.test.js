// app/src/components/chart/engine/ast/thinkscript.suggest.test.js
//
// ─── ⭐⭐ A SUGGESTION THAT DOES NOT WORK IS WORSE THAN NO SUGGESTION ─────────
//
// thinkorswim does not publish a default for several study parameters — `price`,
// `length`, `displace`. This door REFUSES to assume one, and that ruling stands:
// `displace` shifts every bar, and a `price` guessed wrong draws a plausible
// column that is wrong everywhere with no refusal anywhere. It was priced before
// it was refused — assuming them buys TWO corpus scripts.
//
// ⭐ WHAT SHIPS INSTEAD IS AN OFFER. `TS_DOC_BLOCKED[name].suggest` is the call
// written out in full, handed to the member as an edit to THEIR source. They
// accept it, it lands in their script, and the read-back shows `length = 14,
// price = close` in their own text — the number is their choice and it is VISIBLE
// (`closedTable.json::_functions_na`, one lane over).
//
// ⛔⛔ AND THE ONLY THING THAT MAKES THAT HONEST IS THIS FILE. A suggestion is
// advice the member is invited to act on, so it is a claim about a run — exactly
// the kind this repo keeps finding stale (`lesson_a_comment_naming_a_mechanism_is
// _a_claim_about_a_run`). Every one is therefore TRANSLATED here, not reviewed: if
// a signature moves, a gate tightens, or a name is renamed, the suggestion that
// stopped working fails BY NAME rather than reaching a member as bad advice.

import { describe, it, expect } from 'vitest'

import { translateThinkScript, TS_DOC_BLOCKED } from './thinkscript.js'

/** The suggestion, wrapped in the smallest script that makes it an output. */
const asScript = (call) => `plot p = ${call};\n`

const WITH_SUGGEST = Object.entries(TS_DOC_BLOCKED)
  .filter(([, d]) => d && d.suggest)
  .sort(([a], [b]) => a.localeCompare(b))

describe('every suggested completion actually translates', () => {
  it('⛔ the roster is not empty — a sweep with no inputs is not a sweep', () => {
    // Without this, deleting every `suggest` leaves this whole file green.
    expect(WITH_SUGGEST.length).toBeGreaterThanOrEqual(5)
  })

  for (const [name, d] of WITH_SUGGEST) {
    it(`${name} — \`${d.suggest}\``, () => {
      // ⚠️ SOME STUDIES ANSWER WITH SEVERAL PLOTS, so a bare call is not always a
      // value. Those name the sub-plot in the suggestion itself; what is asserted
      // here is the same thing either way — that NOTHING REFUSES.
      const out = translateThinkScript(asScript(d.suggest))
      const why = out.refusal ? `${out.refusal.guard}: ${out.refusal.message}` : ''
      expect(out.refusal, `the suggestion this door offers does not work — ${why}`).toBe(null)
      expect(out.outputs.some((o) => o.formula), 'it translated but offers no column')
        .toBe(true)
    })
  }
})

describe('the offer reaches the member, and only where it is honest', () => {
  it('⭐⭐ the refusal a member SEES carries the suggestion', () => {
    // ⛔ THE WHOLE POINT OF THE FEATURE. The suggestion lives on `TS_DOC_BLOCKED`,
    // but a member never reads that file — they read a refusal. If it does not
    // ride the refusal, this is a registry nobody can act on.
    const out = translateThinkScript('plot p = RSI() > 30;\n')
    expect(out.refusal.guard).toBe('thinkscript:arity')
    expect(out.refusal.suggest).toBe(TS_DOC_BLOCKED.RSI.suggest)
  })

  it('⛔⛔ …and the ones that CANNOT be suggested carry nothing', () => {
    // ⭐ THE ABSENCES ARE THE HONEST HALF, and they are different in kind from a
    // missing argument. `TTM_Squeeze` has no published formula at all — there is
    // nothing to spell out. `GetTime` is missing a UNIT and `BarNumber` an ORIGIN:
    // a CONVENTION rather than a value, where a suggested guess would be exactly
    // the invisible wrongness the refusal exists to prevent. A suggestion may only
    // ever spell out arguments the member could have typed themselves.
    for (const n of ['TTM_Squeeze', 'GetTime', 'BarNumber']) {
      expect(TS_DOC_BLOCKED[n], `${n} should be in the registry`).toBeTruthy()
      expect(TS_DOC_BLOCKED[n].suggest, `${n} must NOT suggest a value`).toBeUndefined()
    }
  })

  it('⛔ a suggestion never names a parameter the door does not know', () => {
    // ⚰️ THE FAILURE THIS CATCHES IS ADVICE THAT LOOKS RIGHT: a suggestion naming
    // a parameter the shape does not declare would translate today only because
    // the door ignores unknown names, and would rot silently. Asserting the
    // suggested call round-trips to a FORMULA is what pins it to real parameters.
    for (const [name, d] of WITH_SUGGEST) {
      const out = translateThinkScript(asScript(d.suggest))
      const first = out.outputs.find((o) => o.formula)
      expect(first, `${name} produced no formula`).toBeTruthy()
      expect(typeof first.formula, `${name}`).toBe('string')
      expect(first.formula.length, `${name} produced an empty formula`).toBeGreaterThan(0)
    }
  })
})
