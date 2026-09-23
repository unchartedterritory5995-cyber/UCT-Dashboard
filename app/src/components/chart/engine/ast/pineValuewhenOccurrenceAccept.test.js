// ─── `ta.valuewhen` WAS PERMANENTLY REFUSED — closedTable.json ALREADY
// DECLARED A `valuewhen(condition, source, period)` ENTRY, BUT IT MEANS A
// DIFFERENT FUNCTION THAN PINE'S OWN `ta.valuewhen` ──────────────────────────
//
// This table's own `valuewhen(condition, source, period)` takes a BAR
// WINDOW: the most recent bar within the last `period` bars where the
// condition held. Real Pine's `ta.valuewhen(condition, source, occurrence)`
// counts OCCURRENCES BACKWARD, unbounded — occurrence 0 is the most recent
// bar (ever, in whatever was fetched) where `condition` held, occurrence 1
// is the second-most-recent, and so on. Same spelling, same arity, two
// functions — a positional map would answer a different number on most
// bars, which is exactly why `PINE_INEXPRESSIBLE.valuewhen` used to refuse
// `ta.valuewhen` permanently (TradingView's own docs were quoted as the
// source of the ruling: their example plots `ta.valuewhen(ta.cross(slow,
// fast), close, 1)` under a comment reading "value of close on the SECOND
// most recent cross" — this table's bar-window `valuewhen` would read that
// `1` as a one-bar window).
//
// ⭐⭐ THE FIX IS A NEW, SEPARATE MANIFEST ENTRY (`valuewhenOccurrence`) WITH
// A NAMESPACE-AWARE REDIRECT, NOT A REINTERPRETATION. `PINE_CALL_SHAPES`
// cannot carry this rename safely: every one of its members redirects a Pine
// name onto whatever its own bare spelling already resolves to, so applying
// a shape to a bare call is a no-op everywhere else in that table. Routing
// `valuewhen` through the same mechanism would instead hijack a member's own
// bare `valuewhen(...)` call onto the occurrence-indexed function, silently
// changing what their script means. `pine.js::resolveTableCall` therefore
// carries a narrow, explicit special case that fires ONLY when a namespace
// was actually written (`pineName !== base`) and the bare name is
// `valuewhen` — see that method's own comment for the full reasoning and
// `closedTable.json::_functions_valuewhen_occurrence` for the vendor
// citation and the `lookback: "series"` reasoning (structurally like `cum`'s
// own vocabulary word, but NOT `window_dependent`: unlike `cum`, widening
// the fetch never shifts what this function answers for a fixed real bar —
// it can only turn a not-yet-found occurrence into a found one).
//
// ⛔⛔ A GENUINELY UNEXPECTED, PRE-EXISTING, OUT-OF-SCOPE FINDING, RECORDED
// HONESTLY RATHER THAN QUIETLY WORKED AROUND: bare `valuewhen(condition,
// source, period)` — this table's OWN function, unrelated to this fix —
// refuses `pine:role-order` on EVERY positional call, on the UNMODIFIED
// codebase too (verified via git-stash A/B against the pre-this-change
// tree). Its manifest entry declares two `series`-kind arguments and carries
// no `PINE_CALL_SHAPES` entry of its own, so `resolveTableCall`'s generic
// `seriesSlots > 1` guard fails it closed before argRoles is ever consulted
// — the same protection that exists so "a function the indicator agent adds
// tomorrow with two price arguments" cannot be silently matched up by
// position. This predates this fix, is not caused by it, and is NOT this
// fix's to repair — recorded here because the regression test below has to
// prove bare `valuewhen(...)` is UNCHANGED, and "unchanged" means "still
// refuses pine:role-order", not "still translates".
//
// Measured against the real 266-script committed corpus, 2026-09-20: 27
// scripts mention `ta.valuewhen(`; only 4 surface it as their CURRENT,
// unmasked blocker (the other 23 refuse on an earlier, unrelated construct
// first). Of those 4, ONE now fully translates; the other three converge on
// separate, unrelated blockers — recorded honestly below, mirroring
// `pineMathCeilAccept.test.js`/`pineTimenowAccept.test.js`'s own discipline.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine'
import { FN } from './interpret.js'

