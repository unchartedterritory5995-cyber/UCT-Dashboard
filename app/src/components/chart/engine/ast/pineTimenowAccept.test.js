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
//   - `chart-champions-part-1-npoc-levels-vwaps__wdeUFJ4ZD2.pine` refused on
//     `math.ceil` at the time this was written; `math.ceil` joined the table
//     the same day (see `pineMathCeilAccept.test.js`), and clearing it
//     surfaced a SEPARATE, PERMANENT blocker: `pine:builtin` naming
//     `syminfo.mintick`, an architectural gap this engine holds no value for,
//     for any symbol — the same class `math.floor`'s own renko script
//     converged on. Wholly unrelated to `timenow`, and this file does not
//     touch it.
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

  // ⚰️ THIS SAID `year(time)` "can never arrive at the identity door at all",
  // because bare `time` refused at `PINE_CLOCK_MISMATCH`. The 2026-09-23 merge
  // made a VERSIONED script's `time` reconcile to Pine's milliseconds, so it did
  // arrive — and refused as "that argument". Since the 2026-09-27 vocabulary
  // wave it is its own identity onto the BARE field (`pineVocabularyWave.test.js`
  // owns that rail), so `time` leaves this list of declined shapes.
  it('⛔ every OTHER argument shape is declined by name, never guessed at', () => {
    for (const bad of ['time[1]', 'timenow + 1']) {
      const out = translatePine(S(`year(${bad})`), { strict: true })
      expect(out.ok, bad).toBe(false)
      expect(out.refusal.guard, bad).toBe('pine:builtin')
    }
    // ⚰️ THIS ASSERTED THE UNITS MESSAGE FOR A `//@version=6` SCRIPT, AND THE
    // MERGE OF 2026-09-23 MADE THAT PREMISE FALSE — in the better direction.
    //
    // The other lineage carries BOTH halves of the clock question, side by side
    // in `pine.js`: `PINE_CLOCK_MISMATCH` (the units sentence) and,
    // immediately after it, *"A MISMATCH THAT IS EXACTLY RECONCILABLE, FOR A
    // SCRIPT SPEAKING PINE"* — `PINE_CLOCK_TRANSFORM`, which reconciles `time`
    // to Pine's milliseconds whenever the script declares a version. So for a
    // VERSIONED script there is no longer a mismatch to report, and telling a
    // member about one would be false; the honest refusal is the one they now
    // get, that `year` does not take that argument.
    //
    // ⭐ THE CASE'S INTENT IS PRESERVED BY MOVING IT, NOT BY DELETING IT: the
    // units guard is still real and still reachable, on the VERSIONLESS path
    // where nothing reconciles anything — which is exactly what this assertion
    // exists to prove cannot silently vanish.
    const versionless = translatePine(`indicator(\"t\")\nplot(year(time))\n`, { strict: true })
    expect(versionless.ok).toBe(false)
    expect(versionless.refusal.message).toMatch(/MILLISECONDS/)
    // ⛔ AND THE VERSIONED SCRIPT NOW TRANSLATES — to the bare field, which is
    // what `year(time)` means in Pine (2026-09-27). Asserted, so the two paths
    // cannot quietly converge on one answer again.
    const versioned = translatePine(S('year(time)'), { strict: true })
    expect(versioned.ok).toBe(true)
    expect(versioned.outputs[versioned.selected].formula).toBe('year')
    // A computed timestamp gets THIS feature's own bespoke message, not the
    // generic "maps to nothing" one `year` (a clock entry, not a function)
    // would otherwise produce.
    const computedMsg = translatePine(S('year(timenow + 1)'), { strict: true }).refusal.message
    expect(computedMsg).toMatch(/timenow/)
    expect(computedMsg).toMatch(/TO UNBLOCK/)
  })

  it('⛔⛔ every real corpus script that names timenow still refuses on an unrelated blocker, or translates whole (measured, not overclaimed)', () => {
    const cases = [
      // ⚰️ WAS pine:builtin /syminfo.mintick/. 2026-09-28: `syminfo.mintick` is
      // served on the chart pane for a witnessed exchange (symbolScope.json::
      // tick_size), so the host lane walks past line 73 to the next wall — the
      // `time(<timeframe>)` anchor at line 84. Still refuses, still not on `timenow`.
      // ⚰️ …AND MOVED AGAIN 2026-10-04 (G16): H5 (0df971ee42) reads `time(res)` inside
      // `newday(res)` as `time("D")`, which translates, so the next wall is line 140's
      // session clock `time(timeframe.period, '0000-0000:7')` - a window that wraps past
      // midnight, refused by name. Still refuses, still not on `timenow`.
      ['chart-champions-part-1-npoc-levels-vwaps__wdeUFJ4ZD2.pine', 'pine:function', /time\(<timeframe>, <session>\)[\s\S]*wraps past midnight/],
      // ⚰️ WAS /MILLISECONDS/. Same script, same guard, DIFFERENT blocker since
      // 2026-09-23: the merge reconciles `time` to Pine's milliseconds for any
      // script that declares a version, so this one no longer meets a units
      // mismatch — it meets the true reason, that `year` does not take that
      // argument. The case's claim is unchanged and still measured: it refuses,
      // and NOT on `timenow`.
      // ⚰️ …AND MOVED AGAIN 2026-09-27: `year(time)`/`month(time)`/
      // `dayofmonth(time)` now translate (vocabulary wave), so the script meets
      // its next wall — the `time(<session>)` session clock. Still refuses,
      // still not on `timenow`.
      // ⚰️ …AND AGAIN 2026-09-28: the session clock is served on the chart pane
      // for the chart's OWN timeframe (vw-time-session). This script asks it of
      // a timeframe argument that is not the chart's, which stays refused.
      ['initial-balance-ib-and-previous-day-week-high-low-close__M0u1uaug4Q.pine', 'pine:function', /OWN timeframe/],
      // ⚰️ WAS pine:function-def /f_round_up_to_tick/. Moved 2026-09-28
      // (`pineHostWalls5.test.js`): a body ending in a declaration now returns
      // what it declares, so `f_round_up_to_tick` folds and the script meets its
      // next wall — `syminfo.mintick`, the value it passes that helper. Still
      // refuses, still not on `timenow`.
      // ⚰️ …AND AGAIN at integration (2026-09-28): `syminfo.mintick` is served
      // (#238), so the script meets the wall after that one — a
      // `time(<timeframe>)` anchor for a period other than "D".
      // ⚰️ …AND LEFT THIS LIST 2026-09-30 (C30): `time("12M")` on a daily chart is
      // served (vw-time-tf-spy-1d), and the script now TRANSLATES — asserted
      // below, by name, rather than dropped.
      ['swing-points-and-liquidity-by-leviathan__919c1fd9c6.pine', 'pine:request', /request/],
    ]
    const mtf = translatePine(fs.readFileSync(path.join(CORPUS,
      'mtf-key-levels-support-and-resistance__29f470a089.pine'), 'utf8'), { strict: true })
    expect(mtf.ok, JSON.stringify(mtf.refusal)).toBe(true)
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
