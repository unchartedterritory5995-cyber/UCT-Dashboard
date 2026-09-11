import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'

// The "Pre"/"Post" word beside the orange extended-hours price label.
//
// It used to be the price line's `title`. lightweight-charts paints a title on
// the PANE, to the LEFT of the axis label, so on a phone "Post" sat over the
// newest candles (owner report, 2026-09-11). The word is now a DOM chip
// stacked ABOVE the label ON the price scale, and the price line carries no
// title. This file pins both halves: the library never gets the word, and the
// member still sees it.

const created = []
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
    paneSize: () => ({ width: 600, height: 300 }),
    timeScale: () => ({
      applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {}, getVisibleLogicalRange: () => null,
      setVisibleRange: () => {}, scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: () => {},
      unsubscribeVisibleLogicalRangeChange: () => {}, timeToCoordinate: () => 0, coordinateToTime: () => null,
      resetTimeScale: () => {}, options: () => ({}), width: () => 600,
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
  created.length = 0
  vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(String(url).includes('/api/bars') ? { bars } : {}),
  })))
})

const { default: StockChart } = await import('./StockChart')

describe('the Pre/Post word sits on the price scale, not on the pane', () => {
  it('creates the orange ext price line WITHOUT a pane title', async () => {
    render(<StockChart sym="AAPL" tf="5" sessionView="regular" />)
    await vi.waitFor(() => {
      expect(created.some((l) => l.options().color === '#f5a623')).toBe(true)
    }, { timeout: 4000 })
    const ext = created.filter((l) => l.options().color === '#f5a623')
    for (const l of ext) expect(l.options().title).toBe('')
    // NON-VACUITY: it is the ext tag (axis chip only, no line), not some other line.
    expect(ext[0].options().lineVisible).toBe(false)
    expect(ext[0].options().axisLabelVisible).toBe(true)
  })

  it('renders "Post" as a chip the SAME BOX as the price label, stacked above it', async () => {
    render(<StockChart sym="AAPL" tf="5" sessionView="regular" />)
    const chip = await screen.findByTestId('session-ext-chip', {}, { timeout: 4000 })
    expect(chip.textContent).toBe('Post')
    await vi.waitFor(() => expect(chip.style.display).toBe('block'), { timeout: 4000 })
    // Mirrors lightweight-charts' label geometry at fontSize 11 (the default):
    //   x = plot width (600) + the 1px axis border
    expect(chip.style.left).toBe('601px')
    //   width = border 1 + padding 2×(11/12×5) + ceil(text "101.25" = 6 chars × 6px stub) + tick 5
    const expectedW = Math.round(1 + 2 * (11 / 12) * 5 + 36 + 5)
    expect(chip.style.width).toBe(`${expectedW}px`)
    // NOT the whole price-scale column (58px in this harness) — that ran off the phone.
    expect(parseFloat(chip.style.width)).toBeLessThan(58)
    //   height = 11 + 2 × (2.5/12 × 11), i.e. the label's own height
    expect(chip.style.height).toBe(`${Math.round(11 + 2 * (2.5 / 12) * 11)}px`)
    // priceToCoordinate → 120: the label is centred on 120 and the chip sits ABOVE it.
    expect(parseFloat(chip.style.top) + parseFloat(chip.style.height)).toBeLessThanOrEqual(120 - 7)
    // It must never intercept the member's finger — the scale under it drags.
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
