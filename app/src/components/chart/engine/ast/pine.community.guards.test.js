// 🔴 THE COMMUNITY CORPUS, REFUSAL BY REFUSAL.
//
// ⚠️⚠️ THIS FILE EXISTS BECAUSE `pine.community.test.js`'s HEADER ALREADY CLAIMS
// IT. That file says, verbatim: "AND THE REFUSALS ARE PINNED TOO, by guard. A
// script moving from one refusal to another is a real change in what this door
// says to a member, and it is exactly the change that would otherwise hide inside
// an unchanged total." Measured: not one assertion in that file pins a per-file
// guard. It asserts the TRANSLATES roster, that nothing threw, that nothing came
// back `unknown`, and that the roster is not vacuous — and that is all.
//
// ⛔ SO THE CLAIM WAS A COMMENT ABOUT A RUN THAT NEVER HAPPENED
// (`lesson_a_comment_naming_a_mechanism_is_a_claim_about_a_run`), and the cost was
// immediate: the change that added this file moved TWO scripts from one refusal to
// another and the community gate stayed green and silent about both.
//
//   20-cm-ultimate-ma-mtf   pine:window @L25 `len`  →  pine:function @L32 `vwma`
//                                                   →  ✅ TRANSLATES. Three refusals
//     deep, none visible until the one before it cleared: the ternary timeframe
//     fold, then window constant-folding, then `vwma` — which cost the manifest
//     nothing, being TradingView's own published expansion over names this table
//     already declares.
//   26-spy-to-es-qqq-to-nq  pine:named-argument @L47 `source`
//                                                   →  pine:request @L40 `request.security`
//
// ⭐ BOTH MOVES ARE GAINS AND NEITHER IS A COVERAGE NUMBER, which is the whole
// argument for reading refusals at the line rather than counting rosters. 20's
// computed windows now fold, so it reaches the next wall — `vwma`, which the
// manifest does not declare: a TRUE refusal. 26's named `ta.sma` and its fully
// named `request.security` both resolve now, so it reaches line 40 —
// `request.security(t, …)` where `t = ticker.new(…)`, a COMPUTED SYMBOL, which is
// also a true refusal. The roster stayed at 17 and the door got two walls better.
//
// ⭐ THE OWNER CORPUS ALREADY HAS THIS: `pine.corpus.test.js` pins a per-file
// guard + line in its SNAPSHOT. This is the community corpus catching up, and it
// is a SEPARATE file only because the roster gate is not this change's to edit.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from './pine.js'

const DIR = path.resolve(process.cwd(), '../tests/fixtures/pine_community')
// ⛔ NO `existsSync` GUARD, for the same reason the roster gate has none: a corpus
// gate that passes with no corpus is `lesson_gate_that_cannot_fail`.
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.pine')).sort()

/** file → [guard, line, token] for every script this door REFUSES.
 *
 *  ⭐ A FILE'S ABSENCE FROM THIS MAP MEANS IT TRANSLATES, and the second test
 *  below asserts exactly that — so the map and the translating set partition the
 *  corpus with no roster restated here. `pine.community.test.js` stays the one
 *  authority over WHICH scripts translate; this file is the one authority over
 *  what the others SAY.
 *
 *  ⚠️ `line`/`token` are `null` where the refusal is about the whole script
 *  rather than a line — `pine:no-output` has no token to point at.
 *
 *  These were captured by running `translatePine` over the corpus, not typed from
 *  a blocker table: a table built by grepping for a feature counts scripts that
 *  CONTAIN it, never scripts BLOCKED BY it, and that has been measured wrong five
 *  times on this project. */
