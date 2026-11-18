// When a header stat's menu closes, focus returns to the chart (2026-11-18), MOUNTED: the real ChartPane, the real
// stat row and the real HeaderStatMenu around the real StockChart (lightweight-charts and the live feeds stubbed).
//
// A header stat became a focusable button on 11-17 and its menu hands focus back to the stat on Escape. Measured on
// production: with focus left on a stat, `t` armed the trendline tool and `a` the arrow tool, where the same key on
// the chart opens ticker search. So a member who restyled a stat and then typed a ticker got drawing tools.
// The pane's rule for every chart menu is that focus returns to the chart region when it closes.
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  const series = {
    setData: () => {}, update: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
    detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
  }
  const chart = {
    addSeries: () => series, addCandlestickSeries: () => series, addHistogramSeries: () => series,
    addLineSeries: () => series, addAreaSeries: () => series, addBarSeries: () => series,
    removeSeries: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => ({
      applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {}, getVisibleLogicalRange: () => null,
      setVisibleRange: () => {}, scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: () => {},
      unsubscribeVisibleLogicalRangeChange: () => {}, timeToCoordinate: () => 0, coordinateToTime: () => null,
      resetTimeScale: () => {}, options: () => ({}), width: () => 600, getVisibleRange: () => null,
      subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
    }),
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {}, subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    ...real,
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 }, LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {}, AreaSeries: {}, BarSeries: {}, BaselineSeries: {}, createSeriesMarkers: () => ({ setMarkers: () => {}, detach: () => {} }),
  }
})
vi.mock('../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../../../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../../../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))
vi.mock('../../../hooks/usePreferences', async (importOriginal) => ({ ...(await importOriginal()), default: () => ({ prefs: {}, setPref: () => {}, loading: false }) }))
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({ default: () => ({ data: null, isLoading: false }) }))

const openWith = vi.fn()
vi.mock('../SymbolSearch', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return { default: forwardRef((_props, ref) => { useImperativeHandle(ref, () => ({ openWith: (...a) => openWith(...a) })); return <span>search</span> }) }
})

const { default: ChartPane } = await import('./ChartPane')

const N = 40
const bars = Array.from({ length: N }, (_, i) => ({ t: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), o: 10 + i, h: 11 + i, l: 9 + i, c: 10 + i, v: 1000 }))
const stored = {
  header: {
    fields: ['cx:c1'],
    customStats: [{ id: 'c1', defId: 'movingAverage', plotKey: 'ma', inputs: { maType: 'sma', period: 5 }, name: 'SMA 5' }],
  },
}

beforeEach(() => {
  cleanup()
  openWith.mockClear()
  vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve({ ok: true, json: () => Promise.resolve(String(url).includes('/api/bars') ? { bars } : {}) })))
})
afterEach(() => { vi.unstubAllGlobals() })

const regionOf = (container) => container.querySelector('[role="region"][tabindex="0"]')
const menuOf = () => document.querySelector('[role="dialog"]')

/** Mount the pane, wait for its stat, press it the way a member does (focus lands on it, then the click), wait for the menu. */
async function openStatMenu() {
  const utils = render(<ChartPane sym="AAPL" tf="D" onTfChange={() => {}} onSymbolChange={() => {}} stored={stored} onStore={() => {}} />)
  const stat = await vi.waitFor(() => {
    const el = utils.container.querySelector('[data-stat-item="cx:c1"]')
    expect(el).toBeTruthy()
    return el
  }, { timeout: 8000 })
  act(() => { stat.focus() })
  fireEvent.click(stat)
  await vi.waitFor(() => expect(menuOf()).toBeTruthy(), { timeout: 8000 })
  return { ...utils, stat, region: regionOf(utils.container) }
}

describe('when the menu of a header stat closes, focus returns to the chart', () => {
  it('Escape: focus is on the chart region, and a typed letter opens ticker search', async () => {
    const { stat, region } = await openStatMenu()
    expect(region.getAttribute('aria-label')).toMatch(/price chart$/)
    expect(document.activeElement).not.toBe(region)                         // the premise: the menu took focus
    const asked = vi.spyOn(region, 'focus')
    fireEvent.keyDown(document, { key: 'Escape' })
    await vi.waitFor(() => expect(menuOf()).toBeNull())
    await vi.waitFor(() => expect(document.activeElement).toBe(region))
    expect(document.activeElement).not.toBe(stat)
    expect(asked).toHaveBeenCalledTimes(1)
    // and the key a drawing tool is bound to is a ticker character first
    fireEvent.keyDown(document.activeElement, { key: 't' })
    expect(openWith).toHaveBeenCalledWith('t')
  })

  it('pressing the same stat again closes the menu and focus is on the chart region', async () => {
    const { stat, region } = await openStatMenu()
    act(() => { stat.focus() })
    fireEvent.click(stat)
    await vi.waitFor(() => expect(menuOf()).toBeNull())
    await vi.waitFor(() => expect(document.activeElement).toBe(region))
  })

  it('CONTROL: a control the member pressed elsewhere keeps the focus', async () => {
    const { region } = await openStatMenu()
    const elsewhere = document.createElement('input')
    document.body.appendChild(elsewhere)
    try {
      act(() => { elsewhere.focus() })
      fireEvent.mouseDown(elsewhere)                                          // an outside press closes the menu
      await vi.waitFor(() => expect(menuOf()).toBeNull())
      await act(async () => { await Promise.resolve() })
      expect(document.activeElement).toBe(elsewhere)
      expect(document.activeElement).not.toBe(region)
    } finally { elsewhere.remove() }
  })

  it('CONTROL: "Add a stat…" hands over to Chart Settings, and the chart does not take the focus back', async () => {
    const { region } = await openStatMenu()
    const add = [...menuOf().querySelectorAll('button')].find((x) => /Add a stat/.test(x.textContent))
    expect(add).toBeTruthy()
    // the chart is never even ASKED to take focus: Chart Settings is opening in the same step, and
    // a focus taken here and handed back a moment later is a flicker a screen reader announces
    const asked = vi.spyOn(region, 'focus')
    fireEvent.click(add)
    await vi.waitFor(() => expect([...document.querySelectorAll('[role="dialog"]')].some((d) => /Chart settings|Header/i.test(d.getAttribute('aria-label') || d.textContent || ''))).toBe(true), { timeout: 8000 })
    await act(async () => { await Promise.resolve() })
    expect(document.activeElement).not.toBe(region)
    expect(asked).not.toHaveBeenCalled()
  })

  it('CONTROL: a pane whose menu never opened does not take focus on mount', async () => {
    const { container } = render(<ChartPane sym="AAPL" tf="D" onTfChange={() => {}} onSymbolChange={() => {}} stored={stored} onStore={() => {}} />)
    await vi.waitFor(() => expect(container.querySelector('[data-stat-item="cx:c1"]')).toBeTruthy(), { timeout: 8000 })
    expect(document.activeElement).not.toBe(regionOf(container))
  })
})
