// ⭐⭐ THE EVALUATION MODEL, AND THE LOOK-ALIKES IT MUST NOT SWALLOW.
//
// `barstate.isconfirmed` was the single most frequent refusal across the 21 real
// published scripts — 15 columns and one whole script — and it is not a missing
// name. It is a QUESTION this engine already knows the answer to: every bar it
// evaluates is closed, historical, and evaluated once. So the four constants here
// are exact, not near-enough.
//
// ⚰️⚰️ REWRITTEN 2026-09-09 UNDER THE BARSTATE RULING, and this header's own
// previous claim is the thing that changed. It said `barstate.islast` "is decided
// by how many bars were requested, so the same scan on the same stock disagrees
// with itself at two window sizes". THAT IS FALSE, and it conflated the two ends
// of a series: a fetch reaches BACKWARDS FROM NOW, so deepening it adds bars to
// the OLD end and never moves which bar is newest. `islast` names the same bar at
// any depth. `isfirst` names the OLDEST one and DOES move — one sentence had been
// covering both ends of the series when only one of them travels.
//
// ⭐ SO THE SPLIT IS NOW FOUR-WAY, and all four are asserted here:
//   · BUILTIN_CONSTANT_TREE   — the SCREENER fold. On a sweep every delivered bar
//                               is closed, so `isconfirmed` is exactly 1.
//   · BUILTIN_BARSTATE_SERIES — the clock columns a PANE evaluates per bar,
//     read off `closedTable.json::_barstate`.
//   · BUILTIN_BARSTATE_REFUSED — `isnew`, refused on BOTH contracts: it needs a
//                               per-tick event this engine never observes.
//   · window_dependent        — `isfirst`, served on a pane, refused for a screen.
//
// ⛔ BOTH DIRECTIONS STILL MATTER. A test that only checked what resolves would
// pass just as happily on a build that resolved everything — which is the build
// that quietly returns a different answer per request.

import { describe, it, expect } from 'vitest'
import {
  translatePine, BUILTIN_CONSTANT_TREE, BUILTIN_REQUEST_DEPENDENT,
  BUILTIN_BARSTATE_SERIES, BUILTIN_BARSTATE_REFUSED,
} from './pine.js'
import { interpret } from './interpret.js'

const script = (expr) => `//@version=5
indicator("t")
plot(${expr})
`

const outOf = (expr) => {
  const r = translatePine(script(expr))
  const found = (r.outputs || []).find((o) => o.ast || o.refusal)
  return {
    ast: found && found.ast ? found.ast : null,
    // ⚰️ THIS FELL BACK TO THE WHOLE-SCRIPT REFUSAL, AND THE CLAIM IS ABOUT THE
    // NAME. Every fixture here is `plot(<name> …)` over literals, so the column
    // it produces is legitimately the same number on every bar — and a script
    // whose every column is constant is now refused as such instead of
    // declining in silence. That says nothing about whether `barstate.isnew`
    // RESOLVED, which is the only thing these tests assert. The per-output
    // refusal answers that question exactly; the whole-script one answers a
    // different question that this file does not ask. The fallback survives for
    // a HARD refusal, where no output row exists to carry it.
    refusal: found ? (found.refusal || null) : (r.refusal || null),
  }
}

const BARS = Array.from({ length: 30 }, (_, i) => {
  const c = 100 + i
  return { o: c - 50, h: c + 1, l: c - 2, c, v: 1000 + i }
})
const col = (tree) => [...interpret(tree, BARS, {})]

/** ⛔⛔ THE TWO LISTS ARE READ OFF THE SOURCE, NEVER RETYPED HERE.
 *
 *  ⚰️ They WERE retyped, and a mutation run caught it: moving `barstate.islast`
 *  into the constant map left this file GREEN, because the disjointness check was
 *  comparing two arrays this file owned against each other rather than against the
 *  maps that decide anything. That is `A SECOND AUTHORITY OVER ONE VALUE` — the
 *  defect this repo repeats most — committed inside the test whose own header
 *  warned about it. Derived, a name added tomorrow is covered the day it lands. */
const RESOLVES = Object.keys(BUILTIN_CONSTANT_TREE)
const REFUSES = Object.keys(BUILTIN_REQUEST_DEPENDENT)

