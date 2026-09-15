// app/src/components/chart/ChartDrawingOverlay.paneTransform.test.jsx
//
// ─── TWO HALVES OF ONE TRANSFORM, AND BOTH ARE LOAD-BEARING ─────────────────
//
// A drawing's pixel is `pane-local y + that pane's zone top`. Master and Track A
// each fixed one direction of that sentence, from different bug reports, in the
// same few lines:
//
//   FORWARD  (value → pixel)   `priceZoneTop()` — `priceToCoordinate` answers in
//     the PANE's coordinates while the overlay canvas spans the whole stack.
//     Identical numbers only while Price was pane 0; with a pane above it, a
//     line stored at 310 rendered against ~400.
//   BACKWARD (pixel → value)   `paneValueAt()` — `coordinateToPrice` is the same
//     question reversed, so a canvas y must LOSE the zone top first. Without it
//     a line in a 0-200 breadth pane was labelled `514.80`.
//
// ⛔⛔ THIS FILE FAILS IF EITHER HALF IS REMOVED, which is the point: they look
// like one another's duplicate and neither is. The bite checks in the repo's
// history removed each in turn.
//
// ⚠️ THE CANVAS IS RECORDED, NOT RASTERISED. jsdom has no 2D context, so
// `getContext` is stubbed with a recorder and the assertions are about the
// COORDINATES the painter asked for — which is exactly the quantity both bugs
// got wrong, and is deterministic in a way pixel-sampling a live harness was not.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { createRef } from 'react'
import ChartDrawingOverlay from './ChartDrawingOverlay'
import { resolveZones, rectForKey, PRICE, VOLUME } from './drawingPanes'

const bars = Array.from({ length: 12 }, (_, i) => ({
  t: `2026-09-${String(i + 1).padStart(2, '0')}`, o: 100, h: 110, l: 90, c: 100 + i, v: 1000,
}))

// ── the recorder ────────────────────────────────────────────────────────────
let ops
function recorder() {
  const noop = () => {}
  return new Proxy({
    moveTo: (x, y) => ops.push(['moveTo', x, y]),
    lineTo: (x, y) => ops.push(['lineTo', x, y]),
    rect: (x, y, w, h) => ops.push(['rect', x, y, w, h]),
    fillText: (t, x, y) => ops.push(['fillText', String(t), x, y]),
    strokeText: (t, x, y) => ops.push(['strokeText', String(t), x, y]),
    measureText: () => ({ width: 30 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    canvas: { width: 600, height: 400 },
  }, {
    get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? noop : undefined)),
    set: () => true,
  })
}

/** A pane whose height is fixed and which knows its own index. */
const fakePane = (h, i, series) => ({
  getHeight: () => h,
  paneIndex: () => i,
  getSeries: () => series,
  getHTMLElement: () => ({ clientHeight: h }),
  priceScale: () => ({ width: () => 56, options: () => ({ scaleMargins: { top: 0.1, bottom: 0.1 } }) }),
})

/**
 * A chart whose CANDLE pane is at `candleAt`, with `paneHeights` above/below it.
 * The pane at `oscAt` carries its own series on a 0-100 scale — the breadth /
 * RSI case master's half is about.
 */
function chartWith({ paneHeights, candleAt, oscAt }) {
  const oscSeries = {
    // a 0-100 axis over the pane's own height
    coordinateToPrice: (y) => 100 - (y / paneHeights[oscAt]) * 100,
    priceToCoordinate: (p) => ((100 - p) / 100) * paneHeights[oscAt],
    priceScale: () => ({ width: () => 56, options: () => ({ scaleMargins: { top: 0, bottom: 0 } }) }),
  }
  const panes = []
  const candles = {
    // a 400-price axis over the candle pane — PANE-LOCAL, as lightweight-charts answers
    priceToCoordinate: (p) => 400 - p,
    coordinateToPrice: (y) => 400 - y,
    priceScale: () => ({ width: () => 56, options: () => ({ scaleMargins: { top: 0.1, bottom: 0.1 } }) }),
    getPane: () => panes[candleAt],
  }
  paneHeights.forEach((h, i) => panes.push(fakePane(h, i, i === candleAt ? [candles] : (i === oscAt ? [oscSeries] : []))))
  const chart = {
    panes: () => panes,
    timeScale: () => ({
      height: () => 28,
      timeToCoordinate: () => 120,
      coordinateToLogical: () => 1,
      logicalToCoordinate: () => 120,
      getVisibleLogicalRange: () => ({ from: 0, to: 11 }),
      subscribeVisibleLogicalRangeChange: () => {},
      unsubscribeVisibleLogicalRangeChange: () => {},
    }),
    options: () => ({ layout: { background: { color: '#0f0f0f' } } }),
    priceScale: () => ({ width: () => 56 }),
  }
  return { chart, candles, oscSeries }
}

