// ── LEGEND HANDOFF: the readout crosses the SAME boundary as the candles ─────
//
// On a symbol switch the legend went A → BLANK → B while the chart went A → B.
// Measured in the browser (tools/legend_handoff_harness.py): 17/17 transitions
// failed, 58 blank frames, plus one frame per switch of B's candles under A's
// numbers. Three lifecycle facts in StockChart.jsx fix it, and each one alone
// looks like an innocent reorder — so each is railed here.
//
//   1. The painted bars are stamped with `updateChart`'s OWN `sym`. Stamping
//      `symRef.current` (which lagged) labelled B's bars as A, and
//      `computeLatestCrosshair` then refused them and printed nothing.
//   2. The ref mirror (`symRef`, overlay data, …) is a LAYOUT effect declared
//      ABOVE the switch-time applier, so the readout reads THIS render's values
//      before anything paints.
//   3. The switch-time layout effect refreshes the readout right after
//      `updateChart()`, so candles and legend commit in one composited frame.
//
// The browser harness is the acceptance authority; this rail only stops a
// refactor from quietly undoing the order.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.join(HERE, '..', 'StockChart.jsx'), 'utf8')

describe('legend handoff lifecycle (StockChart.jsx)', () => {
  it('stamps the painted bars with the render\'s own sym, never the lagging ref', () => {
    expect(SRC).toMatch(/prevBarsSymRef\.current = sym\b/)
    expect(SRC).not.toMatch(/prevBarsSymRef\.current = symRef\.current/)
  })

  it('mirrors symRef in a layout effect declared above the switch-time applier', () => {
    const mirror = SRC.search(/useLayoutEffect\(\(\) => \{\s*overlayDataRef\.current = overlayData[\s\S]{0,400}?symRef\.current = sym\b/)
    const applier = SRC.indexOf('_appliedSymTfRef.current = key')
    expect(mirror).toBeGreaterThan(0)
    expect(applier).toBeGreaterThan(mirror)
    // …and there is exactly one writer of symRef.
    expect(SRC.match(/symRef\.current = sym\b/g)).toHaveLength(1)
  })

  it('refreshes the readout in the same layout effect that swaps the candles', () => {
    const applier = SRC.indexOf('_appliedSymTfRef.current = key')
    const body = SRC.slice(applier, SRC.indexOf('}, [sym, resolvedTf, updateChart])', applier))
    const paint = body.indexOf('updateChart()')
    const legend = body.indexOf('refreshOffCursorReadout()')
    expect(paint).toBeGreaterThan(0)
    expect(legend).toBeGreaterThan(paint)
  })
})
