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

import { translatePine } from './pine.js'

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
