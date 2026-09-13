import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'

// The "Pre"/"Post" word beside the orange extended-hours price label.
//
// It used to be the price line's `title`. lightweight-charts paints a title on
// the PANE, to the LEFT of the axis label, so on a phone "Post" sat over the
// newest candles (owner report, 2026-09-11). The word became a DOM chip on the
// price scale, and the price line carries no title.
//
// ⭐ THEN IT WENT BACK BESIDE THE PRICE (owner report, same day, later): stacked,
// "Post" and "265.34" read as two unrelated values on a price axis, which is the
// worst possible place for an ambiguous number. The word and its price are ONE
// reading and must sit on ONE row.
//
// ⚠️ BOTH REPORTS ARE STILL TRUE, so the layout branches on plot width: beside the
// label where there are pixels to spare, stacked above it where going left would
// put the word back over the candles. This file pins BOTH branches — a
// fixed-width harness would have let one of them rot.

const created = []
// Hoisted so the (hoisted) module mock can read it and a test can steer it: the
// chip's layout BRANCHES on plot width, so a fixed-width harness could only ever
// exercise one of the two behaviours.
const h = vi.hoisted(() => ({ plotW: 600 }))
vi.mock('lightweight-charts', async (importOriginal) => {
  const actual = await importOriginal()
  const mkLine = (opts) => {
    const o = { ...opts }
    const line = { options: () => o, applyOptions: (p) => Object.assign(o, p) }
    created.push(line)
    return line
  }
  const series = {
    setData: () => {}, update: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: mkLine, removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
    detachPrimitive: () => {}, priceToCoordinate: () => 120, coordinateToPrice: () => 0, options: () => ({}),
    getPane: () => ({ paneIndex: () => 0 }),
    priceFormatter: () => ({ format: (p) => Number(p).toFixed(2) }),
  }
  const chart = {
    addSeries: () => series, addCandlestickSeries: () => series, addHistogramSeries: () => series,
    addLineSeries: () => series, addAreaSeries: () => series, addBarSeries: () => series,
    removeSeries: () => {}, applyOptions: () => {}, priceScale: (id) => ({ applyOptions: () => {}, width: () => (id === 'left' ? 0 : 58) }),
    paneSize: () => ({ width: h.plotW, height: 300 }),
    timeScale: () => ({
      applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {}, getVisibleLogicalRange: () => null,
      setVisibleRange: () => {}, scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: () => {},
      unsubscribeVisibleLogicalRangeChange: () => {}, timeToCoordinate: () => 0, coordinateToTime: () => null,
      resetTimeScale: () => {}, options: () => ({}), width: () => h.plotW,
      subscribeSizeChange: () => {}, unsubscribeSizeChange: () => {},
      subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
    }),
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {}, subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  // Real enums (LineType, ColorType, …); only the canvas-touching factories are stubbed.
  return { ...actual, createChart: () => chart, createSeriesMarkers: () => ({ setMarkers: () => {} }) }
})

// Post-market, with a live extended-hours print on the symbol.
vi.mock('../utils/extSession', () => ({
  getExtSession: () => ({ session: 'post', anchorDate: '2026-09-10' }),
  getExtSessionCached: () => ({ session: 'post', anchorDate: '2026-09-10' }),
  anchorNoonSec: () => 0,
  lastAnchorIdx: () => -1,
}))
vi.mock('../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: { AAPL: { price: 100, ext_session: 'post', ext_price: 101.25 } }, status: 'idle' }),
}))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))

const bars = Array.from({ length: 40 }, (_, i) => ({
  t: 1757500000 + i * 300, o: 100, h: 101, l: 99, c: 100.5, v: 1000,
}))

beforeEach(() => {
  cleanup()
  h.plotW = 600
  created.length = 0
  vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(String(url).includes('/api/bars') ? { bars } : {}),
  })))
})

const { default: StockChart } = await import('./StockChart')

describe('the Pre/Post word sits on the price scale, not on the pane', () => {
  it('gives the orange ext price line the WORD as its title on a wide plot', async () => {
    // ⭐ LWC's axis STACKS labels that would overlap, so the orange ext label is often
    // drawn somewhere other than priceToCoordinate(extPrice) — any time the ext price
    // is within a label height of the regular close, which post-market is most of the
    // time. Positioning a DOM chip ourselves put "Post" on the GREEN regular-close
    // label instead of the orange one it names. The library owns that layout; give it
    // the word and it stays attached through the displacement.
    render(<StockChart sym="AAPL" tf="5" sessionView="regular" />)
    await vi.waitFor(() => {
      expect(created.some((l) => l.options().color === '#f5a623')).toBe(true)
    }, { timeout: 4000 })
    const ext = created.filter((l) => l.options().color === '#f5a623')
    for (const l of ext) expect(l.options().title).toBe('Post')
    expect(ext[0].options().lineVisible).toBe(false)
    expect(ext[0].options().axisLabelVisible).toBe(true)
    // …and the DOM chip stays out of the way entirely.
    expect(screen.queryByTestId('session-ext-chip')).toBeNull()
  })

  it('falls back to the stacked DOM chip on a narrow plot — the phone fix holds', async () => {
    // ⛔ The regression this guards: a `title` is painted on the PANE, hugging the axis
    // from the left, so on a phone it covers the newest candles. Below the threshold the
    // library must NOT get the word; the chip renders on the scale instead.
    h.plotW = 380
    render(<StockChart sym="AAPL" tf="5" sessionView="regular" />)
    const chip = await screen.findByTestId('session-ext-chip', {}, { timeout: 4000 })
    expect(chip.textContent).toBe('Post')
    await vi.waitFor(() => expect(chip.style.display).toBe('block'), { timeout: 4000 })
    const ext = created.filter((l) => l.options().color === '#f5a623')
    for (const l of ext) expect(l.options().title).toBe('')
    // Starts AT the axis cell (no leftward overhang into the candles) …
    expect(parseFloat(chip.style.left)).toBe(381)
    // … and sits entirely ABOVE the label centred on 120.
    expect(parseFloat(chip.style.top) + parseFloat(chip.style.height)).toBeLessThanOrEqual(120 - 7)
    expect(chip.style.pointerEvents).toBe('none')
  })

  it('does not render the chip when price labels are switched off', async () => {
    const drawn = []
    render(<StockChart sym="AAPL" tf="5" sessionView="regular" settingsOverride={{ showPriceLabels: false }}
      onDrawnBarCount={(n) => drawn.push(n)} />)
    // NON-VACUITY: the chart really drew the bars (the moment the chip would mount).
    await vi.waitFor(() => expect(drawn[drawn.length - 1]).toBe(bars.length), { timeout: 4000 })
    await new Promise((r) => setTimeout(r, 60))
    expect(screen.queryByTestId('session-ext-chip')).toBeNull()
    // And no session price line was created either — the one toggle governs both.
    expect(created.some((l) => l.options().color === '#f5a623')).toBe(false)
  })
})
