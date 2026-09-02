// app/src/components/chart/engine/ast/pine.namespacedExpansion.test.js
//
// ─── ⚰️⚰️ THE SPELLING THAT WORKED WAS THE ONE NOBODY IS ALLOWED TO WRITE ─────
//
// `pine.js` carried this, above the branch that resolves a namespaced value:
//
//   "`ta.vwap`, `ta.obv`, `ta.tr` are VARIABLES in Pine. They reach the table as
//    zero-argument calls, and the table decides whether that is a thing."
//
// ⛔ `ta.tr` DID NOT REACH ANYTHING. The branch asked the TABLE, and `tr` is not
// a table function — it is an exact EXPANSION in `BUILTIN_SERIES_TREE`, a map
// consulted on the BARE-name path forty lines further down and nowhere else. So:
//
//     tr      (Pine v4 spelling)  → translates
//     ta.tr   (Pine v5/v6)        → pine:function, "maps to nothing"
//
// ⛔⛔ AND v5 REQUIRES THE NAMESPACE. Every modern script reading true range —
// ATR-style volatility filters, range-expansion screens, anything normalising by
// bar range — hit a refusal saying the engine grammar declares nothing, while the
// engine computed it perfectly under the legacy name. A comment naming a
// mechanism is a claim about a run, and this one had not been run.

import { describe, it, expect } from 'vitest'

import { translatePine, REFUSALS } from './pine.js'
import { TABLE } from './parse.js'

const plot = (body, version = 6) =>
  translatePine(`//@version=${version}\nindicator("s")\nplot(${body} ? 1 : 0)\n`)
const formulaOf = (out) => {
  expect(out.ok, out.ok ? '' : `${out.refusal.guard}: ${out.refusal.message}`).toBe(true)
  return out.outputs[out.selected].formula
}

describe('a namespaced Pine value reaches the expansions, not just the table', () => {
  it('⭐⭐ `ta.tr` translates, and to the SAME tree the bare spelling gives', () => {
    // ⭐ EQUALITY WITH THE LEGACY SPELLING IS THE CLAIM. Asserting `ta.tr` merely
    // translates would pass against a mapping that reached some OTHER true-range
    // definition; the point is that both spellings are one column.
    const namespaced = formulaOf(plot('ta.tr > 0'))
    const bare = formulaOf(plot('tr > 0', 4))
    expect(namespaced).toBe(bare)
    expect(namespaced).toContain('max(high - low')
  })

  it('⭐ it composes, which is how a screener would actually write it', () => {
    // ⛔ THE EXPECTATION IS DERIVED FROM THE DOOR, NOT TYPED. Writing the tree out
    // by hand put a wrong string in this file on the first draft and the failure
    // said only that two long formulas differed — `lesson_probe_names_must_be_
    // derived_not_typed`. Ask the door what `ta.tr` is, then assert the SHAPE it
    // was composed into.
    const tr = formulaOf(plot('ta.tr > 0')).replace(' > 0 ? 1 : 0', '')
    expect(tr).toContain('max(high - low')
    expect(formulaOf(plot('ta.tr > ta.sma(ta.tr, 14)')))
      .toBe(`${tr} > sma(${tr}, 14) ? 1 : 0`)
  })

  it('⛔⛔ a member’s OWN `tr` still wins on the bare path', () => {
    // ⚠️ THE THING THIS FIX MUST NOT BREAK. Shadowing a built-in is legal Pine and
    // the script is the authority on its own names; the bare path checks the
    // script's bindings BEFORE the expansions for exactly that reason. The
    // namespaced path needs no such dance — `ta.tr` is not a name a script can
    // bind — but if this fix had been made by hoisting the expansion lookup
    // above the binding check, this case is what would have caught it.
    const own = ['//@version=4', 'study("s")', 'tr = close - open',
      'plot(tr > 0 ? 1 : 0)', ''].join('\n')
    const out = translatePine(own)
    expect(formulaOf(out)).toBe('close - open > 0 ? 1 : 0')
    expect(formulaOf(out)).not.toContain('max(high - low')
  })

  it('⛔ `ta.obv` still refuses — the widening did not become a blanket', () => {
    // ⭐ THE OTHER NAME THE OLD COMMENT LISTED, and it is NOT unblocked by this:
    // the table's `obvN` counts the signed volume of the last N bars, while
    // Pine's `ta.obv` accumulates from the first bar ever drawn. That is the
    // unbounded-accumulator refusal, not a lookup gap, and it stays.
    const out = plot('ta.obv > 0')
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:function')
  })

  it('⛔ an unknown `ta.` name is still refused by name', () => {
    const out = plot('ta.frobnicate > 0')
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:function')
  })
})

// ─── ⚰️ AND BOTH CALL FORMS SAID THE SAME FALSE THING ────────────────────
//
// With `ta.tr` fixed above, `ta.tr(false)` and `ta.tr(true)` both still refused
// "this Pine function maps to nothing the engine grammar declares" — false of a
// name whose tree this door emits one spelling away IN THE SAME RUN.
//
// ⭐ AND THE DEFAULT FORM IS AN IDENTITY, which the file had backwards. Its
// comment said the BARE `ta.tr` was the one that falls back to `high - low` on
// bar 0; three sources in this repo say it is `ta.tr(true)`. Getting that round
// the wrong way is what made the DEFAULT spelling look unservable.

describe('the `ta.tr` call forms', () => {
  it('⭐⭐ `ta.tr(false)` is the bare variable, tree for tree', () => {
    // ⛔ DERIVED, NOT TYPED: ask the door what the bare form is, then require the
    // call form to be the same thing.
    const bare = formulaOf(plot('ta.tr > 0'))
    expect(formulaOf(plot('ta.tr(false) > 0'))).toBe(bare)
    expect(formulaOf(plot('tr(false) > 0', 4))).toBe(bare)
  })

  it('⛔⛔ `ta.tr(true)` refuses — with the RULING, not the false sentence', () => {
    const out = plot('ta.tr(true) > 0')
    expect(out.ok).toBe(false)
    // ⭐ THE ASSERTION THAT WOULD HAVE FAILED BEFORE: the old message opened with
    // `pine:function`'s sentence, which is untrue of this name.
    expect(out.refusal.message).not.toContain(REFUSALS['pine:function'])
    expect(out.refusal.message).toContain('high - low')
    expect(out.refusal.message).toMatch(/TO UNBLOCK/)
    expect(out.refusal.message).toContain('ta.tr')
    // ⚠️ AND IT LANDS ON A LINE. A refusal without one reads as "somewhere in
    // your script", which is not a refusal a member can act on.
    expect(out.refusal.line).toBe(3)
  })

  it('⭐ the manifest is the source for WHICH form fills bar 0', () => {
    // ⚰️ `pine.js` had this backwards in prose for as long as the expansion
    // existed. The vendorNote is one of the three places that agree, and it is
    // the one this engine also ships to the member, so it is the one pinned.
    expect(TABLE.functions.atr.vendorNote).toContain('ta.tr(true)');
    expect(TABLE.functions.atr.vendorNote).toContain('high - low');
  })

  it('⛔ a non-literal argument still refuses', () => {
    // ⭐ NON-VACUITY: the fix accepts exactly one value, not "anything that is
    // not `true`".
    expect(plot('ta.tr(close) > 0').ok).toBe(false)
  })
})
