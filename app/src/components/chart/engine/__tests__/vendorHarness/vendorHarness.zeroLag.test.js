// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.zeroLag.test.js
//
// ─── ZERO-LAG MA TREND LEVELS, AGAINST TRADINGVIEW'S OWN DRAWING ──────────────
//
// Captured on a live TradingView chart 2026-09-27 (NYSE:RDDT 1D, all 631 bars
// from the 2024-03-21 listing) through `tools/vendor_harness/tv_capture.js`.
// The capture's embedded source is byte-identical to
// `corpus/committed/zero-lag-ma-trend-levels-chartprime__0ded7d1e36.pine`.
//
// ⭐ This rail reads OUR SIDE through the member door (`runOurSide`) and pins it
// to the VENDOR's records — counts AND the text of every box — so a change that
// moves the drawing away from what TradingView held goes red by name.
//
// ⚠️ It calls `runOurSide` rather than `gradeCapture` on purpose: this capture's
// fill colorers (`plot_6`/`plot_7` → `fill_0`) are refused by the v1 schema on
// this branch, and the objects must be pinned whatever the plot comparator can
// admit. (Plots all MATCH once the fill-target admission from
// `pine/live-captures-1` is present — measured 2026-09-27.)
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { loadCapture } from './harness'
import { runOurSide } from './ourSide'

const FILE = path.resolve(process.cwd(), '..',
  'tests/fixtures/vendor/harness/zero-lag-ma-trend-levels-rddt-1d-2026-09-27.json')
const capture = () => {
  const loaded = loadCapture(FILE)
  if (!loaded.capture) throw new Error(`not a capture — ${loaded.reason}`)
  return loaded.capture
}

describe('Zero-Lag MA Trend Levels — objects held at the last bar', () => {
  const cap = capture()
  const ours = runOurSide(cap)

  it('⛔ CONTROL — the member door ran and the capture recorded drawings', () => {
    expect(ours.ok, ours.refusal).toBe(true)
    expect(ours.objects && ours.objects.ok, ours.objects && ours.objects.reason).toBe(true)
    expect(cap.objects.counts.boxes).toBeGreaterThan(0)
    expect(cap.objects.records.boxes.length).toBe(cap.objects.counts.boxes)
  })

  it('⭐ BOXES — we hold as many as TradingView (18), drawn through the `draw_box` METHOD', () => {
    expect(ours.objects.counts.boxes).toBe(cap.objects.counts.boxes)
    expect(cap.objects.counts.boxes).toBe(18)
  }, 60000)

  it('⭐ every box carries TradingView\'s own caption (`str.tostring(math.round(close, 2))`)', () => {
    const vendor = cap.objects.records.boxes.map((b) => String(b.t)).sort()
    expect([...ours.objects.texts.boxes].sort()).toEqual(vendor)
  }, 60000)

  it('⭐ the boxes TradingView holds with an `na` edge are the ones we hold and cannot draw', () => {
    const vendorNa = cap.objects.records.boxes.filter((b) => b.y1 === null || b.y2 === null).length
    expect(vendorNa).toBe(5)                       // ta.atr(200) still warming when they were made
    expect(ours.objects.counts.boxes - ours.objects.drawn.boxes).toBe(vendorNa)
    expect(ours.notes.join(' ')).toMatch(/5 of 18 held boxes cannot be drawn/)
  })
})
