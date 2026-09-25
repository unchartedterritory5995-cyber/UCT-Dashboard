// ⭐⭐ THE GOLDEN ACCEPTANCE SYMBOLS, on REAL v4 data, through the REAL binder.
//
// `fixtures/fundamentalsGolden.v4.json` is the private API body the chart reads,
// captured from production R2. Each case asserts what a member must SEE, read
// off the series the binder hands the renderer: a canonical gap is valued in NO
// render series and no render series spans one (the pixel proof of the same
// contract is `tools/fundamentals_gap_pixels.mjs`).
import { describe, it, expect, beforeAll } from 'vitest'
import * as registry from '../nativeRegistry'
import { createBinder } from '../binder'
import { _resetFundamentalsForTests, primeFundamentalsCatalog, _points } from '../fundamentalSeries'
import GOLDEN from './fixtures/fundamentalsGolden.v4.json'

const IDS = ['revenue_ttm', 'revenue_q', 'eps_diluted_ttm', 'net_income_ttm', 'net_margin_ttm', 'roe_ttm', 'gross_margin_ttm']
const FMT = { revenue_ttm: 'compact_usd', revenue_q: 'compact_usd', eps_diluted_ttm: 'usd2', net_income_ttm: 'compact_usd',
  net_margin_ttm: 'pct1', roe_ttm: 'pct1', gross_margin_ttm: 'pct1' }
const CATALOG = { metrics: IDS.map((id) => ({ id, name: id, series: id, compose: null, inputs: [], presentation: 'step',
  cadence: 'quarterly', unit: 'x', fmt: FMT[id], category: 'Financials' })) }

// Every weekday 2009-01-02 .. 2026-09-24: the as-of projection only reads bar DATES.
const BARS = (() => {
  const out = []
  const d = new Date('2009-01-02T00:00:00Z')
  const end = new Date('2026-09-24T00:00:00Z')
  while (d <= end) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) out.push({ t: d.toISOString().slice(0, 10), o: 1, h: 1, l: 1, c: 1, v: 1 })
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
})()
const INDEX = new Map(BARS.map((b, i) => [b.t, i]))
const ADJ = (t) => t

function draw(sym, metricId, withMa = false) {
  const created = []
  const chart = {
    addSeries: (ctor, options, paneIndex) => {
      const s = { __data: [], __alive: true, options: { ...options }, paneIndex,
        setData: (d) => { s.__data = d }, update: () => {}, applyOptions: (o) => Object.assign(s.options, o),
        moveToPane: () => {}, priceScale: () => ({ applyOptions: () => {} }),
        createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {} }
      created.push(s)
      return s
    },
    removeSeries: (s) => { s.__alive = false },
    panes: () => [{ paneIndex: () => 0, setHeight: () => {}, getHeight: () => 100 }],
    priceScale: () => ({ applyOptions: () => {} }),
  }
  const LWC = { LineSeries: 'L', HistogramSeries: 'H', CandlestickSeries: 'C', BarSeries: 'B', AreaSeries: 'A', BaselineSeries: 'BL',
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 }, LineType: { Simple: 0, WithSteps: 1 } }
  const body = GOLDEN[sym]
  const series = Object.fromEntries(Object.entries(body.metrics || {}).map(([k, v]) => [k, _points(v)]))
  const insts = [{ instanceId: 'f', defId: 'dataSeries', inputs: { source: `fund:${metricId}` }, hidden: false }]
  if (withMa) insts.push({ instanceId: 'ma', defId: 'movingAverage', inputs: { source: '@f::value', period: 20, maType: 'sma' }, hidden: false })
  const binder = createBinder({ chart, LWC })
  binder.sync({ enabled: true, registry, instances: insts, bars: BARS, cs: {}, sym, tf: 'D', adjustTime: ADJ,
    fundamentals: new Map([[sym, { series, missing: body.missing || [] }]]),
    resolvePlacement: () => ({ paneIndex: 1, priceScaleId: 'right', key: 'p' }) })
  const alive = created.filter((s) => s.__alive)
  return { binder, alive, byInst: (id) => { const b = binder.bindings().find((x) => x.instanceId === id); return b ? [b.series, ...b.runSeries] : [] } }
}

const valuedIdx = (s) => s.__data.filter((p) => Number.isFinite(p.value)).map((p) => INDEX.get(p.time))
const valuedDays = (s) => s.__data.filter((p) => Number.isFinite(p.value)).map((p) => p.time)
function noSeriesSpansAGap(list) {
  for (const s of list) {
    const idx = valuedIdx(s)
    for (let k = 1; k < idx.length; k++) if (idx[k] !== idx[k - 1] + 1) return false
  }
  return true
}
const anyValuedBetween = (list, from, to) => list.some((s) => valuedDays(s).some((d) => d >= from && d <= to))
const gapStarts = (sym, id) => (GOLDEN[sym].metrics[id] || []).filter((p) => p[3] === 'gap')
  .map((p) => new Date(p[0] * 1000).toISOString().slice(0, 10))

beforeAll(() => { _resetFundamentalsForTests(); primeFundamentalsCatalog(CATALOG) })

describe('the fixture is the v4 contract', () => {
  it('every golden body is derivation v4 and a 200', () => {
    for (const sym of ['TSLA', 'CELH', 'CAVA', 'NVDA', 'JPM', 'AAPL']) {
      expect(GOLDEN[sym].status, sym).toBe(200)
      expect(GOLDEN[sym].derivation_version, sym).toBe(4)
    }
  })
})

