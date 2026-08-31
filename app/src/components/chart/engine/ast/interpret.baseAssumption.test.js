// app/src/components/chart/engine/ast/interpret.baseAssumption.test.js
//
// ─── ⛔⛔ `maxLookback` ASSUMES A DAILY BASE, AND NOTHING SAID SO ────────────
//
// `TF_BASE_BARS = {W: 5, M: 21}` is TRADING DAYS, and its own comment warned that
// "too SMALL is the dangerous direction — it would let a tree claim it needs fewer
// bars than it reads". It never said the numbers are only right when one bar is
// one DAY. On an intraday chart they are too small by a whole session.
//
// ⭐ THIS FILE DOES NOT FIX THAT. It PINS it, with the measurement, for three
// reasons:
//
//   1. It cannot silently get worse while the decision is outstanding.
//   2. The next reader gets the numbers instead of the hypothesis. A gap recorded
//      as prose is a gap somebody re-derives from scratch or, worse, disbelieves.
//   3. The direction of the failure is recorded too — a BLANK column, never a
//      wrong number — because those call for different urgency and the difference
//      is the first thing an owner will ask.
//
// ⛔ WHY IT IS NOT AN ARITHMETIC FIX. `interpret` knows the base (`opts.tf`) and
// uses it to refuse a down-read. `maxLookback` runs at SAVE and BUDGET time, where
// there is no chart — and a definition is PERSISTED and recomputed later, so a
// base folded in at save time would be replayed against a different one. The base
// is knowable only at compute time, which is not where `maxLookback` is called.
// Closing this is a decision about the BUDGET CAP, not a patch.

import { describe, it, expect } from 'vitest'

import { parseFormula } from './parse.js'
import { maxLookback, interpret, TF_BASE_BARS } from './interpret.js'

/** `days` sessions of `perDay` bars, stamped as unix seconds like real intraday. */
const bars = (days, perDay, stepSec) => {
  const out = []
  let t = Date.UTC(2026, 0, 5, 14, 30, 0) / 1000        // a Monday, 09:30 ET
  for (let d = 0; d < days; d += 1) {
    for (let i = 0; i < perDay; i += 1) {
      out.push({ t: t + i * stepSec, o: 100, h: 101, l: 99, c: 100 + (i % 7), v: 1000 })
    }
    t += 86400
  }
  return out
}
const finite = (col) => Array.from(col).filter((v) => Number.isFinite(v)).length

const AST = () => parseFormula("tf(sma(close, 4), 'W')").ast

describe('the daily-base assumption in TF_BASE_BARS', () => {
  it('⛔ the span table is TRADING DAYS, so a week is five of them', () => {
    // The premise, stated once so the arithmetic below is readable.
    expect(TF_BASE_BARS).toEqual({ W: 5, M: 21 })
  })

  it('⛔⛔ `maxLookback` answers the SAME number at every base, because it has none', () => {
    // ⭐ THE SHAPE OF THE DEFECT IN ONE ASSERTION: the function takes no base and
    // cannot take one, so its answer is a constant where the truth is not.
    expect(maxLookback(AST())).toBe(25)
    expect(maxLookback.length).toBe(1)          // (ast) — no options parameter
  })

  it('⛔⛔ …and a week is 78x that on five-minute bars, 390x on one-minute', () => {
    // ⚠️ MEASURED, and pinned so it cannot drift. `(child + 1) * bars-per-week` is
    // what the tree genuinely reaches back through at each base.
    const claim = maxLookback(AST())
    const perWeek = { D: 5, 60: 35, 15: 130, 5: 390, 1: 1950 }
    const need = (bpw) => (4 + 1) * bpw
    expect(need(perWeek.D) / claim).toBe(1)
    expect(need(perWeek[60]) / claim).toBe(7)
    expect(need(perWeek[5]) / claim).toBe(78)
    expect(need(perWeek[1]) / claim).toBe(390)
  })

  it('⛔⛔ handed exactly what it asks for, the column is EMPTY — the live "too small"', () => {
    // ⚰️ `TF_BASE_BARS`'s own comment calls too-small "the dangerous direction".
    // This is that direction, happening.
    const claim = maxLookback(AST())
    const short = bars(1, 78, 300).slice(0, claim)
    expect(short.length).toBe(claim)
    expect(finite(interpret(AST(), short, {}, undefined, undefined, { tf: '5' }))).toBe(0)
  })

  it('⭐ …and it is a BLANK column, never a wrong number — given enough bars it is right', () => {
    // ⛔ THE DISTINCTION THAT SETS THE URGENCY, and the reason this ships as a pin
    // rather than as a refusal: the chart hands over every bar it holds regardless
    // of the claim, so a tree that FITS still computes correctly. Refusing these
    // at the save door would remove working charts to fix a number nobody reads.
    const plenty = bars(45, 78, 300)
    expect(finite(interpret(AST(), plenty, {}, undefined, undefined, { tf: '5' })))
      .toBeGreaterThan(1000)
  })

  it('⛔⛔ …and `tf` IS NOT SPECIAL — an ordinary window behaves identically', () => {
    // ⭐⭐ THE LOAD-BEARING ASSERTION OF THE 2026-08-30 RULING. The decision not to
    // make `maxLookback` base-aware rests on this equivalence: a blank column is
    // already this engine's deliberate outcome for ANY under-warmed indicator, so
    // the `tf` under-claim produces the outcome the product already has rather
    // than a new one. `pool.js`'s pane-existence test (trap #4) drops a series
    // whose column holds no finite value, and it does not ask why it is empty.
    //
    // ⛔ IF THIS EVER FAILS, THE RULING IS VOID. That is the point of asserting an
    // equivalence rather than restating the argument in prose: the reasoning has a
    // failure mode, and this is it.
    const short = bars(1, 78, 300).slice(0, 40)
    const plainAst = parseFormula('sma(close, 500)').ast
    expect(maxLookback(plainAst)).toBe(500)
    expect(finite(interpret(plainAst, short, {}, undefined, undefined, { tf: '5' }))).toBe(0)
    // …the same nothing the higher-timeframe tree produces on the same bars.
    expect(finite(interpret(AST(), short, {}, undefined, undefined, { tf: '5' }))).toBe(0)
  })

  it('⭐⭐ ON A DAILY BASE THE ASSUMPTION HOLDS, which is why the scan lane is unaffected', () => {
    // ⛔ THE NON-VACUITY HALF. Without this the file would read as "the span table
    // is simply wrong"; it is exactly right where it is used in anger. The scan
    // lane runs `DEFAULT_TF = 'D'`, so every sweep is inside the assumption.
    const daily = bars(200, 1, 86400)
    const col = interpret(AST(), daily, {}, undefined, undefined, { tf: 'D' })
    expect(finite(col)).toBeGreaterThan(150)
    expect(maxLookback(AST())).toBe(25)
  })
})
