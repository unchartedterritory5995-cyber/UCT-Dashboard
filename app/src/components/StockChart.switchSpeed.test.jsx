// app/src/components/StockChart.switchSpeed.test.jsx
//
// ─── THE REAL StockChart HANDS ITS PAINT RECORD TO THE SWITCH-SPEED INSTRUMENT UNDER ITS HOST'S IDENTITY (2026-11-23) ───
//
// lib/switchSpeed.js knows a chart has drawn a new symbol from that chart's own paint record (chart/paintLog.recordPaint,
// made in updateChart: the pass that hands the rows to the series), and knows WHICH chart of a linked group it was from
// the identity the chart's host provides (PaintMemberContext; ChartWidget provides the token its handoff registered).
// The other rails stand a small component in for the chart. This one holds the real StockChart to the same contract:
// the production path (the bar store on), lightweight-charts stubbed (the switch-renders harness).
//   · under an identity: its full pass WITH bars reaches the listener with that identity and the symbol on show;
//   · with no identity (every other host of StockChart): the pass is made, and the listener hears nothing.
import React from 'react'
import { describe, it, expect, vi, afterAll } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'
import { loadWithBarStore } from '../testing/barStoreModes'

vi.mock('../lib/realtimeBarsGate', () => ({ realtimeBarsEnabled: () => false }))
vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  const make = () => ({
    setData: () => {}, update: () => {}, data: () => [],
    applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    createPriceLine: () => ({ applyOptions: () => {} }), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
    detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
    getPane: () => ({ paneIndex: () => 0, getHeight: () => 300, getHTMLElement: () => document.createElement('div'), getSeries: () => [] }),
    priceFormatter: () => ({ format: (x) => String(x) }), moveToPane: () => {}, seriesOrder: () => 0, setSeriesOrder: () => {},
    dataByIndex: () => null, barsInLogicalRange: () => null,
    subscribeDataChanged: () => {}, unsubscribeDataChanged: () => {},
  })
  const chart = {
    addSeries: () => make(),
    addCandlestickSeries: () => make(), addHistogramSeries: () => make(),
    addLineSeries: () => make(), addAreaSeries: () => make(), addBarSeries: () => make(),
    removeSeries: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => ({
      applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {}, getVisibleLogicalRange: () => null,
      setVisibleRange: () => {}, scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: () => {},
      unsubscribeVisibleLogicalRangeChange: () => {}, timeToCoordinate: () => 0, coordinateToTime: () => null,
      resetTimeScale: () => {}, options: () => ({}), width: () => 600, logicalToCoordinate: () => 0,
      subscribeSizeChange: () => {}, unsubscribeSizeChange: () => {},
      subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
    }),
    paneSize: () => ({ width: 600, height: 300 }),
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {}, subscribeClick: () => {}, unsubscribeClick: () => {},
    subscribeDblClick: () => {}, unsubscribeDblClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div'), getSeries: () => [], setHeight: () => {}, setStretchFactor: () => {}, getStretchFactor: () => 1, paneIndex: () => 0 }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
    chartElement: () => document.createElement('div'),
  }
  return { ...real, createChart: () => chart, createSeriesMarkers: () => ({ setMarkers: () => {} }) }
})
vi.mock('../utils/barsIDB', async (orig) => ({ ...(await orig()), idbGet: async () => null, idbPut: async () => {}, idbPutMonotonic: async () => {} }))
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))

// a Saturday: the newest daily bar is settled and nothing forms
const clock = pinWallClock('2026-11-14T16:00:00Z')
afterAll(() => clock.restore())
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))

const rowsFor = (k) => {
  const out = []
  const d = new Date(Date.UTC(2021, 0, 4))
  let i = 0
  while (d.toISOString().slice(0, 10) <= '2026-11-13') {
    const iso = d.toISOString().slice(0, 10)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) {
      const c = 40 * k + Math.sin(i / 11) * 6 * k + i * 0.01
      out.push({ t: iso, o: c - 0.5, h: c + 1.5, l: c - 1.7, c, v: 1e6 + ((i * 7919 * k) % 500000) })
      i++
    }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
const BARS = { AAA: rowsFor(1), BBB: rowsFor(2) }
const noop = () => {}

describe('the real StockChart and the paint listener', () => {
  it('under an identity its full pass with bars reaches the listener with that identity; with none it hands nothing', async () => {
    vi.stubGlobal('requestIdleCallback', (cb) => setTimeout(() => cb({ timeRemaining: () => 10, didTimeout: false }), 5))
    vi.stubGlobal('cancelIdleCallback', (h) => clearTimeout(h))
    vi.stubGlobal('fetch', vi.fn((url) => {
      const m = /\/api\/bars\/([A-Z]+)/.exec(String(url))
      if (!m || !BARS[m[1]]) return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => ({}) })
      const body = { ticker: m[1], tf: 'D', bars: BARS[m[1]], newest_bar_is_forming: false }
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => body })
    }))
    const M = await loadWithBarStore(true, async () => ({
      StockChart: (await import('./StockChart')).default,
      paintLog: await import('./chart/paintLog'),
    }))
    expect(M.__barStore).toBe(true)
    const { PaintMemberContext, onChartPaint } = M.paintLog
    const heard = []
    onChartPaint((member, sym, bars, mode) => { heard.push({ member, sym, bars, mode }) })
    try {
      const me = { widget: 1 }
      delete window.__uctPaints
      render(
        <PaintMemberContext.Provider value={me}>
          <M.StockChart sym="AAA" tf="D" backgroundWarm={false} onSettingsPersist={noop} alwaysShowLegend />
        </PaintMemberContext.Provider>,
      )
      await wait(800)
      const drawn = heard.filter((p) => p.mode === 'full' && p.bars > 0)
      expect(drawn.length, `passes heard: ${JSON.stringify(heard.map((p) => [p.sym, p.bars, p.mode]))}`).toBeGreaterThan(0)
      expect(drawn.every((p) => p.member === me && p.sym === 'AAA')).toBe(true)
      expect(heard.every((p) => p.member === me)).toBe(true)
      cleanup()

      // no identity (every other host of StockChart): the same pass is made, and the listener hears nothing
      heard.length = 0
      delete window.__uctPaints
      render(<M.StockChart sym="BBB" tf="D" backgroundWarm={false} onSettingsPersist={noop} alwaysShowLegend />)
      await wait(800)
      expect((window.__uctPaints || []).some((p) => p.sym === 'BBB' && p.mode === 'full' && p.bars > 0), 'the chart did make its pass').toBe(true)
      expect(heard).toEqual([])
    } finally {
      onChartPaint(null)
      cleanup()
    }
  }, 30000)
})
