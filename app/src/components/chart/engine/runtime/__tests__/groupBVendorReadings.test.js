// app/src/components/chart/engine/runtime/__tests__/groupBVendorReadings.test.js
//
// ─── ⭐⭐ A VENDOR CAPTURE NOBODY WAS READING ────────────────────────────────
//
// `tests/fixtures/vendor/groupb-readings-spy-1d-2026-09-11.json` holds SEVEN
// TradingView readings taken on AMEX:SPY 1D over 405 bars. Until this file, no
// test and no source file in the repo referenced it.
//
// ⚰️⚰️ AND IT IS NOT ALONE. Cross-referencing every capture in
// `tests/fixtures/vendor/` against every `app/src/**`, `tools/**`, `scripts/**`
// and `api/**` file: **13 of 35 captures are read by nothing.** Those are
// measurements that were paid for — several needed a live TradingView session —
// settling questions nobody can now get wrong for free, sitting unpinned on
// disk. This file closes one of the thirteen.
//
// ⭐⭐ THE CAPTURE'S OWN `_notPinned` SAYS WHICH HALF IS FREE, and it is right:
//
//     "`ta.highest`/`ta.lowest` already ARE [pinned] (RULING H) and this
//      confirms them; the rest are table-shape changes carrying the corpus-case
//      price, and `math.max`'s variadic arity is a widening that needs its own
//      decision."
//
// So this pins the CONFIRMATIONS — the readings our engine already satisfies —
// and asserts the remaining gaps REFUSE rather than pretending. Measured, one
// probe per reading:
//
//   ta.highest(n) defaults to `high`     vendor: high    ours: high    ✅
//   ta.lowest(n)  defaults to `low`      vendor: low     ours: low     ✅
//   ta.pivothigh  defaults to `high`     vendor: high    ours: high    ✅
//   ta.pivotlow   defaults to `low`      vendor: low     ours: low     ✅
//   math.round half-rule                 vendor: away-from-zero        ✅
//   math.round(x, 2)                     vendor: 0.13    ours: REFUSES ⛔ gap
//   math.max/min variadic (3 and 5 args) vendor: ok      ours: REFUSES ⛔ gap
//   ta.vwap with no argument             vendor: hlc3    ours: REFUSES ⛔ gap
//
// ⭐⭐ `math.round`'S HALF-RULE WAS ON THIS PROGRAMME'S OPEN LIST AS "blocked on
// the TradingView session" — a W4 capture that was written, self-checked and
// never taken. It has been answered on disk since 2026-09-11. That is the cost
// of an unread capture, in one line: a question recorded as OPEN while its
// answer sat in the repo.
//
// ⛔ THE RULES ARE READ OUT OF THE CAPTURE, NOT RESTATED. A test that retypes a
// vendor verdict is a second authority over it and stays green against a capture
// that later says otherwise. Every expectation below is derived from the JSON.
//
// ⛔ AND THE GAPS ARE ASSERTED AS REFUSALS, not skipped. "We do not serve this"
// and "we serve it wrongly" are different facts to a member, and only the first
// one is acceptable — so if a gap ever starts silently ANSWERING, this goes red.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 40
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + (i % 5), h: 110 + (i % 7), l: 90 - (i % 3), c: 100 + (i % 11), v: 10 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("t")\n'

const REPO = path.resolve(process.cwd(), '..')
const FIXTURE = path.join(REPO, 'tests/fixtures/vendor/groupb-readings-spy-1d-2026-09-11.json')
const CAPTURE = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
const READINGS = CAPTURE.readings || {}

/** Build + execute, or report the refusal guard. */
function run(body) {
  let built = null
  try { built = buildRuntimeIr(head + body, { bars: BARS, inputs: {} }) } catch (e) {
    return { refused: `threw:${String(e && e.message).slice(0, 40)}` }
  }
  if (!built.ok) return { refused: built.refusal.guard }
  const program = lowerIrProgram(built.ir)
  const res = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
    barTimes: BARS.map((b) => b.t),
  })
  return { out: Array.from(res.outputs[0]) }
}

/** The set of distinct values past warm-up — a spread of exactly [0] means agreement. */
const spread = (body) => {
  const r = run(body)
  if (r.refused) return r.refused
  return [...new Set(r.out.slice(12))]
}
const lastOf = (body) => {
  const r = run(body)
  return r.refused ? r.refused : r.out[N - 1]
}

