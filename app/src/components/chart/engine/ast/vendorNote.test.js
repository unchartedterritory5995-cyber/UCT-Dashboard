// app/src/components/chart/engine/ast/vendorNote.test.js
//
// ─── 🔴 THE SENTENCE THE PRODUCT OWES SOMEBODY WHO PASTED A SCRIPT ──────────
//
// On 2026-08-29 `tools/vendor_spec_probes.py` measured a real difference between
// our `atr` and TradingView's published `ta.rma(ta.tr(true), n)`, and the repo
// RULED to keep ours (see `tests/fixtures/vendor/divergences.json` — ours is
// correct Wilder, the delta decays to 4e-12 by bar 300, and the consumers that
// would move are live stops and saved scans rather than the paste surface).
//
// ⛔⛔ A RULING IS NOT A RESOLUTION UNTIL THE MEMBER IS TOLD. An accepted
// divergence that lives only in a test fixture is a difference a member
// discovers by putting two charts side by side — which arrives as a bug report
// and a lost trust, not as a specification. The roster's own vocabulary said so
// ("an accepted divergence is a sentence the product owes whoever pasted the
// script") and for one commit nothing said it. This file is that sentence
// arriving, and the rails that stop it rotting.
//
// ⭐ IT LIVES ON THE MANIFEST ENTRY, which is what makes it reach every door at
// once — the same architecture that made `hma` light up three translators from
// one declaration.

import { describe, it, expect } from 'vitest'

import {
  TABLE, VENDOR_NOTE, vendorNotesOf, VENDOR_NOTES, vendorNotesForTree, parseFormula,
} from './parse.js'
import { translatePine } from './pine.js'
import { inspectPine } from '../../builder/PineBox.jsx'

describe('a vendor note is DERIVED from the manifest, never listed', () => {
  it('⛔ the reader finds a PLANTED note — so it is a walk, not a hand-list', () => {
    // ⭐⭐ THE ASSERTION THAT MATTERS WHILE EXACTLY ONE ENTRY CARRIES A NOTE.
    // `name === 'atr'` would satisfy every other test in this file, and would be
    // indistinguishable from a real derivation until the day a SECOND divergence
    // is measured — at which point the difference is a member not being told
    // about it. `barReadersOf` records a mutation sweep where precisely that
    // hand-list survived every suite in this directory.
    const planted = {
      ...TABLE,
      functions: {
        ...TABLE.functions,
        sma: { ...TABLE.functions.sma, [VENDOR_NOTE]: 'a planted sentence' },
      },
    }
    const found = vendorNotesOf(planted)
    expect(Object.keys(found).sort()).toEqual(['atr', 'sma'])
    expect(found.sma).toBe('a planted sentence')
    // …and the CONTROL: the shipped table does not contain the plant.
    expect(Object.keys(VENDOR_NOTES)).not.toContain('sma')
  })

  it('⛔ an entry whose note is blank or absent is not a note', () => {
    const blank = {
      ...TABLE,
      functions: { ...TABLE.functions, sma: { ...TABLE.functions.sma, [VENDOR_NOTE]: '   ' } },
    }
    expect(Object.keys(vendorNotesOf(blank))).not.toContain('sma')
    // A whitespace note would render an empty row a member cannot act on, which
    // is worse than silence: it implies a difference and names none.
  })

  it('⭐ the shipped roster is exactly what has been MEASURED — one entry', () => {
    // ⛔ NOT AN ARBITRARY COUNT. `_functions_vendor_note` states the rule this
    // pins: a note may only be written from a measurement, never as a hedge. An
    // entry gaining a note without a `divergences.json` row behind it is the
    // thing that would teach members to distrust numbers that are in fact exact.
    expect(Object.keys(VENDOR_NOTES)).toEqual(['atr'])
    expect(VENDOR_NOTES.atr).toMatch(/wilder/i)
    expect(VENDOR_NOTES.atr).toMatch(/ta\.rma\(ta\.tr\(true\), n\)/)
    // The member is given the SIZE of the difference, not just its existence —
    // "it differs" is unactionable; "0.23% at the seed, 4e-12 by bar 300" tells
    // them whether to care.
    expect(VENDOR_NOTES.atr).toMatch(/0\.23%/)
    expect(VENDOR_NOTES.atr).toMatch(/bar 300/)
  })
})

describe('the note follows the TREE a member will actually run', () => {
  it('⭐⭐ a pasted `ta.atr(14)` surfaces the note', () => {
    const r = inspectPine('//@version=5\nindicator("t")\nplot(ta.atr(14))\n')
    const out = r.outputs[r.selected]
    expect(out.formula).toBe('atr(high, low, close, 14)')
    expect(out.vendorNotes.map((v) => v.name)).toEqual(['atr'])
  })

  it('⛔ …even nested deep in an expression, because the walk is over the TREE', () => {
    // A note keyed off the member's SOURCE TEXT would miss every name the
    // translator expanded, renamed or composed — which is most of them. `ta.atr`
    // becomes `atr(high, low, close, 14)`; a text match on the paste would be
    // asking a question about a formula nobody is going to run.
    const r = inspectPine('//@version=5\nindicator("t")\nplot(close + 2 * ta.atr(14))\n')
    expect(r.outputs[r.selected].vendorNotes.map((v) => v.name)).toEqual(['atr'])
  })

  it('⛔ three uses are ONE note — a divergence, not three problems', () => {
    const r = inspectPine(
      '//@version=5\nindicator("t")\nplot(ta.atr(14) + ta.atr(14) + ta.atr(14))\n')
    expect(r.outputs[r.selected].vendorNotes).toHaveLength(1)
  })

  it('⛔ CONTROL — a script with no divergent function surfaces nothing', () => {
    // Without this the walk could return every note for every tree and the four
    // assertions above would all still pass.
    const r = inspectPine('//@version=5\nindicator("t")\nplot(ta.sma(close, 20))\n')
    expect(r.outputs[r.selected].vendorNotes).toEqual([])
  })

  it('⛔ …and a hand-typed formula gets the same answer as a pasted one', () => {
    // One engine, three doors: the note is a property of the TREE, so a member
    // who typed `atr(high, low, close, 14)` themselves is owed the same sentence
    // as one who pasted Pine. A note reachable only through the importer would be
    // a second class of member.
    const typed = parseFormula('atr(high, low, close, 14)')
    expect(typed.ok).toBe(true)
    const pasted = translatePine('//@version=5\nindicator("t")\nplot(ta.atr(14))\n')
    expect(vendorNotesForTree(typed.ast))
      .toEqual(vendorNotesForTree(pasted.outputs[0].ast))
  })
})
