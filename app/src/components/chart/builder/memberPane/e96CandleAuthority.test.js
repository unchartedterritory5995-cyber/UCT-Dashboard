// app/src/components/chart/builder/memberPane/e96CandleAuthority.test.js
//
// ─── ⭐⭐ e96 — ONE CANDLE AUTHORITY, BOTH DOORS: a candle or bar is drawn as TradingView draws it, or named ────────
//
// Coordinator ruling R1 (2026-11-22). ⚰️ On master the HOST door drew a computed `plotcandle` / `plotbar` as FOUR LINES
// (open, high, low, close), "Runs" with no note, and hid a candle whose four prices are the chart's own
// (`hiddenReason: 'passthrough'`) beside its other plots without a word (F1, F2). The references below are what the
// TEST writes from each script's own text, never the engine's output.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import * as registry from '../../engine/nativeRegistry'
import { createBinder } from '../../engine/binder'
import { validateDefinition } from '../../engine/defSchema'
import { createFakeChart } from '../../engine/__tests__/fakeChart'
import { memberPaneDefinition, __forceRuntimeLaneForTests } from './memberPaneDefinition'
import { objectHexToPacked } from '../../engine/runtime/colours.js'

afterEach(() => { vi.unstubAllEnvs(); __forceRuntimeLaneForTests(false) })
const panes = () => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
}
const door = (source, id) => { panes(); return memberPaneDefinition({ source, id, name: 'T' }) }
const OHLC = new Set(['candles', 'ohlcBars'])
const shownLines = (d) => d.definition.plots.filter((p) => !p.hidden && p.style === 'line')

const BARS = [
  { t: 1700000000, o: 10, h: 12, l: 9, c: 11, v: 1 },
  { t: 1700086400, o: 11, h: 13, l: 10, c: 10.5, v: 1 },
  { t: 1700172800, o: 10.5, h: 14, l: 8.5, c: 13, v: 1 },
  { t: 1700259200, o: 13, h: 13.5, l: 11, c: 12, v: 1 },
]
const GREEN = '#4CAF50'
const RED = '#F23645'

/** The candle series' bars, as the chart library is handed them. */
function drawnBars(d, id) {
  const { installed, errors } = registry.installUserDefinitions([d.definition])
  expect(errors).toEqual([])
  try {
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    const price = fake.chart.addSeries(fake.LWC.CandlestickSeries, {}, 0)
    binder.sync({
      enabled: true, instances: [{ instanceId: `i:${id}`, defId: installed[0].id, inputs: {} }], registry, bars: BARS,
      adjustTime: (t) => t, plan: { fresh: true }, applyData: (s, data) => s.setData(data),
      resolvePlacement: () => ({ paneIndex: 0, scaleId: 'right', scaleOptions: null }), priceSeries: () => price,
      tf: 'D', newestBarIsForming: false, historyFromListing: true,
    })
    const series = fake.seriesCreated.filter((s) => s !== price)
    const sets = fake.calls.filter((c) => series.some((s) => s.__id === c.id) && c.method === 'setData')
    const withOhlc = sets.map((c) => c.args[0]).filter((data) => Array.isArray(data) && data.some((p) => p && Number.isFinite(p.open)))
    return withOhlc.length ? withOhlc[withOhlc.length - 1] : null
  } finally {
    registry.uninstallUserDefinition(installed[0].id)
  }
}
const hexOfPacked = (c) => c

describe('the host door draws a candle or bar as ONE row, never four lines', () => {
  const HA = '//@version=5\nindicator("ha")\nhaClose = (open + high + low + close) / 4\nvar float haOpen = na\n'
    + 'haOpen := na(haOpen[1]) ? (open + close) / 2 : (haOpen[1] + haClose[1]) / 2\n'
    + 'plotbar(haOpen, math.max(high, haOpen, haClose), math.min(low, haOpen, haClose), haClose, "HA bars", color = haClose > haOpen ? color.green : color.red)\n'
  it('a computed plotbar is one ohlcBars row naming three hidden price columns and a body colour column', () => {
    const d = door(HA, 'u_e96_c1')
    expect(d.ok).toBe(true)
    expect(d.lane || 'host').toBe('host')
    const rows = d.definition.plots.filter((p) => OHLC.has(p.style))
    expect(rows.map((p) => [p.style, p.label])).toEqual([['ohlcBars', 'HA bars']])
    expect(shownLines(d)).toEqual([])
    const row = rows[0]
    for (const key of [...Object.values(row.ohlc), ...Object.values(row.ohlcColors)]) {
      expect(d.definition.plots.find((p) => p.key === key).hidden, key).toBe(true)
    }
    expect(Object.keys(row.ohlcColors)).toEqual(['body'])
    expect(validateDefinition(d.definition).ok).toBe(true)
  })
  it('⭐ the passthrough plotbar (the GAPS probe): its bars are the chart\'s own, coloured bar by bar as the script says', () => {
    const src = '//@version=5\nindicator("probe")\nplotbar(open, high, low, close, "Bars", color=close > open ? color.green : color.red)\n'
    const d = door(src, 'u_e96_c2')
    expect(d.ok, d.reason).toBe(true)
    const data = drawnBars(d, 'c2')
    expect(data && data.map((b) => [b.open, b.high, b.low, b.close])).toEqual(BARS.map((b) => [b.o, b.h, b.l, b.c]))
    const want = BARS.map((b) => (b.c > b.o ? GREEN : RED))
    expect(data.map((b) => String(b.color).toUpperCase().slice(0, 7))).toEqual(want)
  })
})

