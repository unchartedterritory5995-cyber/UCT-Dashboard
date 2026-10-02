// app/src/components/chart/engine/__tests__/sparseLegend.test.js
//
// ─── `plots[].sparse` — SUPERTREND BREAKS AT A FLIP, AND ITS LEGEND SHOWS ONE SIDE ─
//
// SuperTrend draws two plots, `up` and `down`, each BLANK by design while the
// other trend holds. Before this fix the legend printed a bare "Down" chip beside
// an up-trending SuperTrend, a hovered bar's inactive side borrowed the series'
// latest value, AND lightweight-charts bridged each half's blank bars with a
// straight diagonal. `plots[].sparse` draws each valued run as its own series
// (the `gapRuns` split), gives the legend the per-bar answer (`valueAt`), and lets
// the legend omit a valueless sparse chip, keeping one chip per instance.

import { describe, it, expect } from 'vitest'
import * as registry from '../nativeRegistry'
import { createBinder } from '../binder'
import { legendChips } from '../readout'
import { validateDefinition } from '../defSchema'
import { superTrend } from '../../technicalStudies'

function harness() {
  const created = []
  const chart = {
    addSeries: (ctor, options, paneIndex) => {
      const series = {
        __data: [], ctor, options: { ...options }, paneIndex, __alive: true,
        setData: (d) => { series.__data = d },
        update: (p) => { series.__data = [...series.__data.slice(0, -1), p] },
        applyOptions: (o) => Object.assign(series.options, o),
        moveToPane: (i) => { series.paneIndex = i },
        priceScale: () => ({ applyOptions: () => {} }),
        createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {},
        attachPrimitive: () => {}, detachPrimitive: () => {},
        data: () => series.__data,
      }
      created.push(series)
      return series
    },
    removeSeries: (sr) => { sr.__alive = false },
    panes: () => [{ paneIndex: () => 0, setHeight: () => {}, getHeight: () => 100 }],
    priceScale: () => ({ applyOptions: () => {} }),
  }
  const LWC = { LineSeries: 'LineSeries', HistogramSeries: 'HistogramSeries', CandlestickSeries: 'CandlestickSeries',
    BarSeries: 'BarSeries', AreaSeries: 'AreaSeries', BaselineSeries: 'BaselineSeries',
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 }, LineType: { Simple: 0, WithSteps: 1 } }
  return { chart, LWC, alive: () => created.filter((x) => x.__alive) }
}

// A rise, a fall and a rise again: SuperTrend flips at least twice.
const BARS = Array.from({ length: 160 }, (_, i) => {
  const c = 100 + 12 * Math.sin(i / 14)
  return { t: 1_700_000_000 + i * 86400, o: c - 0.2, h: c + 0.8, l: c - 0.8, c, v: 1e6 }
})
const ST = { instanceId: 'st', defId: 'superTrend', inputs: {}, hidden: false }

let lastHarness = null
function bound(instances = [ST]) {
  const h = harness()
  lastHarness = h
  const binder = createBinder({ chart: h.chart, LWC: h.LWC })
  binder.sync({ enabled: true, registry, instances, bars: BARS, cs: { indicatorInstances: instances },
    sym: 'X', tf: 'D', adjustTime: (t) => t,
    resolvePlacement: () => ({ paneIndex: 0, scaleId: 'right', scaleOptions: null, autoscale: 'exclude' }) })
  return binder
}

/** The crosshair's seriesData at bar `i`, the way LWC hands it: a row for every
 *  series that has a POINT there (a whitespace point has no `value`). */
function hoverAt(binder, i) {
  const t = BARS[i].t
  const m = new Map([[{ candles: true }, { time: t, open: 1, high: 1, low: 1, close: 1 }]])
  for (const b of binder.bindings()) {
    const p = b.series.__data.find((d) => d.time === t)
    if (p) m.set(b.series, p)
  }
  return m
}

const r = superTrend(BARS, 10, 3)
const upBar = r.direction.findIndex((d, i) => d === 1 && i > 20)
const downBar = r.direction.findIndex((d, i) => d === -1 && i > upBar)
const flip = r.direction.findIndex((d, i) => i > 0 && d !== r.direction[i - 1] && Number.isFinite(r.direction[i - 1]))

describe('the fixture really holds both trends and a flip', () => {
  it('has an up bar, a later down bar and a flip', () => {
    expect(upBar).toBeGreaterThan(0)
    expect(downBar).toBeGreaterThan(upBar)
    expect(flip).toBeGreaterThan(0)
  })
})

