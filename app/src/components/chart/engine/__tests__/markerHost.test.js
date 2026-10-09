// app/src/components/chart/engine/__tests__/markerHost.test.js
//
// ─── ⭐⭐ BATCH 2 — WHICH SERIES A MARKER RIDES ─────────────────────────────────
//
// A marker plot's own series holds its 0/1 condition. On the PRICE pane an
// above/below glyph riding that series sat at price ≈ 0 — far below the candles,
// never seen (measured 10-09 in the sandbox). So on pane 0 an `aboveBar` /
// `belowBar` glyph rides the chart's price series; in any other pane, and for
// `inBar` (the plotted value itself), it stays on the plot's own series. A layer
// on the price series is cleared when its binding goes (it does not die with the
// plot's series).
import { describe, it, expect } from 'vitest'
import { createBinder } from '../binder'
import { createFakeChart } from './fakeChart'
import STOCKCHART_SRC from '../../../StockChart.jsx?raw'

const N = 6
const BARS = Array.from({ length: N }, (_, i) => ({ t: 1700000000 + i * 60, o: 10, h: 11, l: 9, c: 10 + i, v: 1 }))
const COND = Float64Array.from([0, 1, 0, 0, 1, 0])

const markerDef = (id, position) => ({
  id, schemaVersion: 2, label: id, inputs: [],
  plots: [{ key: 'buy', label: 'Buy', style: 'markers', color: '#ff9800', legend: { decimals: 2 },
    marker: { shape: 'arrowUp', position, size: 2.5 } }],
})

function harness(defs, paneIndex) {
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const PRICE = { __price: true }
  const layers = []
  const registry = {
    getDefinition: (id) => defs.get(id) || null,
    computeFor: () => ({ buy: COND }),
    hasAnyFinite: () => true,
    columnKeys: (d) => (d.plots || []).map((p) => p.key),
  }
  const run = (instances) => binder.sync({
    enabled: true,
    instances,
    registry,
    bars: BARS,
    adjustTime: (t) => t,
    plan: { fresh: true },
    applyData: (series, data) => series.setData(data),
    resolvePlacement: () => ({ paneIndex, scaleId: 'right', scaleOptions: {} }),
    priceSeries: () => PRICE,
    createSeriesMarkers: (series, first) => {
      const layer = { series, sets: [first] }
      layers.push(layer)
      return { setMarkers: (m) => layer.sets.push(m) }
    },
  })
  return { run, layers, PRICE }
}

const inst = (defId) => ({ instanceId: `inst:${defId}:1`, defId, inputs: {} })
const last = (layer) => layer.sets[layer.sets.length - 1]

describe('a marker on the price pane rides the candles', () => {
  it('⭐ pane 0, belowBar: the glyphs are attached to the PRICE series, one per true bar, styled', () => {
    const h = harness(new Map([['m', markerDef('m', 'belowBar')]]), 0)
    h.run([inst('m')])
    expect(h.layers).toHaveLength(1)
    expect(h.layers[0].series).toBe(h.PRICE)
    const marks = last(h.layers[0])
    expect(marks.map((m) => m.time)).toEqual([BARS[1].t, BARS[4].t])
    expect(marks[0]).toMatchObject({ shape: 'arrowUp', position: 'belowBar', size: 2.5 })
  })

  it('⭐ another pane: the glyphs stay on the plot\'s own series (an oscillator keeps its markers)', () => {
    const h = harness(new Map([['m', markerDef('m', 'aboveBar')]]), 1)
    h.run([inst('m')])
    expect(h.layers).toHaveLength(1)
    expect(h.layers[0].series).not.toBe(h.PRICE)
  })

  it('⭐ inBar (the plotted value) stays on the plot\'s own series even on the price pane', () => {
    const h = harness(new Map([['m', markerDef('m', 'inBar')]]), 0)
    h.run([inst('m')])
    expect(h.layers[0].series).not.toBe(h.PRICE)
  })

  it('⛔ removing the indicator clears its glyphs from the price series', () => {
    const h = harness(new Map([['m', markerDef('m', 'belowBar')]]), 0)
    h.run([inst('m')])
    expect(last(h.layers[0]).length).toBe(2)
    h.run([])
    expect(last(h.layers[0])).toEqual([])
  })
})

describe('the live chart injects the glyph capability', () => {
  it('⛔ StockChart hands the binder createSeriesMarkers (it never did: every marker was invisible)', () => {
    const SRC = STOCKCHART_SRC
    expect(SRC).toMatch(/^import \{[^}]*\bcreateSeriesMarkers\b[^}]*\} from 'lightweight-charts'/m)
    const ctx = SRC.slice(SRC.indexOf('priceSeries: () => candleSeriesRef.current'), SRC.indexOf('setBarColours: (map) =>'))
    expect(ctx).toMatch(/^\s*createSeriesMarkers,\s*$/m)
  })
})
