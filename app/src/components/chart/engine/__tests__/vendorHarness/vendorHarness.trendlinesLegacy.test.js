// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.trendlinesLegacy.test.js
//
// ─── ⭐⭐ `trendlines` (v4) AGAINST TRADINGVIEW, NOW THAT IT ATTACHES ───────────
//
// `corpus/committed/trendlines__43QQg9nDN0.pine` is a v4 script built on the two
// Pine rules `pineHostWalls5.test.js` implements:
//
//   phv1 = valuewhen(ph, high[rightbars], 0)        ← v4 BARE valuewhen = occurrence
//   get_y(m, b, ts)=>                               ← body ends in a DECLARATION
//       Y = m * ts + b
//
// Before 2026-09-28 the member door refused it (`pine:function-def — get_y ends
// in no value`), so the capture below graded INCONCLUSIVE. It now attaches, and
// this rail grades it on TradingView's own bars and numbers:
// `tests/fixtures/vendor/harness/trendlines-rddt-1d-2026-09-27.json` — NYSE:RDDT
// 1D, all 631 bars from the listing, captured on a live chart.
//
// ⭐ WHAT IS HELD: every one of the eight plots agrees with the vendor on EVERY
// value of all 631 bars (no value and no na mismatch), and the object counts and
// texts agree. Four plots MATCH outright, colour included.
//
// ⚠️ KNOWN DIVERGENCE, PINNED SO IT GOES RED WHEN IT MOVES: the four pivot plots
// (`plotshape(ph, …, offset=-rightbars)` and the two untitled `plot(…,
// offset=-rightbars)`) disagree on COLOUR only, and only in one way — on every
// compared bar the vendor has the plot's colour and our drawn colour is `null`.
// Their VALUES agree bar for bar. MEASURED 2026-09-28 (a probe over
// `runOurSide`): the colour IS drawn — on bar i-15, where the renderer places a
// point of an `offset=-15` plot (pivot high values at bars 237/367/389, colours at
// 222/352/374). The vendor's study data is keyed to the computation bar i. So
// `ourSide.drawnColours`, which reads the renderer's points by the UNDISPLACED
// bar time, finds nothing there: a harness alignment gap for displaced plots,
// not a product defect and not the translation this lane changed. Left for the
// harness's owner; this pin goes red the day the read is aligned.
import { describe, it, expect } from 'vitest'
import path from 'node:path'

import { gradeCapture, loadCapture } from './harness'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const ID = 'trendlines-rddt-1d-2026-09-27'

function grade() {
  const loaded = loadCapture(path.join(DIR, `${ID}.json`))
  if (!loaded.capture) throw new Error(`${ID}: not a capture — ${loaded.reason}`)
  return gradeCapture(loaded.capture).verdict
}

const MATCHING = ['Resistance Trendline', 'Support Trendline', 'Long Break', 'Short Break']

describe('trendlines (v4) — the member door against the TradingView capture', () => {
  it('⭐⭐ attaches and grades: every plot agrees with the vendor on every VALUE of 631 bars', () => {
    const v = grade()
    // ⛔ NON-VACUITY: a refused door grades INCONCLUSIVE with zero plots — the
    // state this script was in before the fix.
    expect(v.verdict, v.reason).not.toBe('INCONCLUSIVE')
    expect(v.plots.length).toBe(8)
    for (const p of v.plots) {
      expect(p.stats.steady.compared, p.title).toBe(631)
      expect(p.stats.valueMismatches, `${p.title}: value`).toBe(0)
      expect(p.stats.naMismatches, `${p.title}: na`).toBe(0)
    }
  }, 60000)

  it('⭐ the trendline levels and break markers MATCH outright, colour included', () => {
    const v = grade()
    for (const title of MATCHING) {
      const p = v.plots.find((x) => x.title === title)
      expect(p, title).toBeTruthy()
      expect(p.verdict, `${title}: ${p.reason}`).toBe('MATCH')
    }
    expect(v.objects.verdict, v.objects.reason).toBe('MATCH')
  }, 60000)

  // ⚰️ WAS "⚠️ KNOWN: the four displaced pivot plots diverge on colour only —
  // ours null, vendor coloured". Closed at integration (2026-09-28): the colour
  // rulings (#250) resolve the pivot plots' colour the way the vendor does, so
  // all four now MATCH with their colours compared, not skipped.
  it('⭐ the four displaced pivot plots MATCH too, colour compared on every bar', () => {
    const v = grade()
    const pivots = v.plots.filter((p) => !MATCHING.includes(p.title))
    expect(pivots.length).toBe(4)
    for (const p of pivots) {
      expect(p.verdict, `${p.title}: ${p.reason}`).toBe('MATCH')
      expect(p.stats.colorCompared, p.title).toBeGreaterThan(0)
      expect(p.stats.colorMismatches, p.title).toBe(0)
    }
  }, 60000)
})
