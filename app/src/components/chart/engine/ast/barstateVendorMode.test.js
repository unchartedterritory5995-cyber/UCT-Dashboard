// app/src/components/chart/engine/ast/barstateVendorMode.test.js
//
// ⭐⭐ THE JS HALF OF `vendor` MODE, REPLAYED AGAINST THE SAME READINGS.
// `tests/test_barstate_vendor_mode.py` does this in Python; this file does it in
// the browser lane, off the SAME fixture. Two lanes replaying one capture is the
// whole point — a mode that reproduced the vendor in one language and not the
// other would be exactly the cross-lane disagreement this project already paid
// for once.
//
// ⛔⛔ THE FLAG IS OFF. `calendar` is the default and this file asserts it. No
// member-visible column changes until the confirmation instant is MEASURED rather
// than hypothesised.
//
// ⛔ AND THE CALENDAR STILL DOES NOT CROSS THE SEAM. `vendor` mode needs to know
// whether the closing update has happened; that arrives as a BOOLEAN in `opts`,
// produced on the Python side, exactly as `newestBarIsForming` does. This lane
// gained a mode, not a date set.

import { describe, it, expect } from 'vitest'

import {
  computeClock, BARSTATE_MODE_CALENDAR, BARSTATE_MODE_VENDOR, BARSTATE_MODES,
} from '../../indicators.js'
import TIMELINE from '../../../../../../tests/fixtures/vendor/barstate-daily-timeline.json'

const COLS = ['isrealtime', 'isconfirmed', 'ishistory', 'islastconfirmedhistory']

const barsFor = (row, count = 3) => {
  const newest = Number(row.newestBarUnix)
  return Array.from({ length: count }, (_, i) => ({
    t: newest - 86400 * (count - 1 - i), o: 1, h: 2, l: 0, c: 1, v: 10,
  }))
}

/** The confirmation boolean as the PRODUCER would hand it over: derived from the
 *  reading's instant against the hypothesised 20:00 ET hour, never read off the
 *  vendor's own answer — that would make the replay a tautology. */
const confirmedAt = (row) => {
  const close = Number(row.session.scheduledCloseUnix)
  const now = close + Number(row.session.secondsPastScheduledClose)
  return now >= close + 4 * 3600
}

/** ⛔ PARTITIONED ON THE VENDOR'S OWN `isrealtime` — not circular here, circular
 *  one line later. Liveness is a property of the PAGE, not of the clock: no
 *  calendar carries an instant meaning "the socket stopped delivering". So the
 *  replay is scoped to the regime it models, and the row outside that regime gets
 *  its own test asserting the LIMIT instead of widening the model to cover it. */
const LIVE_ROWS = TIMELINE.rows.filter((r) => Number(r.vendor.isrealtime) === 1)
const COLD_ROWS = TIMELINE.rows.filter((r) => Number(r.vendor.isrealtime) === 0)

