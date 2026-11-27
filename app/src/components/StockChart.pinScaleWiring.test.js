// app/src/components/StockChart.pinScaleWiring.test.js
//
// PIN TO SCALE (2026-11-26): the two facts only StockChart can supply. `placement.pinScale.test.js` proves the
// placement and `objectPriceHost` on a real chart; this pins that the chart actually WIRES them:
//   1. the object layer's `priceToY` maps through `objectPriceHost(...)` (labels and dots on a pinned instance's own
//      scale), never straight through the candle series;
//   2. the placement context carries `mainScaleMargins` from `_mainMargins` (the "No scale" band is the candles').

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const SRC = readFileSync(path.join(process.cwd(), 'src/components/StockChart.jsx'), 'utf8')

describe('StockChart wires Pin to scale', () => {
  it('the object layer maps prices through the instance\'s own scale host', () => {
    expect(SRC).toMatch(/priceHost = objectPriceHost\(mine, series\)/)
    expect(SRC).toMatch(/priceToY: \(p\) => priceHost\.priceToCoordinate\(p\)/)
    expect(SRC).not.toMatch(/priceToY: \(p\) => series\.priceToCoordinate\(p\)/)
  })

  it('the placement context carries the candles\' layout margins', () => {
    expect(SRC).toMatch(/mainScaleMargins: _mainMargins\(paneLayout, priceScaleTopMargin, volumePaneExists \? priceScaleBottomMargin : null\)/)
  })
})
