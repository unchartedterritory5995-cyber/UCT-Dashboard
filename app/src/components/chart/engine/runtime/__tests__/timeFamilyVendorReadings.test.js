// app/src/components/chart/engine/runtime/__tests__/timeFamilyVendorReadings.test.js
//
// ─── ⭐⭐ THE `time()` FAMILY — ANSWERED ON DISK, UNREAD FOR ELEVEN DAYS ─────
//
// `time(...)` is the LARGEST unimplemented name in `corpus/committed`:
// **139 call sites across 39 scripts**, measured over comment- and
// string-stripped source. Every one of them refuses at `pine:function`, in
// BOTH lanes.
//
// Two vendor captures answer its semantics completely, and until this file
// neither was read by any test or any source file in the repo:
//
//   tests/fixtures/vendor/r11-time-tf-spy-1d-2026-09-11.json       (Q1, Q2, Q4)
//   tests/fixtures/vendor/r11-time-session-spy-5m-2026-09-11.json  (Q3)
//
// ⚰️⚰️ AND THIS PROGRAMME CARRIED "`time(<timeframe>)` semantics" ON ITS OPEN
// LIST AS AN OWNER RULING STILL OWED. It is not owed. It was read off a live
// TradingView chart on 2026-09-11, written to disk, and never opened — the
// second time in this session that an artifact settled a question the backlog
// still described as open (`math.round`'s half-rule was the first). ⭐ The cost
// of an unread capture is not the capture; it is the decision that waits on it.
//
// ─── WHAT THE VENDOR SAID, AND WHY EACH HALF MATTERS ────────────────────────
//
//   Q2  time(timeframe.period)  ===  `time`, EXACTLY.
//       Delta measured 0 on every one of 610 bars, `na` on none.
//       ⭐ THIS ONE IS FREE. It is an identity, not an implementation.
//
//   Q1  time("W") on a 1D chart  =  the FORMING week's open. NEVER `na`.
//       Three consecutive daily bars hold `timeW` CONSTANT at 20704.5625
//       while the bar's own time increments — which is what distinguishes
//       "the forming week" from "the last completed week" and from `na`.
//
//   Q4  time("D") != time("D")[1]  FOLDS, and is `na`-free.
//       ⛔ Conditional on Q1 being `na`-free, which the backlog said in as
//       many words. It is, so the classic new-period idiom is safe.
//
//   Q3  time(tf, "0930-1600")  =  `na` OUTSIDE the session, the BAR'S OWN
//       `time` inside it. It is NOT the session's start instant.
//       ⭐⭐ SO THE 52 TWO-ARGUMENT SITES ARE A MEMBERSHIP TEST. Inside the
//       session `tsess - time` measured EXACTLY 0 on all 156 in-session bars:
//       the value carries no information the bar did not already have, and
//       the `na`-ness is the entire signal. A translation that reads the
//       return as a session-start instant is reading data that is not there.
//
//   Q3b THE WINDOW IS HALF-OPEN, [09:30, 16:00).
//       The 09:30 bar is INSIDE (na 1 -> 0) and the 16:00 bar is ALREADY
//       OUTSIDE (na 0 -> 1). That is one bar's worth of difference on every
//       session boundary in every script that uses it, and it is exactly the
//       kind of edge nobody guesses right.
//
// ⛔⛔ THIS FILE IMPLEMENTS NOTHING. It asserts the gap REFUSES — the same
// discipline as `groupBVendorReadings.test.js`. "We do not serve this" and
// "we serve it wrongly" are different facts to a member and only the first is
// shippable, so if any of these starts silently ANSWERING this goes red and
// somebody has shipped a semantics nobody encoded from the capture.
//
// ⭐ AND THAT IS THE POINT OF PINNING A GAP. The next engineer to implement
// `time()` does not need the TradingView session back: the numbers are here,
// the half-open boundary is here, and this test will tell them the moment
// their implementation starts answering.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { translatePine } from '../../ast/pine.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 30
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + (i % 5), h: 110 + (i % 7), l: 90 - (i % 3), c: 100 + (i % 11), v: 10 + i,
}))
const head = '//@version=6\nindicator("t")\n'
const Q = String.fromCharCode(34)

