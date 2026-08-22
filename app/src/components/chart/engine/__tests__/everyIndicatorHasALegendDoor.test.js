// app/src/components/chart/engine/__tests__/everyIndicatorHasALegendDoor.test.js
//
// ─── THE LEGEND CHIP IS THE ONLY PER-INSTANCE SETTINGS DOOR ─────────────────
//
// `IndicatorSettingsDialog` is opened from exactly one place a member can reach on
// a normal chart: the gear on the indicator's LEGEND CHIP (`StockChart.jsx`'s
// `chipHandlers.onOpenSettings`, and the chip's own long-press menu, which is the
// same chip). The chart's right-click region menu builds a `<label> settings…` row
// too, but it needs the pointer to resolve to that indicator's own region — it did
// not appear on the price pane, an indicator pane, or the MACD pane in repeated
// attempts on production.
//
// A chip exists only for a plot that declares `plots[].legend` (`readout.chipsFrom`
// skips any plot without one — "Emitting an undeclared chip here would put a
// second, differently-formatted line into the readout"). So a definition whose
// plots declare no legend draws on the chart and offers the member NO WAY TO OPEN
// ITS SETTINGS.
//
// ⚰️ MEASURED ON PRODUCTION 2026-08-15. With RSI, Bollinger Bands and ATR all
// enabled and all three visibly DRAWING (BB's bands on the price pane, RSI and ATR
// in their own panes), the legend carried exactly one chip — `RSI(14) 56.5` — and
// the only settings buttons in the document were `Chart settings`, `RSI(14)
// settings` and `AI Search settings`. There was no `BB settings` and no `ATR
// settings`, and the legend was NOT in compact mode, so nothing was suppressing
// them.
//
// This test names every definition in that position. It is deliberately a LIST
// rather than a blanket assertion: some of these may be a considered choice (a
// band has three lines and one chip per line would be noise), and that is the
// owner's call. What is not defensible is the CONSEQUENCE — no chip means no
// settings door — so the list is pinned here and any change to it has to be
// deliberate.
import { describe, it, expect } from 'vitest'
import { listDefinitions, getDefinition } from '../nativeRegistry'

const DEFS = listDefinitions().map(d => getDefinition(d.id) || d).filter(Boolean)

/** Plots that actually draw a per-bar series (an `hlines` plot is a static
 *  reference level, not a value a chip could report). */
const drawnPlots = (def) => (def.plots || []).filter(p => p && p.style !== 'hlines')

/** Plots that will produce a chip — `chipsFrom`'s own test. */
const chipPlots = (def) => drawnPlots(def).filter(p => p.legend && p.legend.hide !== true)

describe('the audit has definitions to audit — the control', () => {
  it('the registry ships definitions with drawn plots', () => {
    expect(DEFS.length).toBeGreaterThan(10)
    expect(DEFS.filter(d => drawnPlots(d).length > 0).length).toBeGreaterThan(10)
  })

  it('at least one definition DOES produce a chip — so a zero result would be visible', () => {
    expect(DEFS.filter(d => chipPlots(d).length > 0).length).toBeGreaterThan(3)
  })
})

describe('🔴 a definition that draws must offer a chip, because the chip is the settings door', () => {
  it('lists every definition that draws a plot and declares no legend on any of them', () => {
    const doorless = DEFS
      .filter(d => drawnPlots(d).length > 0 && chipPlots(d).length === 0)
      .map(d => `${d.id} (${drawnPlots(d).length} drawn plot(s), 0 with a legend)`)

    expect(doorless, 'these indicators draw on the chart and a member cannot open '
      + 'their settings from it: no legend chip means no gear, and the right-click '
      + 'region menu did not offer a settings row in production').toEqual([])
  })
})