describe('the one rule withholds by name, never silently', () => {
  it('⭐⭐ F2 — a passthrough candle beside a plot that writes no wick colour is NAMED, and the plot still drawn', () => {
    const src = '//@version=5\nindicator("p", overlay=true)\nm = ta.sma(close, 20)\nplot(m, "SMA")\n'
      + 'plotcandle(open, high, low, close, "PT", color = close > m ? color.green : color.red)\n'
    const d = door(src, 'u_e96_c3')
    expect(d.ok).toBe(true)
    expect(d.definition.plots.filter((p) => !p.hidden).map((p) => p.label)).toEqual(['SMA'])
    expect(d.notes.find((n) => n.name === 'PT').note).toMatch(/^`PT` is not drawn: it does not write `wickcolor =`, and TradingView's default for it is not captured/)
  })
  it('a script whose only drawing is a candle the rule withholds is REFUSED by name (it drew four lines on master)', () => {
    const src = '//@version=4\nstudy("v4")\nplotcandle(open[1], high, low, close, "C", color.green)\n'
    const d = door(src, 'u_e96_c4')
    expect(d.ok).toBe(false)
    expect(d.guard).toBe('pine:candle-not-drawn')
    expect(d.reason).toMatch(/`C` is not drawn: the colour rules of a v4 candle have no capture here/)
  })
  it('a candle its author hid (display.none) is hidden and unnamed, as TradingView draws nothing', () => {
    const src = '//@version=5\nindicator("h")\nplot(close, "c")\nplotcandle(open, high, low, close, "C", color.green, color.green, bordercolor = color.green, display = display.none)\n'
    const d = door(src, 'u_e96_c5')
    expect(d.ok).toBe(true)
    expect(d.definition.plots.some((p) => OHLC.has(p.style))).toBe(false)
    expect(d.notes.some((n) => /is not drawn/.test(n.note || ''))).toBe(false)
  })
})

describe('⛔ the rails', () => {
  it('⭐⭐ F2 CLASS RAIL — over the committed corpus, no row the host hides for presentation (a passthrough candle) leaves the door unnamed', () => {
    panes()
    const ROOT = path.resolve(process.cwd(), '..')
    const dirs = ['corpus/committed', 'tests/fixtures/pine', 'tests/fixtures/pine_community', 'tests/fixtures/pine_multiplot']
    const files = dirs.flatMap((d) => (fs.existsSync(path.join(ROOT, d)) ? fs.readdirSync(path.join(ROOT, d)) : [])
      .filter((f) => f.endsWith('.pine')).map((f) => path.join(ROOT, d, f)))
    expect(files.length).toBeGreaterThan(200)
    const gaps = []
    let candles = 0
    for (const f of files) {
      const source = fs.readFileSync(f, 'utf8')
      if (!/plot(candle|bar)\s*\(/.test(source)) continue
      const d = memberPaneDefinition({ source, id: 'u_e96_rail', name: 'rail' })
      if (!d.ok || d.lane === 'runtime') continue
      const outs = (d.translation && d.translation.outputs) || []
      const ohlcRows = d.definition.plots.filter((p) => OHLC.has(p.style))
      const ord = new Map()
      for (const c of outs) {
        if (!c || !c.candle) continue
        ord.set(c.kind, (ord.get(c.kind) || 0) + 1)
        if (c.hiddenReason !== 'passthrough' || c.candle.display === 'display.none') continue
        candles += 1
        const name = c.candle.title || `${c.kind} ${ord.get(c.kind)}`
        const named = d.notes.some((n) => n.name === name && / is not drawn: /.test(n.note))
        const drawn = c.candle.title ? ohlcRows.some((p) => p.label === c.candle.title) : ohlcRows.length > 0
        if (!drawn && !named) gaps.push(`${path.basename(f)}: ${name}`)
      }
    }
    expect(candles, 'non-vacuity: the corpus holds passthrough candles').toBeGreaterThan(0)
    expect(gaps).toEqual([])
  }, 600_000)
  it('ONE AUTHORITY — the candle rule is written once, and both doors ask it', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/components/chart/builder/memberPane/memberPaneDefinition.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    expect(src.match(/the colour rules of a v/g) || []).toHaveLength(1)
    expect(src).toMatch(/function runtimeCandlePresentation[\s\S]{0,400}return candleRule\(/)
    expect(src).toMatch(/function hostCandlePresentation[\s\S]{0,400}return candleRule\(/)
  })
  it('the packed colour is the runtime lane\'s own byte order', () => {
    expect(hexOfPacked(objectHexToPacked('#4CAF50'))).toBe(objectHexToPacked('#4caf50'))
  })
})