const REPO = path.resolve(process.cwd(), '..')
const VENDOR = path.join(REPO, 'tests/fixtures/vendor')
const TF = JSON.parse(fs.readFileSync(path.join(VENDOR, 'r11-time-tf-spy-1d-2026-09-11.json'), 'utf8'))
const SESS = JSON.parse(fs.readFileSync(path.join(VENDOR, 'r11-time-session-spy-5m-2026-09-11.json'), 'utf8'))

/** The guard the RUNTIME lane stops on, or 'ok' when it builds. */
function runtimeGuard(body) {
  let built = null
  try { built = buildRuntimeIr(head + body, { bars: BARS, inputs: {} }) } catch (e) {
    return `threw:${String(e && e.message).slice(0, 40)}`
  }
  return built.ok ? 'ok' : String((built.refusal || {}).guard || '?')
}

/** The guard the HOST/columnar lane stops on, or 'ok'. */
function hostGuard(body) {
  try {
    const t = translatePine(head + body, { strict: true })
    return (t && t.ok === false) ? String((t.refusal || {}).guard || '?') : 'ok'
  } catch (e) { return `threw:${String(e && e.message).slice(0, 40)}` }
}

describe('⭐⭐ the `time()` family — the vendor readings, finally pinned', () => {
  it('⛔ CONTROL — both captures are on disk and carry their answers', () => {
    // ⭐ Every expectation below is derived from these two objects. If either
    // were empty the whole file would pass by asserting nothing.
    expect(TF.symbol).toBe('AMEX:SPY')
    expect(TF._compiles).toBe(true)
    expect(SESS._compiles).toBe(true)
    expect(Object.keys(TF)).toEqual(expect.arrayContaining([
      'Q1_timeW_on_a_daily_chart',
      'Q2_timeSelf_on_the_charts_own_timeframe',
      'Q4_the_new_period_idiom_folds',
    ]))
  })

  it('⭐⭐ Q2 — `time(timeframe.period)` is EXACTLY `time`, and that is an IDENTITY', () => {
    // ⭐ THE CHEAPEST FACT IN THE FILE, and the one most worth writing down:
    // it needs no calendar, no session table and no week bucketing. The
    // vendor measured a delta of zero on every bar and `na` on none, so a
    // future implementation of this one arm is a fold, not a feature.
    const q2 = TF.Q2_timeSelf_on_the_charts_own_timeframe
    expect(q2.delta_seconds_distinct).toEqual([0])
    expect(q2.naCount).toBe(0)
    expect(String(q2.verdict)).toMatch(/EXACTLY/i)
  })

  it('⭐⭐ Q1 — `time("W")` is the FORMING week, and the witnesses are the proof', () => {
    // ⛔ THREE VERDICTS WERE POSSIBLE AND THEY DIFFER ON EVERY NON-BOUNDARY
    // BAR: `na`, the forming week's open, or the last COMPLETED week's open.
    // The discriminator is that `timeW` holds CONSTANT while the bar's own
    // time advances — a reading that no single bar could have settled.
    const q1 = TF.Q1_timeW_on_a_daily_chart
    expect(q1.naCount).toBe(0)
    expect(q1.notNaCount).toBeGreaterThan(0)
    expect(q1.alwaysAtOrBeforeThisBar).toBe(true)
    expect(String(q1.verdict)).toMatch(/FORMING/i)

    // the witnesses hold one value while the bar's own time moves
    const w = q1.witnesses || []
    expect(w.length).toBeGreaterThan(1)
    expect(new Set(w.map((x) => x.timeW_rawDays)).size).toBe(1)
    expect(new Set(w.map((x) => x.time_rawDays)).size).toBe(w.length)
  })

  it('⭐ Q4 — the new-period idiom folds, and only because Q1 is `na`-free', () => {
    const q4 = TF.Q4_the_new_period_idiom_folds
    expect(q4.timeD_naCount).toBe(0)
    expect(q4.changed_distinctValues).toEqual([1])
    expect(q4.changedCount).toBe(q4.totalBars)
  })

  it('⭐⭐ Q3 — the 2-arg form is a MEMBERSHIP TEST, not a session-start instant', () => {
    // ⚰️ THE READING THAT CHANGES THE CODE. 52 two-argument sites in the
    // corpus are either "are we in the session?" or "when did the session
    // start?", and those produce different translations. Inside the session
    // the value is the bar's own `time` — delta EXACTLY 0 across all
    // in-session bars — so there is no start instant to read.
    expect(SESS.verdict.outsideTheSession).toBe('na')
    expect(SESS.verdict.isSessionStartTime).toBe(false)

    const inside = SESS.measured.insideTheSession
    const outside = SESS.measured.outsideTheSession
    expect(inside.sess_minus_time_seconds_distinct).toEqual([0])
    expect(inside.na_count).toBe(0)
    expect(outside.not_na_count).toBe(0)
    expect(outside.na_count).toBe(outside.bars)

    // ⛔ NON-VACUITY, AND THE CAPTURE'S OWN DISCIPLINE. Its first attempt used
    // the chart's `regular` session, where every bar is inside the window —
    // so `na` had no bar to be true on and the reading was indistinguishable
    // from "it is never na". BOTH populations must be non-empty.
    expect(inside.bars).toBeGreaterThan(0)
    expect(outside.bars).toBeGreaterThan(0)
  })

  it('⛔⛔ Q3b — the session window is HALF-OPEN: the 16:00 bar is OUTSIDE', () => {
    // ⭐ One bar per session boundary, in every script that uses this. The
    // boundaries are read out of the capture rather than restated.
    const b = SESS.measured.boundaries || []
    expect(b.length).toBeGreaterThan(1)
    const open = b.find((x) => String(x.to).includes('na=0'))
    const close = b.find((x) => String(x.to).includes('na=1'))
    expect(open, 'no opening boundary recorded').toBeTruthy()
    expect(close, 'no closing boundary recorded').toBeTruthy()
    expect(String(open.to)).toMatch(/09:30/)
    expect(String(close.to)).toMatch(/16:00/)
  })

  it('⛔⛔ AND EVERY ARM REFUSES TODAY — in BOTH lanes, so neither answers wrongly', () => {
    // ⭐ This is the half that makes the file a rail rather than a note. The
    // moment any of these starts answering, this goes red and the next
    // engineer is sent to the readings above instead of guessing.
    // ⚰️ `time("D")` LEFT THIS LIST ON 2026-09-23, AND THAT IS THIS RAIL WORKING
    // EXACTLY AS ITS COMMENT PROMISED: *"the moment any of these starts
    // answering, this goes red and the next engineer is sent to the readings
    // above instead of guessing."* It went red, the readings were read, and Q4
    // had already settled the semantics — `dayopentime` is the node, and the
    // merge that brought the two lineages together is what made it reachable.
    // ⛔ THE OTHER THREE STAY, because nothing has measured them: `"W"`,
    // `timeframe.period` as a NAME, and the two-argument session form.
    const arms = [
      ['time(timeframe.period)', 'plot(time(timeframe.period) - time)'],
      ['time("W")', `plot(time(${Q}W${Q}))`],
      ['time(tf, session)', `plot(na(time(timeframe.period, ${Q}0930-1600${Q})) ? 0 : 1)`],
    ]
    for (const [label, src] of arms) {
      expect(runtimeGuard(src), `${label} — runtime lane no longer refuses`).toBe('pine:function')
      expect(hostGuard(src), `${label} — host lane no longer refuses`).toBe('pine:function')
    }
  })

  it('⭐⭐ `time("D")` ANSWERS, and in the SAME UNIT as bare `time`', () => {
    // ⛔⛔ THE MERGE OF 2026-09-23 MADE THESE TWO SPELLINGS DISAGREE BY 1000×,
    // out of two halves that were each correct alone. `dayopentime` is SECONDS
    // — the manifest says so in its own words — and the other lineage had
    // reconciled the bare `time` NAME to Pine's milliseconds.
    //
    // ⚰️ AND THE IDIOM THAT WOULD HAVE CAUGHT IT IS THE ONE THAT KEPT WORKING:
    // `time("D") != time("D")[1]` compares like with like. What broke is
    // `time > time("D")` — the anchor comparison this file's own refusal text
    // describes in those very words — wrong by three orders of magnitude.
    //
    // ⭐ ITS OWN INTRADAY BARS, because the shared fixture is DAILY: every bar
    // would be its own day and "constant within the day" could not be tested.
    const M = 8
    const HOURLY = Array.from({ length: M }, (_, i) => ({
      t: 1700000000 + i * 3600, o: 100, h: 101, l: 99, c: 100 + i, v: 10,
    }))
    const SERIES = ['o', 'h', 'l', 'c', 'v']
      .map((k) => Float64Array.from(HOURLY.map((b) => b[k])))
    const seriesOf = (body2) => {
      const built = buildRuntimeIr(head + body2, { bars: HOURLY, inputs: {}, basePeriod: '60' })
      expect(built.ok, built.ok ? '' : String((built.refusal || {}).guard)).toBe(true)
      const prog = lowerIrProgram(built.ir)
      const r = execute(prog, {
        bars: M, series: SERIES, columns: prog.columns, confirmed: true,
        barTimes: HOURLY.map((b) => b.t),
      })
      return Array.from(r.outputs[0])
    }
    const t = seriesOf('plot(time)')
    const d = seriesOf(`plot(time(${Q}D${Q}))`)
    expect(t.every(Number.isFinite) && d.every(Number.isFinite)).toBe(true)
    // ⛔ THE ANCHOR IS AT OR BEFORE EVERY BAR OF ITS DAY, IN THE SAME UNIT.
    // A ratio, never two pinned numbers: pinning either alone would pass while
    // the other drifted, which is exactly how the defect survived being built.
    for (let i = 0; i < M; i += 1) expect(d[i]).toBeLessThanOrEqual(t[i])
    // and the same ORDER of magnitude — 1000× apart is the defect itself
    expect(t[0] / d[0]).toBeLessThan(10)
    // ⛔ BROADCAST ACROSS THE DAY — the property that makes it an ANCHOR, and the
    // one a fold to bare `time` would destroy. These eight hourly bars cross a
    // New York midnight, so the honest assertion is not "one value" but "FEWER
    // values than bars, each held for a run": a fold to `time` would give M.
    expect(new Set(d).size).toBeGreaterThan(0)
    expect(new Set(d).size).toBeLessThan(M)
    // and it never goes backwards — a day open is monotonic in bar order
    for (let i = 1; i < M; i += 1) expect(d[i]).toBeGreaterThanOrEqual(d[i - 1])
    // ⛔ NON-VACUITY: bare `time` really does take a new value on every bar, so
    // "fewer than M" is a fact about the anchor and not about the fixture.
    expect(new Set(t).size).toBe(M)
  })

  it('⛔ CONTROL — the probes are well-formed, so the refusals are about `time`', () => {
    // ⭐ THE ONE WAY THE TEST ABOVE IS QUIETLY WORTHLESS: a syntax error in
    // the fixture would refuse too, and for the wrong reason. The same
    // expression shapes, over a name the engine DOES serve, must build.
    expect(runtimeGuard('plot(sma(close, 3) - close)')).toBe('ok')
    expect(hostGuard('plot(sma(close, 3) - close)')).toBe('ok')
    expect(runtimeGuard('plot(na(sma(close, 3)) ? 0 : 1)')).toBe('ok')
  })
})