describe('⭐ SuperTrend — only the active side is in the legend', () => {
  const chipsAt = (binder, i) => legendChips(binder.bindings(), hoverAt(binder, i), registry, [ST])
    .filter((c) => c.instanceId === 'st')

  it('bullish bar → ONE chip, the up line\'s value, named SuperTrend(10, 3)', () => {
    const binder = bound()
    const chips = chipsAt(binder, upBar)
    expect(chips).toHaveLength(1)
    expect(chips[0].plotKey).toBe('up')
    expect(chips[0].value).toBeCloseTo(r.up[upBar], 9)
    expect(chips[0].label).toBe('SuperTrend(10, 3)')
    expect(chips.some((c) => /^Down/.test(c.label))).toBe(false)
  })

  it('bearish bar → ONE chip, the down line\'s value — never the up side\'s latest', () => {
    const binder = bound()
    const chips = chipsAt(binder, downBar)
    expect(chips).toHaveLength(1)
    expect(chips[0].plotKey).toBe('down')
    expect(chips[0].value).toBeCloseTo(r.down[downBar], 9)
  })

  it('across a flip the chip switches side, bar for bar, with no stale value', () => {
    const binder = bound()
    for (const i of [flip - 1, flip, flip + 1]) {
      const chips = chipsAt(binder, i)
      expect(chips, `bar ${i}`).toHaveLength(1)
      const want = r.direction[i] === 1 ? 'up' : 'down'
      expect(chips[0].plotKey, `bar ${i}`).toBe(want)
      expect(chips[0].value, `bar ${i}`).toBeCloseTo(r[want][i], 9)
    }
  })

  it('a HIDDEN SuperTrend still has exactly one chip to be shown from', () => {
    const hidden = { ...ST, hidden: true }
    const binder = bound([hidden])
    const chips = legendChips(binder.bindings(), null, registry, [hidden]).filter((c) => c.instanceId === 'st')
    expect(chips).toHaveLength(1)
    expect(chips[0].hidden).toBe(true)
  })

  it('⭐⭐ the line BREAKS at every flip — no rendered series bridges a blank bar', () => {
    bound()
    const index = new Map(BARS.map((b, i) => [b.t, i]))
    const series = lastHarness.alive().filter((x) => x.__data.some((p) => Number.isFinite(p.value)))
    // two halves, several runs each: more series than plots is the split working
    expect(series.length).toBeGreaterThan(2)
    for (const x of series) {
      const idx = x.__data.filter((p) => Number.isFinite(p.value)).map((p) => index.get(p.time))
      for (let k = 1; k < idx.length; k++) expect(idx[k], 'a series bridges a gap').toBe(idx[k - 1] + 1)
    }
    // …and every computed value is drawn exactly once, by exactly one series
    const drawn = new Map()
    for (const x of series) for (const p of x.__data) if (Number.isFinite(p.value)) drawn.set(`${x.options.color}@${p.time}`, p.value)
    const want = BARS.reduce((n, _, i) => n + (Number.isFinite(r.up[i]) ? 1 : 0) + (Number.isFinite(r.down[i]) ? 1 : 0), 0)
    expect(drawn.size).toBe(want)
  })
})

describe('the declaration is narrow', () => {
  it('only SuperTrend declares `sparse`', () => {
    const sparse = registry.listDefinitions().flatMap((d) => d.plots
      .filter((p) => p.sparse === true).map((p) => `${d.id}::${p.key}`))
    expect(sparse).toEqual(['superTrend::up', 'superTrend::down'])
  })
  it('a two-line study WITHOUT it keeps both chips (Aroon)', () => {
    const inst = { instanceId: 'a', defId: 'aroon', inputs: {}, hidden: false }
    const binder = bound([inst])
    const chips = legendChips(binder.bindings(), hoverAt(binder, 100), registry, [inst]).filter((c) => c.instanceId === 'a')
    expect(chips.map((c) => c.plotKey)).toEqual(['up', 'down'])
  })
  it('the schema refuses a non-boolean `sparse`', () => {
    const def = JSON.parse(JSON.stringify(registry.getDefinition('roc')))
    def.plots[0].sparse = 'yes'
    const res = validateDefinition(def)
    expect(JSON.stringify(res)).toMatch(/plots\[0\]\.sparse/)
  })
})
