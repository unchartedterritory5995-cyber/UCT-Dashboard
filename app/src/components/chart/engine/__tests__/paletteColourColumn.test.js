// app/src/components/chart/engine/__tests__/paletteColourColumn.test.js
//
// ─── ⭐⭐ AN N-WAY PINE COLOUR CHAIN: A PALETTE AND AN INDEX COLUMN ──────────
//
//     iff_2 = close < TS ? color.red : color.black
//     Color = close > TS ? color.green : iff_2
//     plot(TS, color = Color)
//
// ATR Trailing Stoploss, measured against a live TradingView capture on
// 2026-09-27: the line is green, red OR black, and a plot carrying two colours
// (`colorUp`/`colorDown`) could only draw it in the pane's default gold —
// 0 of 568 bars right. The chain is now carried as `colorPalette` plus a hidden
// column holding each bar's palette index; after the change 568 of 568 agree
// (`vendorHarness.liveCaptures.test.js`).
//
// ⛔ LIKE `dynamicColourColumn.test.js`, THIS ASSERTS THE POINTS THE RENDERER IS
// HANDED — a palette that resolves and never reaches `setData` would be
// indistinguishable from working at every earlier layer.
import { describe, it, expect } from 'vitest'
import { columnColorsForPlot } from '../pool'
import { createBinder } from '../binder'
import { validateDefinition } from '../defSchema'
import { createFakeChart } from './fakeChart'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'

const G = '#4CAF50'
const R = '#FF5252'
const K = '#363A45'
const BARS = Array.from({ length: 7 }, (_, i) => ({ t: 1700000000 + i * 60, c: 10 + i }))

const DEF = {
  id: 'u_pal', schemaVersion: 2, label: 'Pal',
  inputs: [],
  plots: [
    { key: 'value', label: 'Value', style: 'line', legend: { decimals: 2 },
      colorMode: 'column:idx', colorPalette: [G, R, K] },
    { key: 'idx', label: 'Idx', style: 'line', hidden: true, legend: { decimals: 0 } },
  ],
}
// idx: 0,1,2,NaN,3 (outside the palette),1.5 (not an index),0
const COLUMNS = { value: [1, 2, 3, 4, 5, 6, 7], idx: [0, 1, 2, NaN, 3, 1.5, 0] }

function pointsDrawn(def = DEF, columns = COLUMNS) {
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  binder.sync({
    enabled: true,
    instances: [{ instanceId: 'inst:u_pal:1', defId: def.id, inputs: {} }],
    registry: {
      getDefinition: (id) => (id === def.id ? def : null),
      computeFor: () => columns,
      hasAnyFinite: (col) => Array.isArray(col) && col.some(Number.isFinite),
      columnKeys: (d) => (d.plots || []).map((p) => p.key),
    },
    bars: BARS,
    adjustTime: (t) => t,
    plan: { fresh: true },
    applyData: (series, data) => series.setData(data),
    resolvePlacement: () => ({ paneIndex: 1, scaleId: 'u_pal', scaleOptions: {} }),
  })
  const setDatas = fake.calls.filter((c) => c.method === 'setData')
  expect(setDatas.length, 'exactly one series should be drawn').toBe(1)
  return setDatas[0].args[0]
}

describe('a palette plot draws palette[column[i]] per point', () => {
  it('⭐ each bar takes the palette entry its index column names', () => {
    const pts = pointsDrawn()
    expect(pts.map((p) => p.color)).toEqual([G, R, K, undefined, undefined, undefined, G])
  })

  it('⛔ an index outside the palette, a fraction, or na gets NO colour — never a neighbour\'s', () => {
    const pts = pointsDrawn()
    expect(pts[3].color).toBeUndefined()
    expect(pts[4].color).toBeUndefined()
    expect(pts[5].color).toBeUndefined()
  })

  it('the resolver hands back the palette; a two-colour plot still resolves as before', () => {
    expect(columnColorsForPlot(DEF.plots[0])).toMatchObject({ key: 'idx', palette: [G, R, K] })
    expect(columnColorsForPlot({ colorMode: 'column:c', colorUp: G, colorDown: R }))
      .toEqual({ key: 'c', up: G, down: R })
  })
})

describe('defSchema — a palette is a legal way to say what a column mode alternates between', () => {
  // ⭐ The REAL document the member door writes, so this is a full definition.
  const SRC = [
    '//@version=5', "indicator('chain')", 'm = ta.sma(close, 10)',
    'c2 = close < m ? color.red : color.black', 'c = close > m ? color.green : c2',
    "plot(m, 'MA', color = c)", '',
  ].join('\n')
  const base = () => JSON.parse(JSON.stringify(memberPaneDefinition({ source: SRC, id: 'u_s', name: 's' }).definition))
  const errs = (def) => (validateDefinition(def).errors || [])
  const withPlot0 = (patch) => { const d = base(); d.plots[0] = { ...d.plots[0], ...patch }; return d }
  it('⭐ a palette plot validates', () => {
    expect(errs(base())).toEqual([])
  })
  it('⛔ a palette of one colour, or of a non-colour, is refused', () => {
    expect(errs(withPlot0({ colorPalette: [G] })).join('\n')).toMatch(/colorPalette/)
    expect(errs(withPlot0({ colorPalette: [G, 3] })).join('\n')).toMatch(/colorPalette/)
  })
  it('⛔ a palette AND colorUp/colorDown on one plot is ambiguous, so refused', () => {
    expect(errs(withPlot0({ colorUp: G, colorDown: R })).join('\n')).toMatch(/not both/)
  })
  it('⛔ CONTROL — a column mode with neither is still refused', () => {
    const d = base(); delete d.plots[0].colorPalette
    expect(errs(d).join('\n')).toMatch(/colorUp and colorDown/)
  })
})

describe('the member door carries a three-colour chain', () => {
  const SRC = [
    '//@version=5',
    "indicator('chain')",
    'm = ta.sma(close, 10)',
    'c2 = close < m ? color.red : color.black',
    'c = close > m ? color.green : c2',
    "plot(m, 'MA', color = c)",
    '',
  ].join('\n')

  it('⭐ as colorMode column:<key> + colorPalette, the index column hidden and derived', () => {
    const d = memberPaneDefinition({ source: SRC, id: 'u_chain', name: 'chain' })
    expect(d.ok, d.reason).toBe(true)
    const plot = d.definition.plots[0]
    expect(plot.colorPalette).toEqual(['#4CAF50', '#FF5252', '#363A45'])
    expect(plot.colorUp).toBeUndefined()
    const key = plot.colorMode.slice('column:'.length)
    const idx = d.definition.plots.find((p) => p.key === key)
    expect(idx && idx.hidden).toBe(true)
    expect(validateDefinition(d.definition).errors || []).toEqual([])
  })

  it('⛔ a chain with a leaf this grammar cannot fold carries NO palette', () => {
    const src = SRC.replace("c2 = close < m ? color.red : color.black",
      "c2 = close < m ? color.from_gradient(close, 0, 1, color.red, color.blue) : color.black")
    const d = memberPaneDefinition({ source: src, id: 'u_chain2', name: 'chain2' })
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.plots[0].colorPalette).toBeUndefined()
  })
})