describe('the four the evaluation model answers', () => {
  it('⛔ NON-VACUITY FIRST, and the split is pinned in EVERY direction', () => {
    // Everything below is vacuous on empty maps. The membership is pinned so the
    // split cannot GROW by accident either — moving a name is a deliberate edit
    // here, which is the point: each one is a judgement about what this engine's
    // evaluation model does and does not decide.
    expect([...RESOLVES].sort(),
      `the screener fold moved — now [${RESOLVES.join(' | ')}]`)
      .toEqual(['barstate.isconfirmed', 'barstate.ishistory', 'barstate.isrealtime'])
    expect(Object.keys(BUILTIN_BARSTATE_SERIES).length, 'the served roster moved').toBe(6)
    expect(Object.keys(BUILTIN_BARSTATE_REFUSED)).toEqual(['barstate.isnew'])
    // ⚰️ THE WITHDRAWN MAP IS ASSERTED EMPTY RATHER THAN DELETED. It is where the
    // NEXT genuinely request-dependent name lands, so a name reappearing there is
    // a decision somebody made rather than a silent regrowth.
    expect(REFUSES, `the withdrawn map is no longer empty: [${REFUSES.join(' | ')}]`)
      .toEqual([])
    // ⛔ NO NAME IS IN TWO PLACES AT ONCE — catches a name being promoted out of
    // "refused" into "served" without leaving the map that refuses it.
    const live = Object.keys(BUILTIN_BARSTATE_REFUSED)
    for (const [a, b, what] of [
      [RESOLVES, live, 'the screener fold AND the live-only refusal'],
      [Object.keys(BUILTIN_BARSTATE_SERIES), live, 'the served roster AND the by-name refusal'],
      [RESOLVES, REFUSES, 'the screener fold AND the withdrawn map'],
    ]) {
      const both = a.filter((n) => b.includes(n))
      expect(both, `claimed by ${what}: [${both.join(' | ')}]`).toEqual([])
    }
  })

  for (const name of RESOLVES) {
    it(`${name} resolves to a constant, not a refusal`, () => {
      const { ast, refusal } = outOf(name)
      expect(refusal, `${name} refused: ${refusal && refusal.message}`).toBeNull()
      expect(ast).toBeTruthy()
      // A constant is the same on every bar — that IS the claim being made.
      const out = col(ast)
      expect(new Set(out).size, `${name} is not constant across bars`).toBe(1)
    })
  }

  it('the TRUE ones are true and the FALSE one is false — checked by BEHAVIOUR', () => {
    // ⭐ Not by reading the literal back. A script branches on these, so the thing
    // that matters is which branch a member's script takes. `open` and `close` are
    // 50 apart on every fixture bar, so a swapped branch is unmissable.
    expect(col(outOf('barstate.isconfirmed ? close : open').ast)[10]).toBe(BARS[10].c)
    expect(col(outOf('barstate.ishistory ? close : open').ast)[10]).toBe(BARS[10].c)
    // ⚰️ `barstate.isnew` WAS A THIRD ROW HERE AND IS NOW REFUSED. Asserted as a
    // refusal rather than deleted, so the withdrawal is visible in the file that
    // used to claim the opposite — and so a fold quietly reinstated tomorrow
    // fails here rather than passing by absence.
    expect(outOf('barstate.isnew ? close : open').refusal,
      'barstate.isnew resolved — its fold was withdrawn').toBeTruthy()
    // ⛔ THE ONE THAT INVERTS. Without this, a map that returned 1 for everything
    // would pass every assertion above.
    expect(col(outOf('barstate.isrealtime ? close : open').ast)[10]).toBe(BARS[10].o)
  })

  it('a confirmed-bar guard becomes the guarded expression itself', () => {
    // The shape that actually appears in the corpus: `signal and barstate.isconfirmed`.
    const guarded = col(outOf('close > open and barstate.isconfirmed').ast)
    const bare = col(outOf('close > open').ast)
    expect(guarded).toEqual(bare)
  })
})

