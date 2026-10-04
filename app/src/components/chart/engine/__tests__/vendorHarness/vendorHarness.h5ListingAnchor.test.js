// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.h5ListingAnchor.test.js
//
// ─── H5 (step 84) — a period anchor read FROM THE LISTING is not withheld ──────
//
// `interpret.js::periodAnchorMask` withholds the bars of a tree whose answer
// reads a `time("W"|"M"|…)` this lane cannot answer. On a New York session chart
// the anchor itself is the vendor's calendar on every bar (C49); what it still
// withheld was everything within the tree's reach of "the bar BEFORE the series"
// — because that bar exists on TradingView and not in our window.
//
// ⛔ From the listing (ruling R-W, `opts.historyFromListing`) there IS no earlier
// bar: `ta.change(time("M"))` on bar 0 is Pine's `na` on TradingView too, which is
// what this lane answers. `historyReadMask` already makes that exception for a
// history read; the period mask did not, and the withholding spread over the
// tree's whole reach — a `var` maximum reset at a month change read 251 blank bars
// where TradingView drew from bar 0.
//
// ⭐ GRADED against `vw-library-import-rddt-1d-2026-10-02` (NYSE:RDDT 1D, 636 bars
// from the listing): its L03 / L04 rows are `highestSince(ta.change(time("M"|"W"))
// != 0, high)`, TradingView's own answer. The same program written at the top
// level (no library, no default) is the script below; the receipt is re-sealed
// over the changed text, and only those two rows are graded.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { gradeCapture, loadCapture, HARNESS_DIR } from './harness'
import { sha256Hex, sealCapture } from '../../../../../../../tools/vendor_harness/schema.mjs'

afterEach(() => { vi.unstubAllEnvs() })

const LIB = loadCapture(path.join(HARNESS_DIR, 'vw-library-import-rddt-1d-2026-10-02.json')).capture
const TEXT = [
  '//@version=5',
  'indicator("UCTPROBE L1 library import", overlay = false)',
  'var float hiM = na',
  'hiM := ta.change(time("M")) != 0 ? high : na(hiM) ? high : math.max(hiM, high)',
  'plot(hiM, "L03 highestSince month")',
  'var float hiW = na',
  'hiW := ta.change(time("W")) != 0 ? high : na(hiW) ? high : math.max(hiW, high)',
  'plot(hiW, "L04 highestSince week")',
  '',
].join('\n')
function graded(history) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
  const cap = sealCapture({ ...LIB, source: { ...LIB.source, text: TEXT, sha256: sha256Hex(TEXT) },
    ...(history ? { history: { ...LIB.history, ...history } } : {}) })
  return gradeCapture(cap)
}
const item = (v, title) => v.plots.find((p) => p.title === title)

describe('⭐ H5 — `ta.change(time("M"|"W"))` from the listing, on the host lane', () => {
  it('vendor: the capture starts at the listing (the fact the rule reads)', () => {
    expect(LIB.history.startsAtBar0).toBe(true)
    expect(LIB.bars.count).toBe(636)
  })

  it.each(['L03 highestSince month', 'L04 highestSince week'])('⭐ door: %s MATCH from bar 0, 636 / 636', (title) => {
    const g = graded()
    expect(g.ours.ok, g.ours.refusal).toBe(true)
    const p = item(g.verdict, title)
    expect(p.verdict, p.reason).toBe('MATCH')
    expect(p.stats.matching).toBe(636)
  })

  // ⛔ CONTROL: the same bars NOT from the listing. There the bar before the
  // series exists on TradingView and not here, so the reach of the tree is
  // withheld exactly as before H5 (251 blank bars, graded as warm-up, not as
  // steady-state values) — the rule moved only for a series from the listing.
  it('⛔ CONTROL: NOT from the listing, the first 251 bars are still not served', () => {
    const p = item(graded({ startsAtBar0: false }).verdict, 'L03 highestSince month')
    expect(p.stats.matching).toBe(385)
    expect(p.stats.naMismatches).toBe(251)
    expect(p.stats.warmup.divergent).toBe(251)
    expect(p.stats.steady.divergent).toBe(0)
  })
})
