// ─── `time(<timeframe>)`, THE ONE-ARGUMENT ANCHOR FORM, WAS PERMANENTLY
// REFUSED — `pine.js::resolveTableCall` ALREADY CARRIED A DELIBERATE,
// ARITY-SPLIT REFUSAL FOR IT, WRITTEN BEFORE THIS FIX AND NAMING THE EXACT
// GAP ("the period it sits inside is a node this engine does not have") ──
//
// Real Pine's `time(timeframe, session, bars_back, timeframe_bars_back)`
// (TradingView v6 reference manual, `#fun_time`) "returns the opening UNIX
// timestamp for the specified timeframe and session". The one-argument form
// members actually write (`time(tf)`, `session`/`bars_back`/
// `timeframe_bars_back` all defaulted) is the MTF idiom
// `ta.change(time(tf)) != 0` — "did we just cross into a new higher-
// timeframe bar" — never the raw value.
//
// ⭐⭐ THE FIX IS A NEW CLOCK COLUMN (`dayopentime`), NOT A REINTERPRETATION
// OF THE EXISTING REFUSAL. `sessionfirst` already computes, per bar, the ET
// calendar day as one number (`day = y*10000 + m*100 + d`) and compares it
// to the previous bar's — a boundary FLAG. `dayopentime` is the same `day`
// key turned into a VALUE: the opening UNIX-SECONDS timestamp of the ET
// calendar day containing this bar, the same value on every bar of that
// day, computed with no calendar/DST arithmetic at all (this bar's own
// already-correct ET hour/minute, read off `etClockParts`, subtracted
// straight from its own `t`). `pine.js::resolveTableCall`'s existing
// arity-split branch (`anchorForm = bare === 'time' && args.length === 1`)
// now tries `timeframeLiteralOf` on the argument FIRST — the same folding
// `request.security`'s own timeframe argument already uses (a literal, a
// bound variable, a constant-foldable ternary, or an `input.timeframe`/
// `input.string`/`input` default) — and redirects to `dayopentime` only
// when the resolved code is `"D"`/`"1D"`. Anything else (W, M, any
// intraday code, or an argument that cannot be folded to a literal at all)
// falls through to the SAME pre-existing refusal, text updated to say `"D"`
// now works.
//
// ⚠️ TWO DELIBERATE, NARROWER-THAN-VENDOR SIMPLIFICATIONS, STATED RATHER
// THAN SILENTLY MATCHED ONLY FOR THE COMMON CASE:
//   1. Real Pine's `session` argument (defaulted to "the symbol's session")
//      can make `time()` answer `na` outside regular hours. This engine
//      never filters by session for the one-argument form — every real
//      corpus script that needs this reads it through `ta.change(...)`/`>`
//      boundary detection only, never the raw value, so the simplification
//      is faithful to what they actually ask.
//   2. Only "D"/"1D" redirects. W/M/intraday resampling is a separate,
//      harder capability (real week/month-start rules, or — for intraday —
//      the session-open-vs-midnight bucket-alignment question this
//      codebase has already hit and documented elsewhere for 60-minute
//      bars) that nothing in the real corpus needs today.
//
// Measured against the real 266-script committed corpus, 2026-09-20 (under
// the SAME `{ strict: true }` this project's other accept tests use — a
// looser, non-strict probe reports a materially different, less honest
// picture and must not be trusted): 6 scripts name `time(` as a construct
// they refuse on; of those, the aggregate count hides a fork found by
// reading each real call site rather than trusting the guard name. ZERO of
// the 4 one-argument-anchor-form scripts fully translate — the SAME shape
// `timenow` shipped with (0/4 direct unlocks, built anyway on real demand +
// clean architecture). What moved: `time` is no longer why HALF of them
// refuse. `fibonacci-retracement-mtflog` and `pa-zigzag-fibonacci-fan`
// (both default "1D") clear `time` and converge on separate, unrelated,
// pre-existing blockers (a comma-joined-statement parse shape neither
// `time` nor `request.security` reach for the first; an unfoldable
// reassignment inside a helper function for the second — `request.security`
// is never even reached in either case). `zigzag-ma-pattern-recognition`
// (defaults "15", an intraday code out of this slice's scope) and
// `smart-money-concepts-by-welotrades` (`time(res)` reads a user-defined
// function's FORMAL PARAMETER, which `timeframeLiteralOf` cannot chase — a
// separate, harder, not-yet-built capability) both still refuse on `time`
// itself, unaffected by this fix, by design. Recorded honestly below,
// mirroring `pineValuewhenOccurrenceAccept.test.js`'s own discipline.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine'
import { computeClock } from '../../indicators.js'