const REFUSES = Object.freeze({
  '07-hull-suite.pine': ['pine:statement', null, null],
  '08-smoothed-heiken-ashi-candles.pine': ['pine:no-output', null, null],
  '09-obv-oscillator-lazybear.pine': ['pine:function', 9, 'cum'],
  // ⭐ WAS `pine:undefined` — `it = … it[1] … it[2]` is a plain self-reference,
  // which this door could not see, so it refused by NAMING THE VARIABLE BEING
  // DEFINED. It is a SECOND-ORDER recurrence and the accumulator holds one lag,
  // so it still refuses — now for the reason that is true, at the same token.
  '10-ehlers-instantaneous-trend-lazybear.pine': ['pine:state', 13, 'it'],
  '14-earnings-gap-ups.pine': ['pine:no-output', null, null],
  // ⭐ WAS `pine:window` @25 ON `len` — the computed windows `len / 2` and
  // `round(sqrt(len))` now fold to 10 and 4. The next wall is real: `vwma` is not
  // in `closedTable.json` and not in `PINE_INEXPRESSIBLE` either.
  '22-daily-weekly-monthly-highs-lows.pine': ['pine:collection', 132, 'array.get'],
  '23-higher-timeframe-ema.pine': ['pine:request', 14, 'request.security'],
  '25-spy-expected-move-by-vix.pine': ['pine:function', 8, 'time'],
  // ⭐ WAS `pine:named-argument` @47 ON `source`. Two walls fell in one change —
  // the named `ta.sma` at 47 and the fully-named `request.security` at 41 — and
  // the third is honest: line 40 reads another symbol built by `ticker.new(…)`.
  '26-spy-to-es-qqq-to-nq.pine': ['pine:request', 40, 'request.security'],
  '27-support-resistance-channels.pine': ['pine:function', 37, 'bool'],
  '29-zigzag-plus-plus.pine': ['pine:module', 16, 'import'],
  '30-pivot-points-high-low-mtf.pine': ['pine:no-output', null, null],
})

const outcome = (f) => translatePine(fs.readFileSync(path.join(DIR, f), 'utf8'))

describe('the community corpus, refusal by refusal', () => {
  it('the corpus is really there, and the map describes part of it', () => {
    // ⛔ THE CONTROL FOR EVERY ASSERTION BELOW. A `for` loop over an empty file
    // list, or a map that had drifted to cover everything, passes vacuously.
    expect(FILES.length).toBeGreaterThanOrEqual(30)
    const keys = Object.keys(REFUSES)
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.length).toBeLessThan(FILES.length)
    // …and every key names a file that is actually on disk, so a rename cannot
    // quietly retire a pin.
    expect(keys.filter((k) => !FILES.includes(k))).toEqual([])
  })

  it('⭐ every refusing script refuses at exactly this guard, line and token', () => {
    // ⚠️ COMPARED AS ONE TABLE, not asserted per row inside a loop. A row-by-row
    // `expect` reports the FIRST disagreement and hides the rest, and the useful
    // question after a translator change is "which scripts moved", plural.
    const want = Object.keys(REFUSES).sort().map((f) => [f, ...REFUSES[f]])
    const got = Object.keys(REFUSES).sort().map((f) => {
      const out = outcome(f)
      if (out.ok) return [f, 'TRANSLATES', null, null]
      const r = out.refusal
      return [f, r.guard, r.line ?? null, r.token ?? null]
    })
    expect(got).toEqual(want)
  })

  it('⛔ and every script with NO entry here translates — the map is a partition', () => {
    // This is what stops the map from being a set of pins somebody can quietly
    // delete a row from: a deleted row does not become "unchecked", it becomes a
    // claim that the script translates, and that claim is tested.
    const unpinned = FILES.filter((f) => !Object.prototype.hasOwnProperty.call(REFUSES, f))
    const notTranslating = unpinned
      .map((f) => [f, outcome(f)])
      .filter(([, out]) => !out.ok)
      .map(([f, out]) => [f, out.refusal.guard, out.refusal.line])
    expect(notTranslating).toEqual([])
    expect(unpinned.length + Object.keys(REFUSES).length).toBe(FILES.length)
  })
})
