// app/src/components/chart/engine/ast/bothLanesAreTwoLanes.test.js
//
// ─── ⚰️ "BOTH LANES" WAS ONE LANE, TWICE ────────────────────────────────────
//
// Measured 2026-09-14, in this session's own probes.
//
// Every "both lanes" reading taken while wiring item (a) was produced by calling
// `translatePine(src, { mode: 'host' })` and `translatePine(src, { mode:
// 'screener' })`. **`mode` is not the option.** `strict` is. Both calls ran the
// LENIENT lane, agreed with each other perfectly, and were reported as
// cross-lane agreement — which is the strongest-looking evidence a probe can
// produce and, in that shape, worth nothing.
//
// ⭐ AN INSTRUMENT THAT CANNOT DISTINGUISH ITS TWO INPUTS AGREES WITH ITSELF.
// Same family as `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail` and
// this repo's own "the three zeros that agree" incident.
//
// ⛔ SO THE SELF-CHECK IS THAT THE TWO READINGS DIFFER ON A KNOWN FIXTURE. If a
// future refactor renames the option, merges the contracts, or makes one lane
// silently fall back to the other, this goes red — instead of a later session
// re-reporting one lane as two.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'

const CLOUDS = fs.readFileSync(
  path.resolve(__dirname, '../../../../../../tests/fixtures/member/uncharted-clouds.pine'), 'utf8')

/** ⚰⚰ THE DISCRIMINATOR USED TO BE CLOUDS, AND a3 SPENT IT.
 *
 *  Clouds refused 21 times in strict and translated in lenient, which is what
 *  made it a fixture the two lanes DISAGREE on. a3's unroll cleared every one of
 *  those refusals, so Clouds now translates whole on both lanes and can no
 *  longer tell the lanes apart — it agrees with itself, which is precisely the
 *  reading this file exists to make impossible.
 *
 *  So the DISCRIMINATOR moves and the assertions stay. A `while`-filled array is
 *  the frontier now (F4: `while` refuses entirely in item (a)), and Clouds is
 *  kept below as the AGREEING case — a rail that only ever saw disagreement
 *  could not notice a lane that had started refusing everything.
 *
 *  ⚠ This fixture is expected to be spent too, by item (c). Move it forward to
 *  whatever still refuses then; never relax the `.not.toBe()`.
 */
const STILL_REFUSES = '//@version=6\nindicator("t", overlay=true)\nplot(close, "real")\n'
  + 'var a = array.new<float>(4)\n'
  + 'i = 0\n'
  + 'while i < 4\n'
  + '    array.set(a, i, close)\n'
  + '    i := i + 1\n'
  + 'plot(array.get(a, 0))\n'

describe('the two lanes are two lanes', () => {
  it('⛔⛔ strict and lenient DISAGREE on a script that still refuses', () => {
    const strict = translatePine(STILL_REFUSES, { strict: true })
    const lenient = translatePine(STILL_REFUSES)

    // The load-bearing assertion: a DIFFERENT verdict from the same source.
    expect(strict.ok, 'strict refuses a partial translation').toBe(false)
    expect(lenient.ok, 'lenient offers what it can').toBe(true)
    expect(strict.ok).not.toBe(lenient.ok)
  })

  it('⭐ …and they agree about the FACTS, which is what makes the verdicts comparable', () => {
    const strict = translatePine(STILL_REFUSES, { strict: true })
    const lenient = translatePine(STILL_REFUSES)
    expect(strict.outputs.length).toBe(lenient.outputs.length)
    expect(strict.refusals.length).toBe(lenient.refusals.length)
  })

  it('⭐⭐ a3 — CLOUDS NOW AGREES, and that is recorded rather than deleted', () => {
    // The old discriminator, kept as its opposite. A lane that started refusing
    // everything would satisfy the disagreement case above and fail here, so the
    // pair pins BOTH directions instead of only the interesting one.
    const strict = translatePine(CLOUDS, { strict: true })
    const lenient = translatePine(CLOUDS)
    expect(strict.ok, 'a3 cleared Clouds\u2019 21 collection refusals').toBe(true)
    expect(lenient.ok).toBe(true)
    expect(strict.refusals.length).toBe(0)
  })

  it('⚰️ `mode` IS NOT THE OPTION — the exact call that produced the false reading', () => {
    // Kept as the reproduction rather than described in a comment: both of these
    // are the lenient lane, and a reader who writes them again will see this test
    // and know why they agreed.
    const a = translatePine(STILL_REFUSES, { mode: 'host' })
    const b = translatePine(STILL_REFUSES, { mode: 'screener' })
    expect(a.ok, '`mode` is ignored, so this is the lenient lane').toBe(true)
    expect(b.ok).toBe(true)
    expect(a.ok).toBe(b.ok)

    // …and the real option changes the answer, which is the whole point.
    expect(translatePine(STILL_REFUSES, { strict: true }).ok).not.toBe(a.ok)
  })
})

