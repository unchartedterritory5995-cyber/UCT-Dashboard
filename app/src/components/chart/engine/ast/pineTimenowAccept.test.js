// ─── `timenow` AND ITS FIVE CALENDAR FIELDS WERE ABSENT FROM THE ENGINE
// GRAMMAR ENTIRELY — `timenow` HAD NO CLOCK ENTRY, SO THE BARE NAME AND EVERY
// `year(timenow)`-SHAPED CALL REFUSED `pine:builtin`/`pine:function` ──────────
//
// TradingView's `timenow` is the live wall clock: the real-world instant the
// script is evaluating, not a fact about any bar. A static translator over an
// already-fetched bar array has no such instant to read — there is no "now"
// during a batch computation over historical data. This engine's answer,
// `lastbartime` (`indicators.js::CLOCK_LASTBAR_TIME`), is `lastbarindex`'s own
// ruling applied to a calendar instead of a bar position: the newest FETCHED
// bar's own timestamp, broadcast to every bar. `timenow` binds to it via
// `PINE_TO_CLOCK_SPELLING`, and `year(timenow)`/`month(timenow)`/
// `dayofmonth(timenow)`/`hour(timenow)`/`minute(timenow)` are IDENTITY calls
// onto `lastbaryear`/`lastbarmonth`/`lastbardayofmonth`/`lastbarhour`/
// `lastbarminute`, exactly as `tr(false)` is an identity onto
// `BUILTIN_SERIES_TREE.tr()`.
//
// ⛔⛔ THE DIVERGENCE FROM VENDOR SEMANTICS IS REAL, MEASURED, AND DISCLOSED IN
// THE MANIFEST'S OWN SENTENCE — not smoothed over here. On a STALE fetch (a
// Saturday chart whose newest bar is Friday's close), Pine's real
// `year == year(timenow) and month == month(timenow) and dayofmonth ==
// dayofmonth(timenow)` ("is_today") reads FALSE for every bar, because real
// "now" is Saturday; this engine's answer reads TRUE for the newest bar,
// because its `timenow` is anchored to the fetch, not the wall. This is the
// only alternative to refusing `timenow` outright, and it is what a PANE
// showing "is this the newest bar in view" actually needs.
//
// ⛔ NOT A FULL host-lane ACCEPT for any of the four real corpus scripts that
// motivated this — recorded honestly rather than overclaimed, per this file's
// header, mirroring `pineMathFloorAccept.test.js`/
// `pinePercentileLinearAccept.test.js`'s own discipline:
//   - `chart-champions-part-1-npoc-levels-vwaps__wdeUFJ4ZD2.pine` refuses on
//     `math.ceil` (undeclared — a sibling of `math.floor`), a wholly separate
//     gap this file does not touch.
//   - `initial-balance-ib-and-previous-day-week-high-low-close__M0u1uaug4Q.pine`
//     writes `year(timenow) == year(time)` — ONE line naming BOTH the now-
//     working argument (`timenow`) and the permanently-blocked one (bare
//     `time`, refused by `PINE_CLOCK_MISMATCH.time` for the millisecond/
//     second units mismatch, unrelated to this work and not reachable by it).
//     The walker refuses at `time` in the SAME expression, so this script's
//     `timenow` calls are provably never reached to matter either way.
//   - `mtf-key-levels-support-and-resistance__29f470a089.pine` refuses on a
//     user-defined function (`f_round_up_to_tick`) this engine has nowhere to
//     keep — `pine:function-def`, unrelated.
//   - `swing-points-and-liquidity-by-leviathan__919c1fd9c6.pine` refuses on a
//     multi-symbol/multi-timeframe `request.security` call this engine's
//     benchmark-roster restriction cannot resolve — `pine:request`, unrelated.
// What moved, across all four, is that `timenow` and its five calendar forms
// are no longer why ANY script would refuse — the same honest framing
// `math.floor`'s renko story and `ta.percentile_linear_interpolation`'s
// volatility-coil story both used.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine'
import { computeClock } from '../../indicators.js'

const CORPUS = path.resolve(__dirname, '../../../../../../corpus/committed')

const S = (body) => `//@version=6\nindicator("t")\nplot(${body})\n`

/** Five bars spanning two calendar days in New York time, so `lastbartime`'s
 *  broadcast is visibly DIFFERENT from most bars' own `time` -- a test that
 *  used only same-day bars could not tell a real broadcast from an
 *  accidental one-bar coincidence. */
function bars() {
  const start = 1735689600 // 2025-01-01 00:00:00 UTC
  return Array.from({ length: 5 }, (_, i) => ({
    t: start + i * 86400, o: 100, h: 101, l: 99, c: 100, v: 1000,
  }))
}