describe('🔴 what is still refused, and refused with its own reason', () => {
  it('⛔ barstate.isnew refuses on BOTH contracts — a pane sees no ticks either', () => {
    for (const opts of [{}, { strict: true }]) {
      const r = translatePine(script('barstate.isnew ? close : open'), opts)
      const found = (r.outputs || []).find((o) => o.refusal)
      const why = String((found && found.refusal && found.refusal.message)
        || (r.refusal && r.refusal.message) || '')
      expect(why, `isnew was served on ${JSON.stringify(opts)}`).toMatch(/per-tick/)
      // ⭐ ASSERTED AGAINST THE MANIFEST'S OWN SENTENCE, not a phrasing typed
      // here — `closedTable.json::_barstate.refused.isnew` is the one owner of
      // this text, and a second copy in a regex is a second authority over it.
      expect(why).toMatch(/static fetch once|restatement of the question/)
    }
  })

  it('⛔⛔ barstate.isfirst: a SCREEN refuses it, a PANE draws it', () => {
    // ⭐ THE PAIR IS THE RULING. Served on a pane because a pane is one symbol and
    // one fetch; refused for a screen because the OLDEST delivered bar moves with
    // the request. Asserting only one half is how an exemption becomes a hole.
    const screen = translatePine(script('barstate.isfirst ? close : open'))
    const sFound = (screen.outputs || []).find((o) => o.refusal)
    const sWhy = String((sFound && sFound.refusal && sFound.refusal.message)
      || (screen.refusal && screen.refusal.message) || '')
    expect(sWhy, 'a screen was handed a fetch-dependent flag').toMatch(/OLDEST bar/)
    expect(sWhy).toMatch(/depends on how much history was loaded/)

    const pane = translatePine(script('barstate.isfirst ? close : open'), { strict: true })
    const pFound = (pane.outputs || []).find((o) => o.ast || o.refusal)
    expect(pFound && pFound.refusal, 'a pane must be allowed to draw it').toBeFalsy()
    expect(pFound && pFound.ast).toBeTruthy()
  })

  it('⭐ barstate.islast is SERVED now — the withdrawal, asserted', () => {
    // ⚰️ It was refused as request-dependent. A fetch reaches backwards from now,
    // so the newest bar is the same bar at any depth. Both contracts serve it.
    for (const opts of [{}, { strict: true }]) {
      const r = translatePine(script('barstate.islast ? close : open'), opts)
      const found = (r.outputs || []).find((o) => o.ast || o.refusal)
      expect(found && found.refusal,
        `islast refused on ${JSON.stringify(opts)}: `
        + String(found && found.refusal && found.refusal.message)).toBeFalsy()
      expect(found && found.ast).toBeTruthy()
    }
  })

  it('⛔ THE CONTROL — an ordinary unknown builtin does NOT get that sentence', () => {
    // Without this, every assertion above would pass for a reader that appended
    // the same explanation to every refusal it ever made.
    const { refusal } = outOf('barstate.isnonsense')
    expect(refusal).toBeTruthy()
    expect(refusal.message).not.toMatch(/depends on how (many|far)/)
  })

  it('⛔ AND THE SIBLINGS STILL RESOLVE — proving the guard is not a whole-namespace ban', () => {
    // A refusal that had simply re-banned `barstate.*` would satisfy the loop
    // above. This is what tells the two apart.
    expect(outOf('barstate.isconfirmed').ast).toBeTruthy()
  })
})

// ─── THE `&& 1` A CONFIRMED-BAR GUARD LEAVES BEHIND ─────────────────────────
//
// `barstate.isconfirmed` resolves to the constant 1, which is exactly right — and
// left every guarded script reading `… && 1 ? 1 : 0`. Measured in production
// 2026-08-11: a member pasting an ordinary Pine screen saw an unexplained "and 1"
// in their formula and "…and 1) is not zero" in the English read-back.
describe('a confirmed-bar guard folds away instead of littering the formula', () => {
  it('🔴 `signal and barstate.isconfirmed` IS `signal`', () => {
    const guarded = outOf('close > open and barstate.isconfirmed')
    const bare = outOf('close > open')
    expect(guarded.refusal, guarded.refusal?.message).toBeNull()
    expect(JSON.stringify(guarded.ast)).toBe(JSON.stringify(bare.ast))
  })

  it('…in either order', () => {
    expect(JSON.stringify(outOf('barstate.isconfirmed and close > open').ast))
      .toBe(JSON.stringify(outOf('close > open').ast))
  })

  it('⛔⛔ AND A NON-BOOLEAN IS NEVER FOLDED — `5 && 1` is 1, but `5` is 5', () => {
    // The whole reason this is guarded rather than a one-line rewrite. `close` is
    // a price, not a flag; folding it would silently change the numbers a member's
    // formula produces, which is worse than the cosmetic problem being fixed.
    const kept = outOf('close and barstate.isconfirmed')
    expect(kept.refusal, kept.refusal?.message).toBeNull()
    expect(JSON.stringify(kept.ast)).not.toBe(JSON.stringify(outOf('close').ast))
    expect(JSON.stringify(kept.ast)).toContain('&&')
  })

  it('the values still agree with the unfolded meaning, bar for bar', () => {
    // ⛔ The fold is an identity claim; this is the claim being measured rather
    // than asserted, on the shape that actually appears in scripts.
    const folded = col(outOf('close > open and barstate.isconfirmed').ast)
    const bare = col(outOf('close > open').ast)
    expect(folded).toEqual(bare)
  })
})
