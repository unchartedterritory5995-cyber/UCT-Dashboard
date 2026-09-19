// app/src/components/chart/engine/ast/interpret.tfDaily.test.js
//
// ─── ⛔⛔ WHY `D` IS NOT IN `TF_RESAMPLABLE`, PINNED SO IT IS NOT RE-ATTEMPTED ──
//
// `TF_LADDER` declares `'D'`; `TF_RESAMPLABLE` does not. An omission with no
// stated reason cannot be told from an oversight, and this one looks like the
// easiest win on the board: `request.security(sym, "D", expr)` is one of the
// most-written lines in Pine and it refuses today.
//
// ⭐ IT WAS BUILT AND MEASURED BEFORE BEING REJECTED (2026-09-01). Declaring `D`
// with `TF_BASE_BARS.D = 1` and a `YYYY-MM-DD` bucket works — the corpus went
// 43 → 44. It was reverted anyway, and this file is the reason, kept executable
// so the next attempt starts from the measurement instead of the idea.
//
// ⛔ THE REASON IS THE ONE-BAR STEP-BACK, AND IT IS NOT OPTIONAL. A `tf` node
// reads THE LAST CLOSED PERIOD — that is the `+ 1` in `maxLookback`'s `tf` arm
// and it is what keeps a higher-timeframe read free of lookahead. On a daily
// base a `D` bucket is one bar, so `tf(close, 'D')` would answer YESTERDAY,
// while `request.security(sym, timeframe.period, close)` folds to plain `close`.
// Two spellings of one thing on a daily chart, one bar apart, neither refusing.
//
// ⚠️ AND `tf_live` IS NOT THE ANSWER EITHER, though it looks like it: it reads
// the FORMING bucket, which is the identity on a daily base and WRONG on an
// intraday one, where the last completed session really is what `"D"` means. The
// right node depends on the base timeframe, and the translator is not handed one.

import { describe, it, expect } from 'vitest'

import { TF_LADDER, TF_RESAMPLABLE, interpret } from './interpret.js'
import { parseFormula } from './parse.js'
import { translatePine } from './pine.js'

/** Fifteen weekdays: three whole ISO weeks starting Monday 2026-01-05. */
const BARS = (() => {
  const days = []
  for (const [mon, week] of [[5, 2], [12, 3], [19, 4]]) {
    for (let d = 0; d < 5; d++) {
      const day = mon + d
      days.push({ iso: `2026-01-${String(day).padStart(2, '0')}`, week })
    }
  }
  return days.map((d, i) => ({
    t: 20260100 + Number(d.iso.slice(8)), iso: d.iso, week: d.week,
    o: i + 1, h: i + 1, l: i + 1, c: i + 1, v: 100,
  }))
})()

const col = (f) => Array.from(interpret(parseFormula(f).ast, BARS, {}))
const pine = (body) => translatePine(`//@version=5\nindicator("t")\nplot(${body})\n`)

describe('the D ruling — the step-back that makes it unsafe', () => {
  it('⛔ `D` is on the LADDER and not RESAMPLABLE — the asymmetry is deliberate', () => {
    expect(TF_LADDER).toContain('D')
    expect(TF_RESAMPLABLE).not.toContain('D')
    // ⭐ and the two that ARE resamplable really are, so this is not a list that
    // simply says no to everything.
    expect(TF_RESAMPLABLE).toEqual(['W', 'M'])
  })

  it('⛔⛔ `tf` reads the LAST CLOSED period — the mechanism, measured', () => {
    // ⭐ THIS IS THE WHOLE RULING IN ONE ASSERTION. Closes run 1…15, five per
    // week. Week 3's bars must read week 2's final close (5) and week 4's must
    // read week 3's (10) — never their own week's running close. On a daily base
    // a `D` bucket holds exactly ONE bar, so this same step-back lands on
    // yesterday.
    const w = col("tf(close, 'W')")
    const at = (weekNo) => BARS.map((b, i) => (b.week === weekNo ? w[i] : null))
      .filter((v) => v !== null)

    expect(at(3)).toEqual([5, 5, 5, 5, 5])
    expect(at(4)).toEqual([10, 10, 10, 10, 10])
    // ⛔ THE NON-VACUITY HALF: the current week's own closes are NOT what it
    // answers. Without this the case would pass against a node that returned the
    // bar itself — which is precisely the alternative reading under discussion.
    const ownCloses = BARS.filter((b) => b.week === 4).map((b) => b.c)
    expect(at(4)).not.toEqual(ownCloses)
  })

  // ➕➕ ADDENDUM, 2026-09-12 — ruling 3.5. The assertion that used to sit here read
  // `request.security(_, "D", _)` refuses, and names the ladder. That is no longer
  // true, and the ruling above is not what changed: the STEP-BACK form is still
  // refused (the two tests above are untouched and still pass), while the IDENTITY
  // form now folds. Both halves are asserted below, because either one alone would
  // let the other regress silently.
  it('⛔ the STEP-BACK form is STILL unavailable — `D` never becomes a `tf` node', () => {
    // This is the 2026-09-01 ruling, restated as the thing it was actually about:
    // `tf(close, 'D')` would answer YESTERDAY on a daily base, so no door may emit it.
    expect(TF_RESAMPLABLE).not.toContain('D')
    const out = pine('request.security(syminfo.tickerid, "D", close)')
    expect(out.outputs[out.selected].formula).not.toBe("tf(close, 'D')")
    expect(out.outputs[out.selected].formula).not.toMatch(/tf\(.*'D'\)/)
  })

  it('⭐ and the IDENTITY form folds — `D` equals the base, so it is the bars in hand', () => {
    const out = pine('request.security(syminfo.tickerid, "D", close)')
    expect(out.ok).toBe(true)
    expect(out.outputs[out.selected].formula).toBe('close')
  })

  it('⭐ …while `timeframe.period` folds to the bar itself — the inconsistency', () => {
    // ⚰️ THE INCONSISTENCY THIS TEST NAMED IS RESOLVED (ruling 3.5, 2026-09-12): the
    // two spellings now agree, and they agree on the IDENTITY rather than on the
    // step-back. The test is kept because the agreement is the claim — if a future
    // change made `"D"` a resample again, this and the pair above would disagree.
    // ⚠️ THE TWO HALVES TOGETHER ARE THE ARGUMENT. If `"D"` were declared, these
    // two lines would mean the same thing on a daily chart and answer one bar
    // apart, with nothing refusing. Neither half alone says that.
    const out = pine('request.security(syminfo.tickerid, timeframe.period, close)')
    expect(out.ok).toBe(true)
    expect(out.outputs[out.selected].formula).toBe('close')
  })

  it('⭐ a HIGHER timeframe still works, so the refusal is about `D`, not about MTF', () => {
    const out = pine('request.security(syminfo.tickerid, "W", close)')
    expect(out.ok).toBe(true)
    expect(out.outputs[out.selected].formula).toBe("tf(close, 'W')")
  })
})