const CORPUS = path.resolve(__dirname, '../../../../../../corpus/committed')

const S = (body) => `//@version=6\nindicator("t")\nplot(${body})\n`

describe('⭐ ta.valuewhen is a declared, occurrence-indexed, namespace-routed function', () => {
  it('ta.valuewhen(condition, source, occurrence) clears the host lane', () => {
    const t = translatePine(S('ta.valuewhen(close > open, close, 0)'), { strict: true })
    expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
    expect(t.mode).toBe('host')
    expect(t.refusal).toBe(null)
  })

  it('routes onto the new manifest entry, not the bar-window one', () => {
    const t = translatePine(S('ta.valuewhen(close > open, close, 2)'), { strict: true })
    expect(t.outputs[t.selected].formula).toBe('valuewhenOccurrence(close > open, close, 2)')
  })

  // ⭐⭐ VALUE CORRECTNESS, HAND-COMPUTABLE, DIRECTLY AGAINST `FN.
  // valuewhenOccurrence` -- the same shared function `ta.valuewhen(...)`
  // dispatches to. A 10-bar condition series with true bars at indices
  // 1, 4, 5, 8 (four occurrences total): at bar 8 (the 4th true bar),
  // occurrence 0 is bar 8 itself, occurrence 1 is bar 5, occurrence 2 is
  // bar 4, occurrence 3 is bar 1, and occurrence 4 does not exist yet (NaN).
  it('⭐⭐ occurrence 0/1/2/3 point at the right historical bars, and a not-yet-seen occurrence is NaN', () => {
    const cond = [0, 1, 0, 0, 1, 1, 0, 0, 1, 0]
    const src = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]
    const occ0 = FN.valuewhenOccurrence(cond, src, 0)
    const occ1 = FN.valuewhenOccurrence(cond, src, 1)
    const occ2 = FN.valuewhenOccurrence(cond, src, 2)
    const occ3 = FN.valuewhenOccurrence(cond, src, 3)
    const occ4 = FN.valuewhenOccurrence(cond, src, 4)
    // at bar 8, the four true bars ever seen (ascending) are [1, 4, 5, 8]
    expect(occ0[8]).toBe(src[8]) // most recent = bar 8 itself
    expect(occ1[8]).toBe(src[5]) // second-most-recent
    expect(occ2[8]).toBe(src[4])
    expect(occ3[8]).toBe(src[1])
    expect(Number.isNaN(occ4[8]), 'occurrence 4 does not exist yet at bar 8').toBe(true)
    // before the first true bar (index 1), even occurrence 0 is NaN
    expect(Number.isNaN(occ0[0]), 'no true bar has happened yet at bar 0').toBe(true)
    // between bar 1 (the 1st true bar) and bar 4 (the 2nd), occurrence 0
    // holds bar 1's value and occurrence 1 is still NaN
    expect(occ0[2]).toBe(src[1])
    expect(occ0[3]).toBe(src[1])
    expect(Number.isNaN(occ1[2]), 'only one true bar exists by bar 2').toBe(true)
  })

  it('⛔ an NaN condition bar stops the backward scan, exactly as the bounded valuewhen does', () => {
    const cond = [1, NaN, 1]
    const src = [100, 200, 300]
    const occ0 = FN.valuewhenOccurrence(cond, src, 0)
    // bar 0's true hit is erased by the NaN at bar 1, so bar 1 answers NaN
    expect(Number.isNaN(occ0[1])).toBe(true)
    // bar 2's own true hit is unaffected -- occurrence 0 there is bar 2 itself
    expect(occ0[2]).toBe(src[2])
  })

  // ⛔⛔ THE SINGLE MOST IMPORTANT REGRESSION THIS FIX MUST NOT CAUSE: a bare
  // `valuewhen(...)` call must keep behaving EXACTLY as it did before this
  // fix -- unrelated to whatever that behavior is. Measured (see this file's
  // header): it refuses `pine:role-order` on every positional call, on the
  // UNMODIFIED codebase too. This test proves that refusal is UNCHANGED --
  // same guard, same table name, and critically NEVER mentioning
  // `valuewhenOccurrence` or occurrence semantics, which would be the tell
  // that the namespace-aware redirect leaked into the bare path.
  it('⛔⛔ bare valuewhen(...) is UNCHANGED -- still refuses pine:role-order, never the occurrence function', () => {
    const t = translatePine(S('valuewhen(close > open, close, 5)'), { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:role-order')
    expect(t.refusal.message).toMatch(/`valuewhen` takes 2 price series/)
    expect(t.refusal.message).not.toMatch(/valuewhenOccurrence/)
    expect(t.refusal.message).not.toMatch(/occurrence/)
  })

  it('⛔ every other argument shape is declined the same way the bar-window entry already declines it', () => {
    // The generic `int`-kind literal check already refuses a non-literal and
    // a negative occurrence for the EXISTING bar-window `valuewhen` -- the
    // new entry inherits the identical protection for free by declaring the
    // same argument kind, with no bespoke code of its own.
    const nonLiteral = translatePine(S('ta.valuewhen(close > open, close, close > 0 ? 1 : 2)'), { strict: true })
    expect(nonLiteral.ok).toBe(false)
    expect(nonLiteral.refusal.guard).toBe('pine:window')
    expect(nonLiteral.refusal.message).toMatch(/plain whole number/)
    const negative = translatePine(S('ta.valuewhen(close > open, close, -1)'), { strict: true })
    expect(negative.ok).toBe(false)
    expect(negative.refusal.guard).toBe('pine:window')
  })

  // ⛔⛔ THE HONEST CORPUS RESULT, MEASURED, NOT OVERCLAIMED. Of the 4 real
  // scripts whose CURRENT, unmasked blocker was `ta.valuewhen`, exactly one
  // fully translates today; the other three converge on separate, unrelated
  // blockers, none of which mention `valuewhen` at all.
  it('⭐⭐ the real corpus: one script fully unlocked, three converge on unrelated blockers', () => {
    const src = fs.readFileSync(
      path.join(CORPUS, 'liquidity-pools__fa7b28e733.pine'), 'utf8')
    const t = translatePine(src, { strict: true })
    expect(t.ok, JSON.stringify(t.refusal)).toBe(true)

    const stillBlocked = [
      ['market-structure-break-order-block__3a1fb6197f.pine', 'pine:collection', /array\.get/],
      ['smarter-snr__ac98ab25d5.pine', 'pine:function', /\bint\b/],
      ['support-and-resistance__1505.pine', 'pine:na', /fixnan/],
    ]
    for (const [file, guard, messagePattern] of stillBlocked) {
      const s = fs.readFileSync(path.join(CORPUS, file), 'utf8')
      const r = translatePine(s, { strict: true })
      expect(r.ok, file).toBe(false)
      expect(r.refusal.guard, file).toBe(guard)
      expect(r.refusal.message, file).toMatch(messagePattern)
      expect(r.refusal.message, file).not.toMatch(/valuewhen/i)
    }
  })

  it('⛔ CONTROL — a genuinely unimplemented function (ta.nvi) still refuses pine:function', () => {
    const src = fs.readFileSync(
      path.join(CORPUS, 'smart-money-volume-index-algoalpha__6663950b80.pine'), 'utf8')
    const t = translatePine(src, { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:function')
    expect(t.refusal.message).toMatch(/ta\.nvi/)
  })
})
