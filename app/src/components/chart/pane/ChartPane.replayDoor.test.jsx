// chartReplay.playback, MOUNTED: the real ChartPane around the real StockChart (lightweight-charts and the live feeds
// stubbed). The UCT Agent's door — ChartPane.viewDo('replay', …) → StockChart onDateNavApi.replay — runs the Replay /
// Time Machine bar's OWN handlers, the toolbar's buttons and the door move the SAME state, and getDateMeta().replay
// (the read-back the Agent's receipt waits on) sees each change only once StockChart's state has it.
import { createRef } from 'react'
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react'
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

const { default: ChartPane } = await import('./ChartPane')

// synthetic daily bars (no market values: flat placeholders)
const N = 40
const bars = Array.from({ length: N }, (_, i) => ({ t: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), o: 10, h: 11, l: 9, c: 10, v: 1000 }))

beforeEach(() => {
  cleanup()
  vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve({ ok: true, json: () => Promise.resolve(String(url).includes('/api/bars') ? { bars } : {}) })))
})
afterEach(() => { vi.unstubAllGlobals() })

async function mount(stockChartProps = { showDrawingTools: true }) {
  const pane = createRef()
  render(<ChartPane ref={pane} sym="AAPL" tf="D" onTfChange={() => {}} stockChartProps={stockChartProps} />)
  // the door is published once StockChart's date-nav API exists, and the replay reads its bars
  await vi.waitFor(() => expect(pane.current?.getDateMeta?.()?.replay?.total).toBe(N), { timeout: 8000 })
  return pane
}
const meta = (pane) => pane.current.getDateMeta().replay
const door = (pane, arg) => act(() => { expect(pane.current.viewDo('replay', arg)).toBe(true) })

describe('the Replay / Time Machine bar through ChartPane.viewDo("replay") on the real StockChart', () => {
  it('enter, play, pause, step, jump, scrub to a date, speed and exit each land in StockChart state and are read back', async () => {
    const pane = await mount()
    expect(meta(pane)).toMatchObject({ can: true, mode: false, playing: false, speed: 1, index: null })
    await door(pane, { op: 'enter' })
    // the toolbar's own toggle: on, paused, at 70% of the bars
    await vi.waitFor(() => expect(meta(pane)).toMatchObject({ mode: true, playing: false, index: Math.floor(N * 0.7) }))
    expect(screen.getByText(/^REPLAY \d+%$/)).toBeTruthy()          // the chart's own replay badge shows it
    await door(pane, { op: 'speed', speed: 5 })
    await vi.waitFor(() => expect(meta(pane).speed).toBe(5))
    await door(pane, { op: 'play' })
    await vi.waitFor(() => expect(meta(pane).playing).toBe(true))
    await door(pane, { op: 'pause' })
    await vi.waitFor(() => expect(meta(pane).playing).toBe(false))
    const at = meta(pane).index
    await door(pane, { op: 'step', n: -10 })
    await vi.waitFor(() => expect(meta(pane).index).toBe(at - 10))
    await door(pane, { op: 'seek', index: 0 })
    await vi.waitFor(() => expect(meta(pane)).toMatchObject({ index: 0, dateMs: Date.UTC(2026, 0, 1) }))
    await door(pane, { op: 'seekDate', ms: Date.UTC(2026, 0, 15) })
    await vi.waitFor(() => expect(meta(pane)).toMatchObject({ index: 14, dateMs: Date.UTC(2026, 0, 15), playing: false }))
    await door(pane, { op: 'exit' })
    await vi.waitFor(() => expect(meta(pane)).toMatchObject({ mode: false, playing: false, index: null }))
    // an exit's Undo re-enters at the exact bar it left
    await door(pane, { op: 'restore', index: 14 })
    await vi.waitFor(() => expect(meta(pane)).toMatchObject({ mode: true, playing: false, index: 14 }))
  }, 30000)

  it('the toolbar buttons and the door are ONE set of handlers: a click is read back the same way, and the door continues from it', async () => {
    const pane = await mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Replay / Time Machine' })) })
    await vi.waitFor(() => expect(meta(pane)).toMatchObject({ mode: true, index: Math.floor(N * 0.7) }))
    await act(async () => { fireEvent.click(screen.getByTitle('Back 10')) })
    await vi.waitFor(() => expect(meta(pane).index).toBe(Math.floor(N * 0.7) - 10))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '20×' })) })
    await vi.waitFor(() => expect(meta(pane).speed).toBe(20))
    await door(pane, { op: 'step', n: 1 })
    await vi.waitFor(() => expect(meta(pane).index).toBe(Math.floor(N * 0.7) - 9))
    await act(async () => { fireEvent.click(screen.getByText('Exit')) })
    await vi.waitFor(() => expect(meta(pane).mode).toBe(false))
  }, 30000)

  it('a play / pause / step outside replay does nothing (never enters it by accident); "play" never toggles the mode', async () => {
    const pane = await mount()
    for (const arg of [{ op: 'play' }, { op: 'pause' }, { op: 'step', n: 1 }, { op: 'speed', speed: 5 }, { op: 'exit' }]) await door(pane, arg)
    await new Promise(r => setTimeout(r, 50))
    expect(meta(pane)).toMatchObject({ mode: false, playing: false, index: null, speed: 1 })
    await door(pane, { op: 'enter' })
    await vi.waitFor(() => expect(meta(pane).mode).toBe(true))
    await door(pane, { op: 'play' })
    await vi.waitFor(() => expect(meta(pane).playing).toBe(true))
    await door(pane, { op: 'play' })                                   // already playing: the play button is not pressed again
    await new Promise(r => setTimeout(r, 30))
    expect(meta(pane)).toMatchObject({ mode: true, playing: true })
    await door(pane, { op: 'enter' })                                  // already on: the toggle is not pressed (it would exit)
    await new Promise(r => setTimeout(r, 30))
    expect(meta(pane).mode).toBe(true)
  }, 30000)

  it('no Replay button on this chart (a grid cell\'s profile, the phone shell): can is false and the door changes nothing', async () => {
    for (const props of [{ showDrawingTools: false }, { showDrawingTools: true, hideReplay: true }, { showDrawingTools: true, mobileDrawBar: true }]) {
      const pane = await mount(props)
      expect(meta(pane).can).toBe(false)
      await door(pane, { op: 'enter' })
      await new Promise(r => setTimeout(r, 50))
      expect(meta(pane).mode).toBe(false)
      cleanup()
    }
  }, 40000)
})