describe('TSLA -- Q1-Q3 2025 is unknown and drawn broken', () => {
  for (const id of ['eps_diluted_ttm', 'net_margin_ttm', 'roe_ttm']) {
    it(`⛔⛔ ${id}: nothing valued 2025-04-24 .. 2026-01-28, and no series spans the gap`, () => {
      expect(gapStarts('TSLA', id)).toEqual(expect.arrayContaining(['2025-04-23', '2025-07-24', '2025-10-23']))
      const { alive } = draw('TSLA', id)
      expect(alive.length).toBeGreaterThanOrEqual(2)
      expect(noSeriesSpansAGap(alive)).toBe(true)
      expect(anyValuedBetween(alive, '2025-04-24', '2026-01-28')).toBe(false)
      // ... and the FY2024 value is drawn right up to the gap, the FY2025 one from after it
      expect(anyValuedBetween(alive, '2025-04-01', '2025-04-22')).toBe(true)
      expect(anyValuedBetween(alive, '2026-01-30', '2026-09-24')).toBe(true)
    })
  }

  it('⭐ revenue_ttm has no gap there and stays ONE continuous series', () => {
    const { alive } = draw('TSLA', 'revenue_ttm')
    expect(alive).toHaveLength(1)
    expect(anyValuedBetween(alive, '2025-04-24', '2026-01-28')).toBe(true)
  })

  it('⭐⭐ an MA over TSLA EPS resets at the gap and is drawn broken', () => {
    const { byInst } = draw('TSLA', 'eps_diluted_ttm', true)
    const ma = byInst('ma')
    expect(ma.length).toBeGreaterThanOrEqual(2)
    expect(noSeriesSpansAGap(ma)).toBe(true)
    expect(anyValuedBetween(ma, '2025-04-24', '2026-01-28')).toBe(false)
    // 20 fresh bars after the gap before the MA speaks again: no state crosses it
    const firstAfter = ma.flatMap(valuedDays).filter((d) => d > '2026-01-28').sort()[0]
    const firstSource = byInst('f').flatMap(valuedDays).filter((d) => d > '2026-01-28').sort()[0]
    expect(INDEX.get(firstAfter) - INDEX.get(firstSource)).toBe(19)
  })
})

describe('CELH -- the Q2 2022 golden gap', () => {
  it('⛔⛔ net_income_ttm is valued NOWHERE on 2022-08-10 (the 18.408M must not appear)', () => {
    expect(gapStarts('CELH', 'net_income_ttm')).toContain('2022-08-09')
    const { alive } = draw('CELH', 'net_income_ttm')
    expect(noSeriesSpansAGap(alive)).toBe(true)
    expect(anyValuedBetween(alive, '2022-08-10', '2022-08-10')).toBe(false)
    for (const s of alive) for (const p of s.__data) {
      if (Number.isFinite(p.value)) expect(Math.abs(p.value - 18408000) > 1e5 || p.time > '2022-11-01').toBe(true)
    }
  })

  for (const id of ['eps_diluted_ttm', 'net_margin_ttm', 'roe_ttm']) {
    it(`${id}: every canonical gap is a break`, () => {
      const { alive } = draw('CELH', id)
      expect(noSeriesSpansAGap(alive)).toBe(true)
      expect(anyValuedBetween(alive, '2022-08-10', '2022-08-10')).toBe(false)
    })
  }
})

describe('CAVA -- knowledge time', () => {
  it('⛔ nothing is valued before 2023-08-16, on any metric', () => {
    for (const id of IDS) {
      const { alive } = draw('CAVA', id)
      const first = alive.flatMap(valuedDays).sort()[0]
      if (first) expect(first >= '2023-08-16', `${id} first ${first}`).toBe(true)
    }
  })
})

describe('NVDA -- the 2024-06 10-for-1 split', () => {
  it('⭐ EPS is ONE continuous series through June 2024, with no x10 jump', () => {
    const { alive } = draw('NVDA', 'eps_diluted_ttm')
    expect(alive).toHaveLength(1)
    const pts = alive[0].__data.filter((p) => Number.isFinite(p.value) && p.time >= '2024-01-01' && p.time <= '2024-12-31')
    expect(pts.length).toBeGreaterThan(200)
    for (let k = 1; k < pts.length; k++) {
      const r = pts[k].value / pts[k - 1].value
      expect(r > 0.5 && r < 2, `${pts[k].time} ${pts[k - 1].value} -> ${pts[k].value}`).toBe(true)
    }
  })
})

describe('JPM -- Gross Margin has no drawable data', () => {
  it('⛔ nothing is valued, in any series', () => {
    expect(GOLDEN.JPM.missing).toContain('gross_margin_ttm')
    const { alive } = draw('JPM', 'gross_margin_ttm')
    expect(alive.flatMap(valuedDays)).toEqual([])
  })

  it('its other metrics still draw, gaps broken', () => {
    for (const id of ['revenue_ttm', 'eps_diluted_ttm', 'net_margin_ttm', 'roe_ttm']) {
      const { alive } = draw('JPM', id)
      expect(alive.flatMap(valuedDays).length, id).toBeGreaterThan(1000)
      expect(noSeriesSpansAGap(alive), id).toBe(true)
    }
  })
})

describe('AAPL -- CONTINUITY CONTROL', () => {
  it('⭐ every metric is ONE continuous step series: a filing interval is never a break', () => {
    for (const id of IDS) {
      const { alive } = draw('AAPL', id)
      expect(alive, id).toHaveLength(1)
      const idx = valuedIdx(alive[0])
      expect(idx.length, id).toBeGreaterThan(3000)
      expect(idx.at(-1) - idx[0] + 1, id).toBe(idx.length)          // contiguous from first value to today
    }
  })
})