// ─── ⭐⭐ AND EVERY RETURN PATH HAS TO SAY WHICH LANE IT IS ───────────────
//
// `paneGate` reads `t.mode` FIRST and refuses anything that is not `'host'` with
// "this verdict came from the <mode|unknown> lane". That is the right rule and
// it is checked before every other one — so a result that forgets to carry its
// lane is refused with a sentence about lanes no matter what is actually wrong
// with the script.
//
// ⚰️ MEASURED 2026-09-19. Only the NORMAL return sets `mode`. Every early
// return — the empty source, a lexer refusal, a statement-grouping refusal, and
// `pine:no-output`, which is what any table-only dashboard hits — returns
// without it. So a member who pasted a perfectly good script that simply draws
// no line was told "this verdict came from the unknown lane, which answers a
// different question", a sentence about our internals that names nothing they
// could act on, instead of "the pasted script offers no plot and no alert
// condition to filter on".

/** A real shape: plots nothing and draws nothing either — no plot, no
 *  alertcondition, no line/label/box/table call at all, just a value nobody
 *  ever surfaces. ⚰️ THIS USED TO BE A TABLE-ONLY DASHBOARD (`table.new` +
 *  `table.cell` under `barstate.islast`), which is EXACTLY the shape
 *  `pineObjectOnlyHostAccept.test.js` now accepts for the host lane
 *  (2026-09-20: a script with no value-lane output but a clean, zero-drop
 *  object program is no longer `pine:no-output` — see `pine.js`'s
 *  `objectOnlyCleanWin`). That table specimen started translating cleanly
 *  under this very fix, which collapsed this test's three DIFFERENT early
 *  returns onto two. The fixture is swapped for one with no object-lane
 *  output at all, so it still exercises the same `pine:no-output` refusal
 *  this test is asserting about, honestly. */
const NO_PLOT = [
  '//@version=6',
  'indicator("t", overlay = true)',
  'x = close + 1',
  ''].join('\n')

/** An unterminated string — `lexPine` throws before a statement is ever read. */
const LEXER_FAILURE = '//@version=6\nindicator("t")\nplot(close, "unterminated\n'

const EARLY_PATHS = [
  ['a script with no plot', NO_PLOT],
  ['an empty source', '   \n\t\n'],
  ['a source the lexer refuses', LEXER_FAILURE],
]

describe('every return path names the lane it came from', () => {
  it('⛔⛔ NON-VACUITY — the three specimens take three DIFFERENT early returns', () => {
    // Without this the three cases below could be one path measured three times
    // — `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`. Each must
    // refuse, and by its own guard.
    const guards = EARLY_PATHS.map(([, src]) => {
      const t = translatePine(src, { strict: true })
      expect(t.ok, 'a specimen meant to refuse translated cleanly').toBe(false)
      return (t.refusal || {}).guard
    })
    expect(guards[0], 'the no-plot specimen grew a plot').toBe('pine:no-output')
    expect(new Set(guards).size, 'the specimens collapse onto one return path')
      .toBe(guards.length)
  })

  it.each(EARLY_PATHS)('⛔⛔ %s answers the HOST lane under strict', (_label, source) => {
    const t = translatePine(source, { strict: true })
    expect(t.mode, 'an early return dropped the lane, so `paneGate` refuses it '
      + 'with a sentence about lanes instead of the real reason').toBe('host')
  })

  it.each(EARLY_PATHS)('⭐ %s answers the SCREENER lane by default', (_label, source) => {
    expect(translatePine(source, {}).mode).toBe('screener')
  })

  it('⭐ …and the normal path is unchanged, which is what makes the pair a pair', () => {
    expect(translatePine(STILL_REFUSES, { strict: true }).mode).toBe('host')
    expect(translatePine(STILL_REFUSES, {}).mode).toBe('screener')
  })
})