describe('vendor barstate mode reproduces the chart, in the JS lane', () => {
  for (const row of LIVE_ROWS) {
    it(`⭐ ${row.instantET.slice(11, 19)} — every column back out of our own derivation`, () => {
      const cols = computeClock(barsFor(row), 'D', false,
        { mode: BARSTATE_MODE_VENDOR, confirmed: confirmedAt(row) })
      const last = cols.isrealtime.length - 1
      for (const c of COLS) {
        expect(cols[c][last], `${c} at ${row.instantET}`).toBe(Number(row.vendor[c]))
      }
    })
  }

  for (const row of COLD_ROWS) {
    it(`⭐⭐ ${row.instantET.slice(11, 19)} — THE LIMIT: the clock alone cannot reach it`, () => {
      // Row 7 read isrealtime=0 on a bar that had read 1 for seven and a half
      // hours across three separate page loads. No calendar predicts that
      // instant — it is bracketed (20:55, 23:57) ET with no proposed mechanism —
      // so liveness is an INPUT, and both halves of that decision are pinned:
      //
      // ⛔ blind, the mode gets this row WRONG, and that is ASSERTED. A later
      // "fix" that hard-codes an instant would make this pass for the wrong
      // reason, which is the failure this test exists to make loud.
      // ⭐ told, it reproduces the row exactly — so the gap is the INSTANT, not
      // the derivation.
      const opts = { mode: BARSTATE_MODE_VENDOR, confirmed: confirmedAt(row) }
      const blind = computeClock(barsFor(row), 'D', false, opts)
      const last = blind.isrealtime.length - 1
      const want = Object.fromEntries(COLS.map((c) => [c, Number(row.vendor[c])]))
      const got = Object.fromEntries(COLS.map((c) => [c, blind[c][last]]))
      expect(got, 'the clock alone now reproduces a row it cannot know about — if '
        + 'an instant was MEASURED replace this test; if GUESSED, it is shipping')
        .not.toEqual(want)

      const told = computeClock(barsFor(row), 'D', false, { ...opts, datasetLive: false })
      for (const c of COLS) {
        expect(told[c][last], `${c} at ${row.instantET}`).toBe(Number(row.vendor[c]))
      }
    })
  }

  it('⭐⭐ THE FINDING — the two axes move at DIFFERENT instants', () => {
    // A tri-state cannot spell two flags that flip hours apart. Read off the
    // fixture rather than restated, so it cannot go stale against it.
    const both = TIMELINE.rows.filter(
      (r) => Number(r.vendor.isconfirmed) === 1 && Number(r.vendor.isrealtime) === 1)
    expect(both.length, 'no row witnesses isconfirmed=1 WITH isrealtime=1 — the '
      + 'state our tri-state cannot spell').toBeGreaterThan(0)
    expect(COLD_ROWS.length, 'no row witnesses the position axis moving at all')
      .toBeGreaterThan(0)
  })

  it('⛔⛔ THE CONTROL — the rows span the transition', () => {
    // Rows that all read the same would be reproduced by a derivation that
    // ignores its inputs. `isconfirmed` must be 0 on some and 1 on others.
    const seen = new Set(TIMELINE.rows.map((r) => Number(r.vendor.isconfirmed)))
    expect([...seen].sort()).toEqual([0, 1])
  })

  it('⛔ calendar is the DEFAULT and is untouched', () => {
    const bars = barsFor(TIMELINE.rows[0])
    const plain = computeClock(bars, 'D', false)
    const named = computeClock(bars, 'D', false, { mode: BARSTATE_MODE_CALENDAR })
    const last = bars.length - 1
    for (const c of COLS) expect(plain[c][last]).toBe(named[c][last])
    // still the tri-state, which is the thing vendor mode is NOT
    expect(plain.isrealtime[last]).toBe(0)
    expect(plain.isconfirmed[last]).toBe(1)
    expect(plain.ishistory[last]).toBe(1)
  })

  it('⭐ the two modes DISAGREE exactly where the vendor and we do', () => {
    const bars = barsFor(TIMELINE.rows[TIMELINE.rows.length - 1])
    const last = bars.length - 1
    const cal = computeClock(bars, 'D', false)
    const ven = computeClock(bars, 'D', false,
      { mode: BARSTATE_MODE_VENDOR, confirmed: true })
    expect([cal.isrealtime[last], cal.isconfirmed[last], cal.ishistory[last]]).toEqual([0, 1, 1])
    expect([ven.isrealtime[last], ven.isconfirmed[last], ven.ishistory[last]]).toEqual([1, 1, 0])
  })

  it('⛔ vendor mode FAILS CLOSED when either input is unknown', () => {
    const bars = barsFor(TIMELINE.rows[0])
    const last = bars.length - 1
    for (const [forming, confirmed] of [[null, true], [false, null], [null, null]]) {
      const cols = computeClock(bars, 'D', forming,
        { mode: BARSTATE_MODE_VENDOR, confirmed })
      for (const c of COLS) expect(Number.isNaN(cols[c][last])).toBe(true)
    }
  })

  it('⛔ an unknown mode THROWS rather than defaulting to the shipped one', () => {
    const bars = barsFor(TIMELINE.rows[0])
    expect(() => computeClock(bars, 'D', false, { mode: 'vendorr' })).toThrow(/unknown barstate mode/)
    expect(BARSTATE_MODES).toContain(BARSTATE_MODE_CALENDAR)
    expect(BARSTATE_MODES).toContain(BARSTATE_MODE_VENDOR)
  })
})