describe('⭐ timenow and its five calendar fields are declared, fetch-anchored clock entries', () => {
  it('bare timenow clears the host lane and reads lastbartime', () => {
    const t = translatePine(S('timenow'), { strict: true })
    expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
    expect(t.mode).toBe('host')
    expect(t.outputs[t.selected].formula).toBe('lastbartime')
  })

  it.each([
    ['year', 'lastbaryear'],
    ['month', 'lastbarmonth'],
    ['dayofmonth', 'lastbardayofmonth'],
    ['hour', 'lastbarhour'],
    ['minute', 'lastbarminute'],
  ])('%s(timenow) is an identity onto %s', (fn, target) => {
    const t = translatePine(S(`${fn}(timenow)`), { strict: true })
    expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
    expect(t.outputs[t.selected].formula).toBe(target)
  })

  // ⭐⭐ VALUE CORRECTNESS, NOT JUST TRANSLATION — measured directly against
  // `computeClock`, the SAME lane `clockParity.test.js` holds to the
  // committed fixture, rather than through `interpret`/`parseFormula` (whose
  // grammar is the INTERNAL post-translation names — `lastbartime`, never
  // Pine's `timenow` — a distinction the first draft of this test got wrong
  // and which the "unknown name timenow" refusal caught immediately).
  // `lastbartime`/`lastbaryear`/… must equal the LAST bar's own
  // `time`/`year`/… exactly, on every bar -- read back, never recomputed, so
  // this cannot silently disagree with the clock columns everything else
  // already trusts.
  it('⭐⭐ every field broadcasts the newest bar\'s OWN value, on every bar', () => {
    const b = bars()
    const cols = computeClock(b)
    const lastI = b.length - 1
    const pairs = [
      ['lastbartime', 'time'], ['lastbaryear', 'year'], ['lastbarmonth', 'month'],
      ['lastbardayofmonth', 'dayofmonth'], ['lastbarhour', 'hour'],
      ['lastbarminute', 'minute'],
    ]
    for (const [lastField, ownField] of pairs) {
      const want = cols[ownField][lastI]
      for (let i = 0; i < b.length; i++) {
        expect(cols[lastField][i], `${lastField} bar ${i}`).toBe(want)
      }
    }
  })

  it('⛔ the unit gate blanks all six on a series whose t is not in seconds', () => {
    const bad = [
      { t: 20250101, o: 100, h: 101, l: 99, c: 100, v: 1000 },
      { t: 20250102, o: 100, h: 101, l: 99, c: 100, v: 1000 },
    ]
    const cols = computeClock(bad)
    const allSix = ['lastbartime', 'lastbaryear', 'lastbarmonth',
      'lastbardayofmonth', 'lastbarhour', 'lastbarminute']
    for (const name of allSix) {
      for (const v of cols[name]) expect(Number.isNaN(v), `${name}: ${v}`).toBe(true)
    }
  })

  // ⛔ NOT `time` — recorded here because it is the trap this whole feature
  // could have fallen into. Bare `time` is PERMANENTLY blocked by
  // `PINE_CLOCK_MISMATCH.time` (Pine's is milliseconds, this engine's is
  // seconds), before argument resolution ever reaches `BUILTIN_CALL_TREE`, so
  // `year(time)` can never arrive at the identity door at all -- checking for
  // it there would be dead code, not a second working form.
  it('⛔ every OTHER argument shape is declined by name, never guessed at', () => {
    for (const bad of ['time', 'time[1]', 'timenow + 1']) {
      const out = translatePine(S(`year(${bad})`), { strict: true })
      expect(out.ok, bad).toBe(false)
      expect(out.refusal.guard, bad).toBe('pine:builtin')
    }
    // `time`/`time[1]` refuse on the PRE-EXISTING, unrelated units guard --
    // measured, not assumed, so a future change to either refusal cannot
    // silently make this assertion vacuous.
    const timeMsg = translatePine(S('year(time)'), { strict: true }).refusal.message
    expect(timeMsg).toMatch(/MILLISECONDS/)
    // A computed timestamp gets THIS feature's own bespoke message, not the
    // generic "maps to nothing" one `year` (a clock entry, not a function)
    // would otherwise produce.
    const computedMsg = translatePine(S('year(timenow + 1)'), { strict: true }).refusal.message
    expect(computedMsg).toMatch(/timenow/)
    expect(computedMsg).toMatch(/TO UNBLOCK/)
  })

  it('⛔⛔ every real corpus script that names timenow still refuses on an unrelated blocker (measured, not overclaimed)', () => {
    const cases = [
      ['chart-champions-part-1-npoc-levels-vwaps__wdeUFJ4ZD2.pine', 'pine:function', /math\.ceil/],
      ['initial-balance-ib-and-previous-day-week-high-low-close__M0u1uaug4Q.pine', 'pine:builtin', /MILLISECONDS/],
      ['mtf-key-levels-support-and-resistance__29f470a089.pine', 'pine:function-def', /f_round_up_to_tick/],
      ['swing-points-and-liquidity-by-leviathan__919c1fd9c6.pine', 'pine:request', /request/],
    ]
    for (const [file, guard, messagePattern] of cases) {
      const src = fs.readFileSync(path.join(CORPUS, file), 'utf8')
      const t = translatePine(src, { strict: true })
      expect(t.ok, file).toBe(false)
      expect(t.refusal.guard, file).toBe(guard)
      expect(t.refusal.message, file).toMatch(messagePattern)
      // None of the four refuse ON `timenow` itself -- the capability this
      // file adds is not what is blocking any of them today.
      expect(t.refusal.message, file).not.toMatch(/`timenow`/)
    }
  })
})
