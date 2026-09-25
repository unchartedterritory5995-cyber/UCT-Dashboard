// app/src/components/chart/engine/runtime/__tests__/seedWarmup.test.js
//
// ─── ⭐⭐ THE SEED, MEASURED AT THE VENDOR ──────────────────────────────────
//
// Every recurrence in this family — ema, rma, atr, and rsi/macd/stoch which are
// gated on them — CONVERGES. Two implementations seeded differently are
// identical to float noise after ~5n bars. That is why the 2026-09-21 1D
// capture could not settle any of this: a 1D SPY chart holds ~8,468 bars and
// exposes a 300-bar window, so it read bar_index 8168..8467, where every seed
// difference had long since decayed to zero.
//
// ⭐⭐ WHAT SETTLED IT WAS A TIMEFRAME, NOT A BIGGER CAPTURE. On 12M, SPY's
// ENTIRE series is 34 bars, so bar_index 0 is loaded and the seed is on screen.
// `tests/fixtures/vendor/seed-warmup-spy-12m-2026-09-21.json` is that capture,
// hash-verified on the way out of the browser.
//
// ⛔ THE FIXTURE'S OWN bar_index IS THE KEY, NEVER THE ROW NUMBER. The chart
// model's array index is a position in the LOADED WINDOW; Pine's `bar_index` is
// a position in the SERIES. On the 1D capture those differed by 8,168 — the
// probe plots `bar_index` precisely so "bar 0" cannot be assumed.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { computeATR } from '../../../indicators.js'

const FIX = JSON.parse(fs.readFileSync(
  path.resolve(process.cwd(), '../tests/fixtures/vendor/seed-warmup-spy-12m-2026-09-21.json'), 'utf8'))

const BARS = FIX.rows.map((r) => ({ t: r.date, o: r.o, h: r.h, l: r.l, c: r.c, v: 0 }))
const firstBarWith = (key) => FIX.rows.findIndex((r) => r[key] !== null)

describe('⛔ the fixture is the one this file was written against', () => {
  it('names its symbol, its timeframe and the bar range that makes it decisive', () => {
    expect(FIX._symbol).toBe('SPY')
    expect(FIX._tf).toBe('12M')
    // ⛔ THE LOAD-BEARING ONE. A capture that does not reach bar_index 0 cannot
    // answer a seed question at all, however many rows it has.
    expect(FIX._barIndexRange[0]).toBe(0)
    expect(FIX.rows[0].bar_index).toBe(0)
    expect(FIX.rows.length).toBeGreaterThan(30)
  })
})

describe('⭐⭐ TradingView seeds ema and rma with the SMA of the first n values', () => {
  it('⭐⭐ at bar 4 the vendor\'s ema5 and sma5 are EXACTLY equal', () => {
    const r = FIX.rows[4]
    expect(r.bar_index).toBe(4)
    expect(r.ema5).not.toBeNull()
    expect(r.ema5).toBe(r.sma5)
  })

  it('⛔ CONTROL — and at bar 5 they DIFFER, so bar 4 is the seed and not a flat series', () => {
    // Without this the equality above is satisfied by any series that happens
    // not to move, which would make the ruling an artifact of the symbol.
    const r = FIX.rows[5]
    expect(Math.abs(r.ema5 - r.sma5)).toBeGreaterThan(1)
  })

  it('⭐ and nothing in the family emits before bar n-1', () => {
    for (const key of ['ema5', 'sma5', 'atr5', 'rma_tr_true_5', 'sma_tr_true_5']) {
      expect(firstBarWith(key), `${key} first emission`).toBe(4)
    }
  })
})

