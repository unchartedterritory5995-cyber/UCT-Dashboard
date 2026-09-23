// app/src/components/chart/engine/runtime/__tests__/fvgVendorParity.test.js
//
// ─── ⭐⭐ THE FIRST PUBLISHED INDICATOR MEASURED AGAINST TRADINGVIEW ────────
//
// `tests/fixtures/vendor/visual/fvg-boxes-spy-1d-2026-09-22.json` is every box
// TradingView itself draws for `makuchaku's Trade Tools - Fair Value Gaps` on
// AMEX:SPY 1D, read out of the chart's own `graphics().dwgboxes()` primitive
// records. Not a screenshot, not our recomputation — the vendor's own numbers.
//
// ⚰️⚰️ AND IT EXISTS BECAUSE A RENDER OF OUR OWN OUTPUT PROVED NOTHING. This
// programme published a page showing six indicators drawn from the objects this
// engine emitted, and called it proof of concept. It is not: a drawing of our
// own answer establishes that we drew SOMETHING, never that we drew what
// TradingView draws — which is the entire goal. The owner said so, and this
// file is what that correction is worth.
//
// ─── WHAT MATCHED ──────────────────────────────────────────────────────────
//
// Over the comparable window (2026-04-06, TradingView's oldest surviving box,
// to 2026-09-11, our last bar): **47 of 47 boxes land on the same bar.** No
// box we draw is absent there, and none of theirs is missing from ours.
//
// ⭐ AND THE FIELD SELECTION IS EXACT. Nine boxes differ numerically and every
// one traces to the BAR FIXTURE, not the engine: `spy-1d-bars-3000` carries
// two-decimal prices where TradingView carries four (712.3 against 712.295),
// and **zero** of its 3,000 bars have more than two decimals. Same bar, same
// OHLC field, rounder input.
//
// ⛔ THAT DISTINCTION IS THE WHOLE VALUE OF THE CAPTURE, and it is the one a
// screenshot comparison could never make. "Nine boxes disagree" reads as an
// engine defect; "our input data is rounded" is a different fact with a
// different fix, and only the vendor's own numbers can tell them apart.
//
// ─── WHAT DID NOT MATCH — two real defects, asserted as OPEN ───────────────
//
// 1. ⛔⛔ `max_boxes_count` — TradingView kept 50 boxes and DELETED the rest.
//    The script declares no limit, so Pine's default applies and the oldest
//    box is removed as each new one is drawn. This engine emitted 212 over 600
//    bars with no cap at all, so on a long history we draw boxes the vendor has
//    already taken off the chart. Pinned below as a KNOWN DIVERGENCE.
//
// 2. ⛔⛔ The forward edge advances TRADING SESSIONS, not calendar days.
//    `right = bar_index + 3` past the last loaded bar put two of our boxes on a
//    Saturday and a Sunday; TradingView put them on the following Monday and
//    Tuesday. Our `makeBarClock` extrapolates by median bar spacing, which does
//    not know about weekends.
//
// ⛔ BOTH ARE ASSERTED AS THEY ARE, NOT SKIPPED. A test that quietly excluded
// them would make this file report perfect parity for an engine that has two
// measured divergences — and the next reader would have no way to find them.
// When either is fixed, the assertion below fails and says so by name.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildObjectLane, runObjectLane } from '../objectLane.js'
import { toRenderState } from '../../objectRenderState.js'

const REPO = path.resolve(process.cwd(), '..')
const V = JSON.parse(fs.readFileSync(
  path.join(REPO, 'tests/fixtures/vendor/visual/fvg-boxes-spy-1d-2026-09-22.json'), 'utf8'))
const SRC = fs.readFileSync(
  path.join(REPO, 'corpus/committed/makuchaku039s-trade-tools-fair-value-gaps__b951deedc8.pine'), 'utf8')

const N = 600
const FIX = JSON.parse(fs.readFileSync(
  path.join(REPO, 'tests/fixtures/vendor/spy-1d-bars-3000-2026-09-13.json'), 'utf8'))