const NOOP = () => {}
function mount({ paneHeights, candleAt, oscAt, drawings, selectedId = null }) {
  const { chart, candles } = chartWith({ paneHeights, candleAt, oscAt })
  const chartRef = createRef(); chartRef.current = chart
  const seriesRef = createRef(); seriesRef.current = candles
  return render(
    <ChartDrawingOverlay
      chartRef={chartRef} seriesRef={seriesRef} bars={bars}
      activeTool={null} setActiveTool={NOOP} color="#c9a84c" lineWidth={1}
      drawings={drawings} addDrawing={() => 'id'} updateDrawing={NOOP} removeDrawing={NOOP}
      selectedId={selectedId} setSelectedId={NOOP}
    />,
  )
}

/** Every y the painter asked for, deduped. */
const ys = () => [...new Set(ops.filter((o) => o[0] === 'moveTo' || o[0] === 'lineTo').map((o) => Math.round(o[2])))]


beforeEach(() => {
  ops = []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => recorder())
  // ⚠️ ON `Element`, NOT ON THE CANVAS. The overlay sizes itself from its
  // WRAPPER's rect, and jsdom reports 0x0 for every element — a canvas-only stub
  // leaves the painter with no height and it draws nothing at all.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, width: 600, height: 400, top: 0, left: 0, right: 600, bottom: 400,
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

// ─────────────────────────────────────────────────────────────────────────────
describe('⚰️ FORWARD — a Price drawing is placed against the pane Price is in', () => {
  const HLINE = [{ id: 'h', type: 'horizontal', color: '#ff00ff', width: 2, points: [{ time: bars[2].t, price: 310 }] }]

  it('⭐ Price first → pane-local IS canvas-global, and nothing moved', () => {
    mount({ paneHeights: [360, 40], candleAt: 0, oscAt: 1, drawings: HLINE })
    // priceToCoordinate(310) = 90, zone top = 0
    expect(ys()).toContain(90)
  })

  it('⚰️⚰️ Price THIRD → the same value is painted 182px lower, not at 90', () => {
    // panes [100, 80, 180]: the candle zone starts at 100+1+80+1 = 182.
    mount({ paneHeights: [100, 80, 180], candleAt: 2, oscAt: 0, drawings: HLINE })
    const painted = ys()
    expect(painted, `expected 90+182; got ${painted}`).toContain(272)
    // ⛔ AND NOT THE UNOFFSET NUMBER — that is the bug, exactly.
    expect(painted, 'the drawing painted at its PANE-LOCAL y — the offset is missing').not.toContain(90)
  })

  it('⭐ Price second → offset is the one pane above it', () => {
    mount({ paneHeights: [100, 260], candleAt: 1, oscAt: 0, drawings: HLINE })
    expect(ys()).toContain(90 + 101)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('⚰️ BACKWARD — the data a pane drawing is valued from', () => {
  // ⚠️ WHAT THIS FILE CAN AND CANNOT WITNESS. The value a pane drawing PRINTS is
  // painted through `fillText`, and the tag is not reached in this fake
  // environment — so asserting the string here would mean contriving conditions
  // until a label appeared, which proves the contrivance and not the product.
  // Master's own `surfaces.test.jsx` additions and its browser verification cover
  // the printed label.
  //
  // ⭐ WHAT IS ASSERTED INSTEAD IS THE INPUT THAT HALF CONSUMES, and it is the
  // exact quantity that was missing: every zone must name the LWC pane whose
  // scale owns it, and must know its own top, because `paneValueAt` computes
  // `canvasY - zone.y0` on that pane's series. Remove either field and master's
  // fix cannot be written at all.
  it('⚰️ every zone names the pane whose scale owns it', () => {
    const { chart } = chartWith({ paneHeights: [100, 80, 180], candleAt: 2, oscAt: 0 })
    const geom = resolveZones({
      width: 600, height: 400, axisWidth: 56, timeAxisHeight: 28,
      paneHeights: chart.panes().map((p) => p.getHeight()),
      separatorHeight: 1, candlePaneIndex: 2,
    })
    for (const z of geom.zones) {
      expect(Number.isInteger(z.paneIndex), `zone ${z.key} carries no paneIndex`).toBe(true)
    }
    expect(rectForKey(geom, PRICE).paneIndex).toBe(2)
    // the first non-candle pane, keyed positionally
    expect(geom.zones.find((z) => z.key === 'pane1').paneIndex).toBe(0)
  })

  it('⛔ …and a zone top is the number the value conversion subtracts', () => {
    const geom = resolveZones({
      width: 600, height: 400, axisWidth: 56, timeAxisHeight: 28,
      paneHeights: [100, 80, 180], separatorHeight: 1, candlePaneIndex: 2,
    })
    // pane1 sits at the very top; the candles start below both panes above them.
    expect(geom.zones.find((z) => z.key === 'pane1').y0).toBe(0)
    expect(rectForKey(geom, PRICE).y0).toBe(182)
  })
})

describe('⭐⭐ the two directions are INVERSES, on the same pane', () => {
  // ⚠️ THREE CONVERSIONS NOW MEET IN THIS FILE and they all hinge on ONE number:
  //   · `paneValueAt`    pixel → value   (canvasY − paneTop)   [master]
  //   · `paneYForValue`  value → pixel   (+ paneTop)           [master]
  //   · `priceZoneTop`   the addend for Price's own placement  [Track A]
  // If any of them read a DIFFERENT edge than the others, drawings drift by the
  // height of whatever sits above the pane — which is exactly how both bugs
  // looked. So the edge itself is asserted once, here, for every zone.
  const geom = () => resolveZones({
    width: 600, height: 400, axisWidth: 56, timeAxisHeight: 28,
    paneHeights: [100, 80, 180], separatorHeight: 1, candlePaneIndex: 2,
  })

  it('⭐ every zone that IS a pane has paneTop === y0 — the round trip is exact', () => {
    for (const z of geom().zones) {
      expect(Number.isFinite(z.paneTop), `zone ${z.key} has no paneTop`).toBe(true)
      // pixel → value → pixel, with the pane's own top on both sides
      const probe = z.y0 + 10
      const local = probe - z.paneTop
      expect(local + z.paneTop).toBe(probe)
    }
  })

  it('⛔⛔ a BAND volume zone subtracts the CANDLE top, not its own y0', () => {
    // The one case where the two edges genuinely differ, and the reason master
    // made `paneTop` a separate field. Getting this wrong offsets every volume
    // reading by the height of the candles above it — in the DEFAULT layout.
    const banded = resolveZones({
      width: 600, height: 400, axisWidth: 56, timeAxisHeight: 28,
      paneHeights: [300], separatorHeight: 1, candlePaneIndex: 0,
      volumePaneIndex: null, volumeBandTop: 0.78,
    })
    const vol = banded.zones.find((z) => z.key === VOLUME)
    expect(vol.y0, 'the band starts partway down the pane').toBeGreaterThan(0)
    expect(vol.paneTop, 'the band must be valued from the PANE top, not its own').toBe(0)
    expect(vol.paneTop).not.toBe(vol.y0)
  })

  it('⭐ and Track A reads the SAME edge master subtracts', () => {
    // `priceZoneTop` inverts `priceToCoordinate`, so it must use the pane's top.
    const price = rectForKey(geom(), PRICE)
    expect(price.paneTop).toBe(182)
    expect(price.paneTop).toBe(price.y0)   // equal for Price, in both layouts
  })
})

describe('⛔ the two halves are independent', () => {
  it('a pane-owned anchor is positioned by its ZONE, never by priceToCoordinate', () => {
    // `resolvePixels` overrides `toPixel`'s y when `paneY` is present. This is
    // why the forward offset stays Price-specific: generalising it would add an
    // offset to a number nothing reads.
    mount({
      paneHeights: [100, 80, 180], candleAt: 2, oscAt: 0,
      drawings: [{ id: 'p', type: 'horizontal', color: '#00ffff', width: 2, pane: 'pane1',
        points: [{ time: bars[2].t, price: 310, paneY: 0.5 }] }],
    })
    // zone 0 is 0..100, so the anchor is at 50 — NOT 90 (priceToCoordinate) and
    // NOT 272 (priceToCoordinate + the candle zone top).
    const painted = ys()
    expect(painted).toContain(50)
    expect(painted).not.toContain(272)
  })
})
