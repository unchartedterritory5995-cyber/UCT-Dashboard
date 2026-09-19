// ─── THE BAR-CLOSE WIRE — `computeFor(def, bars, inputs, ctx)` → `interpret`'s `opts` ──
//
// ⛔⛔ THE SIBLING OF `clockTimeframeWire.test.js`, AND IT EXISTS FOR THE SAME
// REASON. `interpret` has read `opts.newestBarIsForming` since the barstate
// ruling landed and `computeClock` has been a tri-state just as long — but until
// 2026-09-10 NOTHING IN `app/src` EVER SET IT. The four CLOCK_REALTIME columns
// rendered blank in every browser: not wrong, blank, by the fail-closed contract.
// The producer is now `/api/bars` (Python's `bar_close_state`, the side the NYSE
// calendar lives on) and the wire is
// `StockChart ctx → binder → computeFor → interpret opts`.
//
// ⚠️ AND SILENT IS THE WHOLE PROBLEM, EXACTLY AS IT WAS FOR `tf`. Dropping the
// value is not a crash and not a wrong number — the columns simply fail closed
// and a member's `barstate.isconfirmed` clause never fires. Delete the
// `newestBarIsForming` from either adapter and every other suite stays green.
// `lesson_built_tested_green_and_unreachable`, on the second wire in this lane
// whose failure is invisible by construction.
//
// ⭐ IT DRIVES THE SHIPPED DOOR, NOT `computeClock` DIRECTLY. `computeClock`'s own
// tri-state behaviour is pinned by `clock_parity.json` in both lanes; what is
// unproven without this file is the ADAPTER, which is the half that was missing.

import { describe, it, expect } from 'vitest'
import { computeFor } from '../nativeRegistry'

/** 04:00 and 04:05 ET on 2025-10-30 — real instants, so the unit gate passes.
 *  Same series as the timeframe wire's, deliberately: two probes of one adapter
 *  should differ in what they ask, not in what they ask it about. */
const BARS = [
  { t: 1761811200, o: 1, h: 1, l: 1, c: 1, v: 1 },
  { t: 1761811500, o: 1, h: 1, l: 1, c: 1, v: 1 },
]

/** ⭐ THE FOUR THE TRI-STATE MOVES. The extent pair (`islast`, `isfirst`) is
 *  deliberately NOT here: it reads only the fetch's shape and answers under every
 *  value of the tri-state, which is the CLOCK_EXTENT / CLOCK_REALTIME split. */
const REALTIME = ['isrealtime', 'isconfirmed', 'ishistory', 'islastconfirmedhistory']

const defFor = (name) => ({
  id: 'bar-close-wire-probe',
  compute: { kind: 'ast', ast: { type: 'series', name } },
  plots: [{ key: 'v', style: 'line' }],
})

const col = (name, ctx) => Array.from(computeFor(defFor(name), BARS, {}, ctx).v)
const newest = (name, ctx) => col(name, ctx)[BARS.length - 1]

describe('⛔ the bar-close tri-state reaches interpret through computeFor', () => {
  it('⭐ NON-VACUITY FIRST — the probe can read a column at all', () => {
    // `islast` is CLOCK_EXTENT: it answers with no tri-state whatsoever. If this
    // is blank the harness is broken and every assertion below is meaningless.
    expect(newest('islast', { tf: 'D' }), 'the extent pair went blank — this '
      + 'probe is not reading columns, so nothing below means anything')
      .not.toBeNaN()
  })

  for (const name of REALTIME) {
    it(`⛔ ${name} is BLANK when the ctx carries no tri-state`, () => {
      // The pre-2026-09-10 state of every browser, and the state a server that
      // has not shipped the field yet still produces.
      expect(newest(name, { tf: 'D' }), `${name} answered without a tri-state — `
        + 'something is defaulting, and a default here is a confident answer '
        + 'about whether the newest bar is settled').toBeNaN()
    })

    it(`⛔ ${name} is BLANK when the ctx says null — UNKNOWN is not false`, () => {
      expect(newest(name, { tf: 'D', newestBarIsForming: null }), `${name} `
        + 'answered on an explicit null. `null` means NOBODY TOLD ME; `false` '
        + 'means SETTLED. Collapsing the two hands the column layer a confident '
        + '`isconfirmed = 1` on a bar that may still be open.').toBeNaN()
    })

    it(`⭐⭐ ${name} ANSWERS, and answers DIFFERENTLY, for true vs false`, () => {
      const t = newest(name, { tf: 'D', newestBarIsForming: true })
      const f = newest(name, { tf: 'D', newestBarIsForming: false })
      expect(t, `${name} stayed blank with a tri-state of true — the wire is cut`)
        .not.toBeNaN()
      expect(f, `${name} stayed blank with a tri-state of false — the wire is cut`)
        .not.toBeNaN()
      // ⛔ THIS IS THE DISCRIMINATOR. Without it the file passes for an adapter
      // that hard-codes one answer: all four of these columns are defined as
      // opposites across the forming boundary, so t === f means the value was
      // received and then ignored.
      expect(t, `${name} gave the SAME answer for a forming and a settled bar `
        + `(${t}) — the tri-state is arriving and being discarded`).not.toBe(f)
    })
  }

  it('⭐ the EXTENT pair is unmoved by the tri-state — the split is real', () => {
    // CLOCK_EXTENT reads the fetch's shape and nothing else. If these moved, the
    // grouping that the whole barstate ruling rests on would be wrong.
    for (const name of ['islast', 'isfirst']) {
      const a = col(name, { tf: 'D', newestBarIsForming: true })
      const b = col(name, { tf: 'D', newestBarIsForming: false })
      const c = col(name, { tf: 'D' })
      expect(a, `${name} moved with the tri-state — it is CLOCK_EXTENT and must `
        + 'read only the fetch shape').toEqual(b)
      expect(a, `${name} blanked without a tri-state — extent can never blank`)
        .toEqual(c)
    }
  })
})