const CORPUS = path.resolve(__dirname, '../../../../../../corpus/committed')

const S = (body) => `//@version=6\nindicator("t")\nplot(${body})\n`

describe('⭐ time(<timeframe>) one-argument anchor form redirects to dayopentime for "D"', () => {
  it('time("D") clears the host lane', () => {
    const t = translatePine(S('ta.change(time("D")) != 0 ? 1 : 0'), { strict: true })
    expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
    expect(t.mode).toBe('host')
    expect(t.refusal).toBe(null)
  })

  it('routes onto the dayopentime clock leaf, not a new node type', () => {
    const t = translatePine(S('ta.change(time("D")) != 0 ? 1 : 0'), { strict: true })
    expect(t.outputs[t.selected].formula).toBe('change(dayopentime) != 0 ? 1 : 0')
  })

  it('"1D" normalises to the same "D" code as "D" itself', () => {
    const bare = translatePine(S('time("D")'), { strict: true })
    const oneD = translatePine(S('time("1D")'), { strict: true })
    expect(oneD.ok, JSON.stringify(oneD.refusal)).toBe(true)
    expect(oneD.outputs[oneD.selected].formula).toBe(bare.outputs[bare.selected].formula)
  })

  // ⭐⭐ THE REAL CORPUS IDIOM: an `input.timeframe`-bound variable, exactly
  // how all 4 of the "1-argument anchor form" corpus scripts write it
  // (`tf = input.timeframe("1D", "TimeFrame")` then `time(tf)`).
  // `timeframeLiteralOf` folds the input's default the same way
  // `request.security`'s own timeframe argument already does.
  it('an input.timeframe-bound variable folds to its default, exactly like the real corpus scripts write it', () => {
    const src = '//@version=6\nindicator("t")\n'
      + 'tf = input.timeframe("1D", "TimeFrame")\n'
      + 'plot(ta.change(time(tf)) != 0 ? 1 : 0)\n'
    const t = translatePine(src, { strict: true })
    expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
    expect(t.outputs[t.selected].formula).toBe('change(dayopentime) != 0 ? 1 : 0')
  })

  // ⭐⭐ VALUE CORRECTNESS, DIRECTLY AGAINST `computeClock` — never
  // `interpret(parseFormula(...))`, which operates on the internal
  // post-translation grammar and never declares a Pine surface spelling at
  // all (the exact `timenow` gotcha this memory already carries).
  // Two bars on 2026-01-05 ET (09:30 and 15:45, both EST) and one bar on
  // 2026-01-06 ET (09:30 EST) — a plain intraday timeframe, so the unit
  // gate (real unix-second `t`) is satisfied.
  it('⭐⭐ dayopentime is the SAME value on every bar of one ET day, and a DIFFERENT value the next day', () => {
    const bars = [
      { t: 1767623400, o: 1, h: 1, l: 1, c: 1, v: 1 }, // 2026-01-05 09:30 ET
      { t: 1767645900, o: 1, h: 1, l: 1, c: 1, v: 1 }, // 2026-01-05 15:45 ET
      { t: 1767709800, o: 1, h: 1, l: 1, c: 1, v: 1 }, // 2026-01-06 09:30 ET
    ]
    const cols = computeClock(bars, '5', false)
    const midnightDay1 = 1767589200 // 2026-01-05 00:00 ET (EST, UTC-5)
    const midnightDay2 = 1767675600 // 2026-01-06 00:00 ET (EST, UTC-5)
    expect(cols.dayopentime[0]).toBe(midnightDay1)
    expect(cols.dayopentime[1]).toBe(midnightDay1)
    expect(cols.dayopentime[2]).toBe(midnightDay2)
    // and it changes exactly once, which is the whole thing the real corpus
    // idiom (`ta.change(time(tf)) != 0`) actually reads
    expect(cols.dayopentime[1] === cols.dayopentime[0]).toBe(true)
    expect(cols.dayopentime[2] !== cols.dayopentime[1]).toBe(true)
  })

  // ⭐ NO FIXED 24H STEP-BACK: a bar the Friday before DST spring-forward
  // (2026-03-06, EST, UTC-5) and a bar the Monday after (2026-03-09, EDT,
  // UTC-4) each resolve to THEIR OWN day's midnight under THEIR OWN
  // offset — proving the column reads `etClockParts`'s already-DST-correct
  // hour/minute rather than subtracting a constant.
  it('⭐ no fixed-24h assumption: midnight lands on the correct UTC instant on both sides of a DST transition', () => {
    const bars = [
      { t: 1772807400, o: 1, h: 1, l: 1, c: 1, v: 1 }, // 2026-03-06 09:30 ET (EST)
      { t: 1773063000, o: 1, h: 1, l: 1, c: 1, v: 1 }, // 2026-03-09 09:30 ET (EDT)
    ]
    const cols = computeClock(bars, '5', false)
    expect(cols.dayopentime[0]).toBe(1772773200) // 2026-03-06 00:00 EST = 05:00 UTC
    expect(cols.dayopentime[1]).toBe(1773028800) // 2026-03-09 00:00 EDT = 04:00 UTC
  })

  // ⛔⛔ THE UNIT GATE APPLIES TO dayopentime EXACTLY AS IT DOES TO THE
  // OTHER EIGHT (now nine) time-derived columns: a series whose `t` is not
  // real unix seconds (the `YYYYMMDD`-int shape daily/weekly/monthly bars
  // are stored as) blanks ALL of them together, `dayopentime` included.
  it('⛔⛔ the unit gate blanks dayopentime exactly like every other time-derived column', () => {
    const dailyShapedBars = [{ t: 20260105, o: 1, h: 1, l: 1, c: 1, v: 1 }]
    const cols = computeClock(dailyShapedBars, 'D', false)
    expect(Number.isNaN(cols.dayopentime[0])).toBe(true)
    expect(Number.isNaN(cols.time[0])).toBe(true)
    expect(Number.isNaN(cols.sessionfirst[0])).toBe(true)
  })

  it('⛔ any OTHER period still refuses, with an updated message confirming "D" now works', () => {
    for (const tf of ['"W"', '"M"', '"60"']) {
      const t = translatePine(S(`ta.change(time(${tf})) != 0 ? 1 : 0`), { strict: true })
      expect(t.ok, tf).toBe(false)
      expect(t.refusal.guard, tf).toBe('pine:function')
      expect(t.refusal.message, tf).toMatch(/time\("D"\).*translates/)
      expect(t.refusal.message, tf).toMatch(/sessionfirst/)
    }
  })

  it('⛔ an argument that cannot be folded to any timeframe literal still refuses the same way', () => {
    const t = translatePine(S('ta.change(time(syminfo.tickerid)) != 0 ? 1 : 0'), { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:function')
    expect(t.refusal.message).toMatch(/OPENING TIMESTAMP/)
  })

  // ⛔⛔ THE 2+-ARGUMENT SESSION/TIMEZONE FORM IS UNCHANGED BY THIS FIX —
  // it never reaches the `anchorForm` branch at all (`args.length === 1`
  // gates it out), so it keeps refusing through whatever pre-existing path
  // already handled it.
  it('⛔⛔ the 2-argument session form is UNCHANGED — still refuses, never mentions dayopentime', () => {
    const t = translatePine(S('ta.change(time("D", "0930-1600")) != 0 ? 1 : 0'), { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.message).not.toMatch(/dayopentime/)
  })

  // ⛔⛔ THE HONEST CORPUS RESULT, MEASURED UNDER THE SAME `{ strict: true }`
  // THIS PROJECT'S OTHER ACCEPT TESTS USE, NOT OVERCLAIMED. ZERO of the 4
  // real one-argument-anchor-form scripts fully translate — the SAME shape
  // as `timenow`'s own shipped result (0/4 direct, real demand anyway).
  // What moved: for 2 of the 4, `time` is no longer why the script refuses.
  it('⭐⭐ the real corpus: zero full unlocks, but `time` is no longer why HALF of the 4 scripts refuse', () => {
    // `fibonacci-retracement-mtflog` (defaults "1D"): clearing `time`
    // reveals EVERY one of its plot lines shares one pre-existing, unrelated
    // shape this table cannot parse at all --
    // `l_XXXX = f_ret(...),  plot(l_XXXX, ...)`, a comma-joined
    // assignment+plot on one line -- confirmed structural (not a `time`
    // side-effect) by grep: all 8 of this file's plot lines use the
    // identical shape, so this file could never have translated end-to-end
    // regardless of `time()`.
    const fib = fs.readFileSync(
      path.join(CORPUS, 'fibonacci-retracement-mtflog__54a8dbfa8e.pine'), 'utf8')
    const rFib = translatePine(fib, { strict: true })
    expect(rFib.ok).toBe(false)
    expect(rFib.refusal.guard).toBe('pine:statement')
    expect(rFib.refusal.message).not.toMatch(/time\(|dayopentime/i)

    // `pa-zigzag-fibonacci-fan` (defaults "1D"): clears `time` and converges
    // on a separate, unrelated blocker inside its own `zigzag()` helper
    // (`_dir` cannot be folded across a reassignment) -- never `time`,
    // never `dayopentime`, and `request.security` is never even reached.
    const paZigzag = fs.readFileSync(
      path.join(CORPUS, 'pa-zigzag-fibonacci-fan__2001.pine'), 'utf8')
    const rPaZigzag = translatePine(paZigzag, { strict: true })
    expect(rPaZigzag.ok).toBe(false)
    expect(rPaZigzag.refusal.guard).toBe('pine:reassign')
    expect(rPaZigzag.refusal.message).not.toMatch(/time\(|dayopentime/i)

    // `zigzag-ma-pattern-recognition` (defaults "15", an intraday code out
    // of THIS slice's scope) STILL refuses on `time` itself -- unaffected,
    // by design, and the message says so.
    const zigzagMa = fs.readFileSync(
      path.join(CORPUS, 'zigzag-ma-pattern-recognition__1302.pine'), 'utf8')
    const rZigzagMa = translatePine(zigzagMa, { strict: true })
    expect(rZigzagMa.ok).toBe(false)
    expect(rZigzagMa.refusal.guard).toBe('pine:function')
    expect(rZigzagMa.refusal.message).toMatch(/OPENING TIMESTAMP/)

    // `smart-money-concepts-by-welotrades` calls `time(res)` where `res` is
    // a USER-DEFINED FUNCTION'S FORMAL PARAMETER, not a variable
    // `timeframeLiteralOf` can chase -- a separate, harder, not-yet-built
    // capability. STILL refuses on `time` itself, unaffected by this fix.
    const welotrades = fs.readFileSync(
      path.join(CORPUS, 'smart-money-concepts-by-welotrades__0bff41a2e5.pine'), 'utf8')
    const rWelotrades = translatePine(welotrades, { strict: true })
    expect(rWelotrades.ok).toBe(false)
    expect(rWelotrades.refusal.guard).toBe('pine:function')
    expect(rWelotrades.refusal.message).toMatch(/OPENING TIMESTAMP/)
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
