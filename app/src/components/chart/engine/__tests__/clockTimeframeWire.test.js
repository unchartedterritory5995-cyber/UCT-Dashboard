// ─── THE TIMEFRAME WIRE — `computeFor(def, bars, inputs, ctx)` → `interpret`'s `opts` ──
//
// ⛔⛔ THIS FILE EXISTS BECAUSE THE WIRE SHIPPED WITH NOTHING HOLDING IT.
// Closed table v2 gave `interpret` an optional trailing `opts` ({tf}) and
// `nativeRegistry.astColumnsFor` was taught to pass `ctx.tf` through it. No test
// passed a `ctx.tf` through `computeFor` on an `ast` definition, so DROPPING the
// fourth argument — or the `{tf: …}` on the `interpret` call — kept every suite
// green. `lesson_built_tested_green_and_unreachable`, on the one wire in this
// lane whose failure is silent by construction.
//
// ⚠️ AND SILENT IS THE WHOLE PROBLEM. `interpret` fails the four timeframe
// booleans CLOSED — not-computable, never a guessed default — so a dropped `tf`
// is not a crash and not a wrong number. It is a member's "only on intraday"
// clause that never fires and a chart that simply draws nothing, which is the
// quietest failure this lane has.
//
// ⭐ IT DRIVES THE SHIPPED DOOR, NOT `interpret` DIRECTLY. `interpret`'s own
// `opts` handling is covered by `tests/test_ast_clock_parity.py` and the
// conformance corpus in both lanes; what is unproven without this file is the
// ADAPTER between `ctx` and that argument, which is the half that was missing.

import { describe, it, expect } from 'vitest'
import { computeFor } from '../nativeRegistry'
import { TABLE } from '../ast/parse'

/** 04:00 and 04:05 ET on 2025-10-30 — real instants, so the unit gate passes and
 *  the wall-clock columns are answerable. Two bars is enough: the timeframe is a
 *  property of the SERIES, not of a bar, so the column is flat by construction. */
const BARS = [
  { t: 1761811200, o: 1, h: 1, l: 1, c: 1, v: 1 },
  { t: 1761811500, o: 1, h: 1, l: 1, c: 1, v: 1 },
]

const defFor = (name) => ({
  id: 'clock-wire-probe',
  compute: { kind: 'ast', ast: { type: 'series', name } },
  plots: [{ key: 'v', style: 'line' }],
})

const col = (name, ctx) => Array.from(computeFor(defFor(name), BARS, {}, ctx).v)

/** The four entries that can only be answered from what the CALLER knows —
 *  derived from the manifest, never typed, so a fifth arrives covered. */
const TF_FLAGS = Object.keys(TABLE.clock).filter((n) => n.startsWith('is'))

describe('the timeframe reaches interpret through computeFor', () => {
  it('⭐ ctx.tf ANSWERS the timeframe booleans — one true, the rest false, per code', () => {
    expect(TF_FLAGS.sort()).toEqual(['isdaily', 'isintraday', 'ismonthly', 'isweekly'])
    // Each code makes exactly ONE flag true. A wire that passed a constant, or a
    // lane that mapped every non-intraday code to one flag, fails on the pair.
    for (const [tf, expected] of [
      ['5', 'isintraday'], ['60', 'isintraday'],
      ['D', 'isdaily'], ['W', 'isweekly'], ['M', 'ismonthly'],
    ]) {
      for (const flag of TF_FLAGS) {
        const want = flag === expected ? 1 : 0
        expect(col(flag, { sym: 'AAPL', tf }), `tf=${tf} ${flag}`).toEqual([want, want])
      }
    }
  })

  it('⛔ and it FAILS CLOSED when the ctx carries no tf — never a guessed default', () => {
    // A guessed 'D' makes `isdaily` a confident 1 on a five-minute chart, which is
    // a wrong answer wearing a right one's clothes. Every shape of "nobody said".
    for (const ctx of [{ sym: 'AAPL' }, {}, undefined]) {
      for (const flag of TF_FLAGS) {
        const got = col(flag, ctx)
        expect(got.every(Number.isNaN), `${flag} answered with no tf: ${got}`).toBe(true)
      }
    }
    // …and an unshipped CODE refuses the same way rather than being parsed for its
    // shape: `3` looks intraday and `2D` looks daily, and neither is a code this
    // platform ships.
    for (const tf of ['3', '2D', '1H', '']) {
      expect(col('isintraday', { sym: 'AAPL', tf }).every(Number.isNaN), `tf=${tf}`).toBe(true)
    }
  })

  it('⚠️ the WALL CLOCK is unaffected by the wire — it needs no timeframe', () => {
    // ⛔ THE OTHER HALF OF FAIL-CLOSED, and it is what stops "when in doubt,
    // refuse" from spreading. `hour` and `barindex` have everything they need in
    // the bars, so a `tf`-less ctx must not blank them — refusing a column that
    // is fully determined is as wrong as fabricating one that is not.
    expect(col('hour', { sym: 'AAPL' })).toEqual([4, 4])          // 04:00/04:05 ET
    expect(col('minute', { sym: 'AAPL' })).toEqual([0, 5])
    expect(col('barindex', undefined)).toEqual([0, 1])
    // …and they are the same values WITH a timeframe, so `tf` is not leaking into
    // maths that does not depend on it.
    expect(col('hour', { sym: 'AAPL', tf: 'D' })).toEqual([4, 4])
  })

  it('🔴 THE DELETE-DETECTOR: the answer must differ BETWEEN two ctx values', () => {
    // ⛔ WITHOUT THIS, every assertion above is satisfiable by a wire that ignores
    // `ctx` entirely and hardcodes one answer. Two different ctx objects, one
    // definition, one bar series — if the results are equal the argument is not
    // being read.
    const intraday = col('isintraday', { sym: 'AAPL', tf: '5' })
    const daily = col('isintraday', { sym: 'AAPL', tf: 'D' })
    expect(intraday).toEqual([1, 1])
    expect(daily).toEqual([0, 0])
    expect(intraday, 'computeFor returns the same column for two different timeframes')
      .not.toEqual(daily)
  })
})
