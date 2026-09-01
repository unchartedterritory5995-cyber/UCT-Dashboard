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

  it('⛔ so `request.security(_, "D", _)` refuses, and names the ladder', () => {
    const out = pine('request.security(syminfo.tickerid, "D", close)')
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:request')
  })

  it('⭐ …while `timeframe.period` folds to the bar itself — the inconsistency', () => {
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