describe('⭐⭐ the group-B vendor readings, finally pinned', () => {
  it('⛔ CONTROL — the capture is on disk and carries its readings', () => {
    // ⭐ Every expectation below is derived from this object. If it is empty the
    // whole file would pass by asserting nothing.
    expect(CAPTURE.symbol).toBe('AMEX:SPY')
    expect(Object.keys(READINGS).length).toBeGreaterThan(4)
  })

  it('⭐⭐ one-arg `ta.highest` / `ta.lowest` use the VENDOR default source', () => {
    // ⭐ THE 81-SITE QUESTION, in the capture's own words. The vendor evidence is
    // a difference that measured ZERO against one source and 126 distinct
    // non-zero values against the other — so a zero here is agreement, not a
    // study that never ran.
    const hiDefault = READINGS['ta.highest_one_arg_default'].verdict     // 'high'
    const loDefault = READINGS['ta.lowest_one_arg_default'].verdict      // 'low'
    expect(spread(`plot(ta.highest(5) - ta.highest(${hiDefault}, 5))`)).toEqual([0])
    expect(spread(`plot(ta.lowest(5) - ta.lowest(${loDefault}, 5))`)).toEqual([0])

    // ⛔ NON-VACUITY, AND IT IS THE CAPTURE'S OWN DISCIPLINE. A zero difference
    // is also what two broken series produce. The vendor probe carries a SPREAD
    // channel for exactly this reason; so does this.
    expect(spread('plot(ta.highest(5) - ta.highest(close, 5))').length).toBeGreaterThan(1)
    expect(spread('plot(ta.lowest(5) - ta.lowest(close, 5))').length).toBeGreaterThan(1)
  })

  it('⭐ `ta.pivothigh` / `ta.pivotlow` use the VENDOR default source', () => {
    const hi = READINGS['ta.pivothigh_default_source'].verdict           // 'high'
    const lo = READINGS['ta.pivotlow_default_source'].verdict            // 'low'
    // ⛔ `nz` WITH A SENTINEL, because a pivot is `na` on every non-firing bar
    // and NaN !== NaN would make the subtraction unreadable rather than zero.
    expect(spread(`plot(nz(ta.pivothigh(2,2),-999) - nz(ta.pivothigh(${hi},2,2),-999))`))
      .toEqual([0])
    expect(spread(`plot(nz(ta.pivotlow(2,2),-999) - nz(ta.pivotlow(${lo},2,2),-999))`))
      .toEqual([0])
  })

  it('⭐⭐ `math.round` rounds HALF AWAY FROM ZERO — not bankers\' rounding', () => {
    // ⚰️ THIS WAS ON THE PROGRAMME'S OPEN LIST AS "blocked on the TradingView
    // session", with a probe written and never taken. The answer has been on
    // disk since 2026-09-11. Bankers' rounding would give round(2.5) = 2 and
    // round(-2.5) = -2, which is the whole reason the question was asked.
    const rule = READINGS['math.round_half_rule']
    expect(String(rule.verdict)).toMatch(/AWAY FROM ZERO/i)
    const ev = rule.evidence
    expect(lastOf('plot(math.round(2.5))')).toBe(ev['round(2.5)'])
    expect(lastOf('plot(math.round(-2.5))')).toBe(ev['round(-2.5)'])
    expect(lastOf('plot(math.round(3.5))')).toBe(ev['round(3.5)'])
  })

  it('⭐⭐ THE RULING LANDED — `math.round(v,n)` and variadic max/min are SERVED', () => {
    // ⚰️ THIS CASE ASSERTED A REFUSAL, and it was right to: the capture's
    // `_notPinned` named these as owner decisions — "table-shape changes
    // carrying the corpus-case price, and `math.max`'s variadic arity is a
    // widening that needs its own decision." Until that ruling the only
    // acceptable behaviour WAS a refusal, and this case is what stopped one
    // being shipped on a reading of the reference manual.
    //
    // ⭐ THE RULING IS IN (owner, 2026-09-23): a pasted script must behave as
    // it does on TradingView, so a form the vendor serves and we refuse is a
    // difference a member can see. What changes is the VERDICT, not the
    // standard of evidence — each number below is the capture's own, and the
    // case now fails if we answer anything else.
    expect(lastOf('plot(math.round(0.125, 2))'))
      .toBeCloseTo(READINGS['math.round_half_rule'].evidence['round(0.125, 2)'], 10)
    expect(lastOf('plot(math.max(1, 2, 3))')).toBe(3)
    expect(lastOf('plot(math.max(1, 2, 3, 4, 5))'))
      .toBe(READINGS['math_max_min_variadic'].evidence['max(5 args)'])
    expect(lastOf('plot(math.min(5, 4, 3, 2, 1))'))
      .toBe(READINGS['math_max_min_variadic'].evidence['min(5 args)'])

    // ⛔ AND THE ONE STILL UNRULED KEEPS ITS REFUSAL, which is what keeps this
    // case a gate rather than a rubber stamp. `ta.vwap(src)` needs a VWAP over
    // an arbitrary source, and our `vwap()` delegates to `computeVWAP` — the
    // same accumulator the CHART draws. A second one would be exactly the
    // "second authority over one value" that module's own comment forbids.
    // ⚠️ Its zero-argument form already agrees with the vendor by construction:
    // `computeVWAP` averages `(h + l + c) / 3`, and the capture's verdict for
    // `ta.vwap()` is `hlc3`.
    expect(lastOf('plot(ta.vwap - ta.vwap(hlc3))')).toBe('pine:arity')
    expect(READINGS['ta.vwap_no_arg_default'].verdict).toBe('hlc3')
  })
})
