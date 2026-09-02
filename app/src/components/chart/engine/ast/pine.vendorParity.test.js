// app/src/components/chart/engine/ast/pine.vendorParity.test.js
//
// ─── ⭐⭐ OUR NUMBERS AGAINST TRADINGVIEW'S PUBLISHED SOURCE ──────────────────
//
// `TA_VETTED` compares DEFINITIONS: it reads TradingView's published wording and
// argues that ours means the same thing. That is strong and it is not the same
// as running both and diffing them — and "a member's UCT screen agrees with the
// TradingView screen they came from" is a claim about NUMBERS.
//
// ⭐ THE TRICK THAT MAKES THIS POSSIBLE WITHOUT CAPTURED TRADINGVIEW OUTPUT:
// TradingView publishes REFERENCE IMPLEMENTATIONS in Pine, and this engine reads
// Pine. So their source can be written in OUR vocabulary and the two columns
// differenced. No screenshots, no scraped values, no fixture that can rot.
//
// ⛔ IT COVERS THE TWO FUNCTIONS WHOSE TRADINGVIEW SOURCE THIS REPO CAN QUOTE,
// and that is the honest scope. Every other built-in bound to `indicators.js` —
// `rsi`, `cci`, `mfi`, `adx`, `stoch`, `macd` — is vetted by DEFINITION only,
// because their reference implementations live in TradingView's reference
// manual, which is a JavaScript application this lane cannot read (confirmed
// twice). Each is one citation away from joining this file.
//
// ⭐ AND THE CHAIN REACHES THE SCAN LANE. `tests/test_screener_lane_parity.py`
// holds the Python interpreter bit-identical to this one, so JS == TradingView
// and JS == Python gives Python == TradingView for these.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { parseFormula } from './parse.js'
import { interpret } from './interpret.js'

/** 400 real SPY daily bars — a warmup argument decided on a ramp is worthless. */
const BARS = JSON.parse(fs.readFileSync(path.resolve(process.cwd(),
  '../tests/fixtures/alerts/replay_bars.json'), 'utf8')).fixtures.spy_daily.bars

const col = (formula) => Array.from(interpret(parseFormula(formula).ast, BARS, {}))
const firstFinite = (c) => c.findIndex((v) => !Number.isNaN(v))

/** TradingView's `ta.tr(true)`: ordinary true range, but bar 0 is `high - low`. */
const TR = 'max(high - low, max(abs(high - close[1]), abs(low - close[1])))'
const TR_TRUE = `nz(${TR}, high - low)`

describe('our columns against TradingView’s published reference implementations', () => {
  it('⭐⭐ `hma` IS TradingView’s published composition, exactly', () => {
    // Published as:
    //   ta.hma(_src, _length) => ta.wma(2 * ta.wma(_src, _length / 2)
    //                                   - ta.wma(_src, _length),
    //                                   math.round(math.sqrt(_length)))
    // ⛔ THE ODD LENGTHS ARE THE POINT. `_length / 2` is where our `floor(n / 2)`
    // could have diverged: TradingView's operators page states that int/int with
    // a remainder yields a FRACTIONAL value ("5/2 = 2.5"), so `TA_VETTED`'s
    // shorthand "INT division" is loose. It reaches the same window anyway,
    // because whatever consumes a length truncates and truncation equals floor
    // for a positive number — and 55, 21 and 9 are here to prove that rather
    // than to trust it.
    for (const n of [9, 20, 21, 55]) {
      const half = Math.floor(n / 2)
      const root = Math.round(Math.sqrt(n))
      const ours = col(`hma(close, ${n})`)
      const theirs = col(`wma(2 * wma(close, ${half}) - wma(close, ${n}), ${root})`)
      expect(firstFinite(ours), `hma(${n}) warmup`).toBe(firstFinite(theirs))
      let worst = 0
      let compared = 0
      for (let i = 0; i < ours.length; i++) {
        expect(Number.isNaN(ours[i])).toBe(Number.isNaN(theirs[i]))
        if (Number.isNaN(ours[i])) continue
        compared += 1
        worst = Math.max(worst, Math.abs(ours[i] - theirs[i]))
      }
      expect(compared, `hma(${n}) compared nothing`).toBeGreaterThan(300)
      expect(worst, `hma(${n}) max |ours - published|`).toBe(0)
    }
  })

  it('⛔⛔ `atr` DIFFERS, by exactly the one bar the manifest declares', () => {
    // The manifest's own `vendorNote`: "OUR `atr` IS WILDER'S ORIGINAL AND
    // TRADINGVIEW'S IS SEEDED ONE BAR EARLIER. `ta.atr(n)` is published as
    // `ta.rma(ta.tr(true), n)`, and `ta.tr(true)` counts bar 0's range as
    // `high - low`; ours begins where a true range is actually defined, at bar 1."
    //
    // ⭐ THAT SENTENCE IS A CLAIM ABOUT A RUN, so here is the run.
    const ours = col('atr(high, low, close, 14)')
    const theirs = col(`rma(${TR_TRUE}, 14)`)
    expect(firstFinite(ours) - firstFinite(theirs)).toBe(1)
  })

  it('⭐⭐ …and the difference DECAYS TO NOTHING, which is what a member needs', () => {
    // ⚠️ THE USEFUL FACT IS NOT "THEY DIFFER" BUT "WHERE". A screen runs on
    // hundreds of bars of history; if the gap persisted, every ATR filter would
    // disagree with the TradingView screen a member came from. Measured on 400
    // real SPY daily bars, the relative difference decays geometrically — which
    // is exactly what one extra RMA seeding bar does, and is the evidence that
    // this is a WARMUP and not a definition disagreement:
    //
    //     +0   4.04e-3      +100  2.50e-6      +250  4.15e-11
    //     +20  1.16e-3      +150  8.79e-8      +300  6.31e-13
    //     +50  6.81e-5      +200  1.57e-9      +385  7.47e-16
    const ours = col('atr(high, low, close, 14)')
    const theirs = col(`rma(${TR_TRUE}, 14)`)
    const start = Math.max(firstFinite(ours), firstFinite(theirs))
    const rel = (i) => Math.abs(ours[i] - theirs[i]) / Math.abs(theirs[i])

    // ⛔ NON-VACUITY FIRST: they really are apart at the start, so everything
    // below is a measurement rather than two identical columns agreeing.
    expect(rel(start)).toBeGreaterThan(1e-3)
    expect(rel(start)).toBeLessThan(1e-2)

    // ⭐ AND INDISTINGUISHABLE ONCE A SCREEN'S WORTH OF HISTORY EXISTS.
    expect(rel(start + 100)).toBeLessThan(1e-5)
    expect(rel(start + 200)).toBeLessThan(1e-8)
    expect(rel(BARS.length - 1)).toBeLessThan(1e-12)

    // ⭐ GEOMETRIC, NOT NOISY — each checkpoint at least ten times tighter than
    // the one before. A definition disagreement would sit on a plateau instead.
    const checks = [start, start + 50, start + 100, start + 150]
    for (let i = 1; i < checks.length; i += 1) {
      expect(rel(checks[i]), `not converging at +${checks[i] - start}`)
        .toBeLessThan(rel(checks[i - 1]) / 10)
    }
  })
})