const RAW = FIX.bars.slice(-N)
const BARS = RAW.map((b) => ({
  t: Math.floor(Date.parse(`${b.t}T00:00:00Z`) / 1000),
  o: b.o, h: b.h, l: b.l, c: b.c, v: b.v,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))

const dateOf = (unixSeconds) => new Date(unixSeconds * 1000).toISOString().slice(0, 10)

/** Our engine's boxes, in the vendor's own vocabulary: left date -> the record. */
function ourBoxes() {
  const lane = buildObjectLane(SRC, { tf: 'D', newestBarIsForming: false, bars: BARS })
  expect(lane.ok, lane.ok ? '' : `refused ${(lane.refusal || {}).guard}`).toBe(true)
  const run = runObjectLane(lane, {
    bars: N, series: SERIES, confirmed: true, readTime: (i) => BARS[i].t,
  })
  const st = toRenderState(run.live || [], { bars: BARS })
  const by = new Map()
  for (const b of st.boxes || []) {
    by.set(dateOf(b.left), { right: dateOf(b.right), top: b.top, bottom: b.bottom })
  }
  return { by, emitted: (run.live || []).length }
}

/* The window both engines can speak about.
   LO: the vendor's oldest SURVIVING box — everything before it was deleted by
       the default cap, so its absence from their side says nothing about ours.
   HI: ⛔ NOT our last bar. A box is anchored at `bar_index - 2` and is CREATED
       on the bar two sessions LATER, so a box whose left edge is our final bar
       needs bars we do not have. Our series ends 2026-09-11; the last left-edge
       we could possibly produce is two sessions earlier.
       ⚰️ Set to the last bar at first, this case failed reporting a box
       "TradingView drew that we did not" — which reads as a MISS and is a
       window artifact. Getting the bound wrong here manufactures exactly the
       kind of false defect this file exists to rule out. */
const LO = V.boxes[0][0]
const HI = '2026-09-09'
const inWindow = (d) => d >= LO && d <= HI

describe('⭐⭐ Fair Value Gaps, against TradingView\'s own boxes', () => {
  it('⛔ CONTROL — the capture is real, and its receipt is on it', () => {
    // ⭐ A fixture that lost its boxes would make every comparison below pass
    // over an empty set.
    expect(V.symbol).toBe('AMEX:SPY')
    expect(V.boxes.length).toBe(V.boxCount)
    expect(V.boxes.length).toBeGreaterThan(40)
    expect(V._receipt.fnv1a).toBe('1ea3f03d')
    for (const b of V.boxes) {
      expect(b.length, 'a box record changed shape').toBe(6)
      expect(typeof b[2]).toBe('number')
      expect(typeof b[3]).toBe('number')
    }
  })

  it('⭐⭐ EVERY box lands on the SAME BAR — no extra, none missing', () => {
    // ⭐⭐ THE LOAD-BEARING RESULT. A gap detector that fires on the wrong bar,
    // or fires twice, is wrong in a way no price comparison would reveal.
    const { by } = ourBoxes()
    const ourDates = [...by.keys()].filter(inWindow).sort()
    const tvDates = V.boxes.map((b) => b[0]).filter(inWindow).sort()

    const missing = tvDates.filter((d) => !by.has(d))
    const extra = ourDates.filter((d) => !tvDates.includes(d))
    expect(missing, `TradingView drew a box we did not: ${missing.join(', ')}`).toEqual([])
    expect(extra, `we drew a box TradingView did not: ${extra.join(', ')}`).toEqual([])
    expect(ourDates.length, 'the comparison ran over nothing').toBeGreaterThan(40)
  })

  it('⭐⭐ top and bottom agree to the VENDOR\'S precision, bar for bar', () => {
    // ⛔ COMPARED AT THE BAR FIXTURE'S OWN PRECISION, AND THE REASON IS STATED.
    // Our bars carry 2 decimals and TradingView's carry 4, so an exact equality
    // would fail on nine boxes for a difference that is in the INPUT, not the
    // engine. Rounding the vendor to our precision asks the question this test
    // is actually for: did we pick the same bar and the same field?
    const { by } = ourBoxes()
    const r2 = (v) => Math.round(v * 100) / 100
    const wrong = []
    for (const [leftDate, , top, bottom] of V.boxes) {
      if (!inWindow(leftDate)) continue
      const o = by.get(leftDate)
      if (!o) continue
      if (r2(o.top) !== r2(top) || r2(o.bottom) !== r2(bottom)) {
        wrong.push(`${leftDate}: ours(${o.top}, ${o.bottom}) vs tv(${top}, ${bottom})`)
      }
    }
    expect(wrong, `field selection diverged:\n  ${wrong.join('\n  ')}`).toEqual([])
  })

  it('⛔ CONTROL — that rounding cannot hide a REAL price error', () => {
    // ⚰️ THE WAY THE TEST ABOVE COULD BE TOO KIND. Rounding to 2dp forgives a
    // sub-cent difference; it must not forgive a wrong bar's price. The vendor's
    // own numbers differ from ours by at most half a cent, and a real field
    // mix-up on this instrument moves the price by dollars.
    const { by } = ourBoxes()
    let worst = 0
    for (const [leftDate, , top, bottom] of V.boxes) {
      if (!inWindow(leftDate)) continue
      const o = by.get(leftDate)
      if (!o) continue
      worst = Math.max(worst, Math.abs(o.top - top), Math.abs(o.bottom - bottom))
    }
    // ⛔ THE BOUND IS DERIVED, NOT TYPED. Our bar fixture stores 2 decimals, so
    // the largest error rounding alone can introduce is half that quantum —
    // 0.005. A typed tolerance (0.01 was the first draft) is a number someone
    // can loosen without anything noticing; this one cannot move without the
    // claim about the fixture moving with it.
    // ⛔⛔ THE QUANTUM IS MEASURED OFF THE FIXTURE, NOT TYPED. A constant here
    // is a number anyone can loosen and nothing notices — the first draft used
    // a typed 0.01 and a mutation that widened it to 0.1 passed, which is a
    // tolerance with no guard on it (`lesson_gate_that_cannot_fail`). Reading
    // the decimal places out of the bars ties the bound to the claim it rests
    // on: if the fixture ever carries finer prices, this moves by itself.
    let places = 0
    for (const b of FIX.bars) {
      for (const k of ['o', 'h', 'l', 'c']) {
        const s = String(b[k]); const i = s.indexOf('.')
        if (i >= 0) places = Math.max(places, s.length - i - 1)
      }
    }
    expect(places, 'the bar fixture carries no decimals at all — the claim is broken')
      .toBeGreaterThan(0)
    const QUANTUM = 10 ** -places
    const MAX_ROUNDING = QUANTUM / 2
    expect(worst, `difference ${worst} exceeds what ${places}-decimal input can explain `
      + '— this is an ENGINE defect, not input precision').toBeLessThanOrEqual(MAX_ROUNDING)
    expect(worst, 'no difference at all — is the rounding claim even real?').toBeGreaterThan(0)
  })

  it('⭐⭐ DIVERGENCE 1 IS CLOSED — we now honour Pine\'s default `max_boxes_count`', () => {
    // ⚰️ THIS CASE USED TO PIN THE DEFECT. It is renamed rather than deleted,
    // because it is the before-and-after of the RC-B fix. It read "TradingView
    // kept 50 and deleted the rest; we cap nothing" and required
    // `emitted > V.boxCount` — true and measured at the time: the vendor held
    // 50 live boxes and we emitted every one we ever made, uncapped.
    //
    // ⭐ AND IT FAILED BY NAME THE MOMENT THE CAP LANDED, which is the only
    // reason the divergence could not quietly stop meaning what it said. Its
    // own message — "we now cap our boxes, update this divergence" — is what
    // brought a reader here.
    const { emitted } = ourBoxes()
    expect(V.boxCount, 'the vendor no longer caps at 50').toBe(50)
    expect(emitted, 'our live box count no longer matches the vendor\'s')
      .toBe(V.boxCount)
    expect(String(V._findings.maxBoxesCountDefault)).toMatch(/DELETED/)
  })

  it('⭐⭐ DIVERGENCE 2 IS CLOSED — the forward edge lands on the vendor\'s own session', () => {
    // ⚰️ THIS CASE USED TO PIN THE DEFECT. `right = bar_index + 3` means three
    // TRADING sessions; our clock extrapolated by median spacing and walked into
    // Saturday and Sunday. It required at least one mismatch AND asserted that
    // every mismatch was a weekend — so a different forward-edge bug could never
    // hide inside it, and its own message ("the forward-edge divergence is gone
    // — remove this case") is what brought a reader here.
    //
    // ⭐ RC-C made the forward step session-aware, derived from the series' own
    // weekdays rather than a constant. The result is not "fewer weekends": every
    // right edge in the window now equals TradingView's exactly, with no
    // mismatches of any other kind either.
    const { by } = ourBoxes()
    const mismatched = []
    for (const [leftDate, rightDate] of V.boxes) {
      if (!inWindow(leftDate) || !rightDate) continue
      const o = by.get(leftDate)
      if (!o || o.right === rightDate) continue
      mismatched.push({ leftDate, ours: o.right, tv: rightDate })
    }
    expect(mismatched, 'a forward edge disagrees with the vendor').toEqual([])

    // ⛔ NON-VACUITY, AND IT IS LOAD-BEARING HERE. `toEqual([])` is satisfied by
    // a loop that compared nothing at all — a wrong window, an empty run or a
    // lookup that never hits would all read as perfect agreement.
    const compared = V.boxes
      .filter(([l, r]) => inWindow(l) && r && by.get(l)).length
    expect(compared, 'no box was compared — the window or the run is empty')
      .toBeGreaterThan(0)
  })
})
