// Lane FIN-A11Y round 2, item 3. The replay window follows the theme, but the chart inside it
// was created with fixed dark colours (BarReplay.jsx is the Notebook's own lightweight-charts
// instance, not StockChart), so in the light theme it was a dark chart inside a light panel.
// The colours are now read from the theme's tokens when the chart is created; where a token
// cannot be read (no stylesheet, as in a unit test) the old literals are the fallback.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import BarReplay, { replayChartColors } from './BarReplay'

const made = vi.hoisted(() => ({ chart: [], series: [], lines: [] }))
vi.mock('lightweight-charts', () => ({
  createChart: (_el, opts) => {
    made.chart.push(opts)
    return {
      addSeries: (_k, o) => { made.series.push(o); return { setData: () => {}, update: () => {}, createPriceLine: (l) => made.lines.push(l), removePriceLine: () => {} } },
      timeScale: () => ({ setVisibleRange: () => {} }),
      remove: () => {},
    }
  },
  createSeriesMarkers: () => ({ setMarkers: () => {} }),
  CandlestickSeries: {},
  LineStyle: { Dashed: 2 },
  ColorType: { Solid: 'solid' },
}))

const BARS = [
  { t: '2026-08-03', o: 100, h: 102, l: 99, c: 101 },
  { t: '2026-08-04', o: 101, h: 105, l: 100, c: 104 },
]
const LIGHT = {
  '--bg-surface': '#f4f5f6', '--text-muted': '#57606a', '--border': '#e3e5e7',
  '--gain': '#1c7a45', '--loss': '#b12f2f', '--accent': '#7a5c16',
}
const root = document.documentElement
const setTheme = (vars) => { for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v) }
const clearTheme = () => { for (const k of Object.keys(LIGHT)) root.style.removeProperty(k) }

beforeEach(() => {
  made.chart.length = 0; made.series.length = 0; made.lines.length = 0
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ bars: BARS }) }))
})
afterEach(() => { clearTheme(); vi.restoreAllMocks() })

const open = async () => {
  render(<BarReplay symbol="NVDA" tf="D" title="NVDA replay" autoplay={false} onClose={() => {}}
    priceLines={[{ price: 100, title: 'entry' }]} />)
  await screen.findByLabelText('Replay position')
}

describe('the replay chart follows the theme', () => {
  it('in the light theme the chart is drawn in the light tokens', async () => {
    setTheme(LIGHT)
    await open()
    const o = made.chart[0]
    expect(o.layout.background.color).toBe('#f4f5f6')
    expect(o.layout.textColor).toBe('#57606a')
    expect(o.grid.vertLines.color).toBe('#e3e5e7')
    expect(o.grid.horzLines.color).toBe('#e3e5e7')
    expect(o.timeScale.borderColor).toBe('#e3e5e7')
    expect(o.rightPriceScale.borderColor).toBe('#e3e5e7')
    expect(made.series[0]).toMatchObject({
      upColor: '#1c7a45', downColor: '#b12f2f', wickUpColor: '#1c7a45', wickDownColor: '#b12f2f',
    })
    // a price line with no colour of its own takes the theme's accent
    expect(made.lines[0].color).toBe('#7a5c16')
  })

  it('with no token to read it keeps the colours it had (so nothing renders unstyled)', async () => {
    await open()
    expect(made.chart[0].layout.background.color).toBe('#0b0b0d')
    expect(made.series[0].upColor).toBe('#22c55e')
    expect(made.lines[0].color).toBe('#c9a84c')
  })

  it('a line that brings its own colour keeps it', async () => {
    setTheme(LIGHT)
    render(<BarReplay symbol="NVDA" tf="D" title="NVDA replay" autoplay={false} onClose={() => {}}
      priceLines={[{ price: 100, title: 'stop', color: '#ef4444' }]} />)
    await screen.findByLabelText('Replay position')
    expect(made.lines[0].color).toBe('#ef4444')
    expect(replayChartColors().accent).toBe('#7a5c16')
  })
})