describe('⭐⭐ `ta.atr(n)` IS `ta.rma(ta.tr(true), n)` AT THE VENDOR, seed included', () => {
  it('⭐⭐ the two vendor series are equal on every bar, from the first', () => {
    let compared = 0
    for (const r of FIX.rows) {
      if (r.atr5 === null) { expect(r.rma_tr_true_5).toBeNull(); continue }
      expect(r.rma_tr_true_5).not.toBeNull()
      expect(Math.abs(r.atr5 - r.rma_tr_true_5)).toBeLessThan(1e-9)
      compared += 1
    }
    expect(compared).toBeGreaterThan(25)
  })

  it('⛔ CONTROL — the SMA of the same true range is NOT that series', () => {
    // If it were, the identity above would be satisfied by any smoother and
    // would say nothing about Wilder's in particular.
    const r = FIX.rows[6]
    expect(Math.abs(r.atr5 - r.sma_tr_true_5)).toBeGreaterThan(1e-6)
  })
})

describe('⛔⛔ OUR ATR DOES NOT MATCH THIS — and the fix is an OWNER DECISION', () => {
  // ⭐⭐ THE DIAGNOSIS IS SETTLED. THE DECISION IS NOT. Those are two things
  // and this block keeps them apart on purpose.
  //
  // SETTLED, above, from the vendor: TradingView emits `ta.atr(n)` at bar n-1,
  // seeded as the mean of the first n true ranges where bar 0's true range is
  // `high - low`. Ours starts its loop at bar 1, so it emits at bar n with a
  // different seed. A one-line change to `computeATR` in `chart/indicators.js`
  // makes our column match the capture at delta 0 — measured 2026-09-21,
  // reverted deliberately, and NOT shipped.
  //
  // ⛔⛔ WHY IT WAS REVERTED, because the blast radius is the whole point:
  //   · `computeATR` is ONE implementation serving THREE languages — Pine's
  //     `ta.atr` (interpret.js), ThinkScript's `ATR` (thinkscript.test.js
  //     reconstructs the bar-1 seeding independently), and the native ATR +
  //     ATR-bands indicators members already use.
  //   · `tests/fixtures/indicators/atr_14.json` PINS the current seeding as a
  //     golden oracle at rel-tol 1e-9, in BOTH the JS and Python lanes, and its
  //     own note states the seed "lands on bars[14]".
  //   · the Python side feeds the pattern engine's detectors and the scanner's
  //     ATR-derived levels — numbers the firm trades on.
  //   · and `pine.vendorParity.test.js` already MEASURED this gap and recorded
  //     it as a deliberate choice, citing the manifest's own `vendorNote`:
  //     "ours begins where a true range is actually defined, at bar 1."
  //
  // ⭐ So this is not an unfixed bug, it is a RULING that is owed: match the
  // vendor everywhere (and reseed the golden fixtures across two languages), or
  // keep Wilder's original outside Pine and give Pine its own seeding. Either
  // is defensible; picking one silently is not.
  it.fails('⛔ KNOWN GAP — our ATR does not match the vendor at the seed', () => {
    const ours = computeATR(BARS, 5)
    for (let i = 0; i < FIX.rows.length; i += 1) {
      const vendor = FIX.rows[i].atr5
      if (vendor === null) continue
      const mine = ours[i] ? ours[i].value : NaN
      expect(Number.isFinite(mine)).toBe(true)
      expect(Math.abs(vendor - mine)).toBeLessThan(1e-9)
    }
  })

  it('⛔ the gap is MEASURED, not merely expected — and it is exactly one bar', () => {
    // ⛔ NON-VACUITY FOR THE MARKER ABOVE. `it.fails` is satisfied by ANY
    // throw, so on its own it would report "still broken" for a test that never
    // computed anything. This states the gap positively, in the one form that
    // pins WHICH way it is wrong: we start one bar LATE.
    const ours = computeATR(BARS, 5)
    const oursFirst = ours.findIndex((p) => p && Number.isFinite(p.value))
    const vendorFirst = firstBarWith('atr5')
    expect(vendorFirst).toBe(4)
    expect(oursFirst - vendorFirst).toBe(1)
  })
})
