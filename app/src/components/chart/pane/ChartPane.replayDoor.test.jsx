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

  // AUDIT #1174 ruling 2: after the refactor (the inline arrows became replayToggle / replayPlayPause / replayStep /
  // replayIndexChange), EVERY real button of the replay bar still makes the same change, read back the same way.
  it('the REAL replay bar buttons after the refactor: Replay, ▶ / ⏸, ‹ › « », ⏮ ⏭, the scrubber, 1× / 5× / 20×, Exit', async () => {
    const pane = await mount()
    const click = (el) => act(async () => { fireEvent.click(el) })
    await click(screen.getByRole('button', { name: 'Replay / Time Machine' }))
    const start = Math.floor(N * 0.7)
    await vi.waitFor(() => expect(meta(pane)).toMatchObject({ mode: true, playing: false, index: start }))
    const playBtn = () => screen.getByTitle('Back 1').nextElementSibling          // the ▶ / ⏸ button (it has no title)
    await click(playBtn())
    await vi.waitFor(() => expect(meta(pane).playing).toBe(true))
    await click(playBtn())
    await vi.waitFor(() => expect(meta(pane).playing).toBe(false))
    const at = meta(pane).index
    await click(screen.getByTitle('Fwd 1'))
    await vi.waitFor(() => expect(meta(pane).index).toBe(at + 1))
    await click(screen.getByTitle('Back 1'))
    await vi.waitFor(() => expect(meta(pane).index).toBe(at))
    await click(screen.getByTitle('Back 10'))
    await vi.waitFor(() => expect(meta(pane).index).toBe(at - 10))
    await click(screen.getByTitle('Fwd 10'))
    await vi.waitFor(() => expect(meta(pane).index).toBe(at))
    await click(screen.getByTitle('Restart from beginning'))
    await vi.waitFor(() => expect(meta(pane).index).toBe(0))
    await click(screen.getByTitle('Skip to end'))
    await vi.waitFor(() => expect(meta(pane).index).toBe(N - 1))
    await act(async () => { fireEvent.change(screen.getByTitle('Scrub timeline'), { target: { value: '12' } }) })
    await vi.waitFor(() => expect(meta(pane)).toMatchObject({ index: 12, dateMs: Date.UTC(2026, 0, 13) }))
    // a step pauses a playing replay (the handler's own setReplayPlaying(false))
    await click(playBtn())
    await vi.waitFor(() => expect(meta(pane).playing).toBe(true))
    await click(screen.getByTitle('Fwd 1'))
    await vi.waitFor(() => expect(meta(pane).playing).toBe(false))
    for (const s of [5, 20, 1]) {
      await click(screen.getByRole('button', { name: `${s}×` }))
      await vi.waitFor(() => expect(meta(pane).speed).toBe(s))
    }
    await click(screen.getByText('Exit'))
    await vi.waitFor(() => expect(meta(pane)).toMatchObject({ mode: false, playing: false, index: null }))
    expect(screen.queryByTitle('Back 1')).toBeNull()                               // the replay bar is gone
  }, 30000)

  // AUDIT #1174 ruling 5 — WHERE the Time Machine does not exist (so chartReplay.playback says "not available here"):
  //  · Multi Chart cell: pages/charts/grid/GridChartCell.jsx:547 `showDrawingTools={false}` and :549 `hideReplay`; StockChart
  //    mounts its primary ChartToolbar only inside `{showDrawingTools && (` (components/StockChart.jsx:20998), and the
  //    toolbar draws the Replay button only when `{!hideReplay && onReplayToggle && (` (components/chart/ChartToolbar.jsx:1821).
  //    The cell's Agent adapter (GridChartCell.jsx:266-291) has no `viewDo`, so host.charts.viewDo is false there too.
  //  · Phone chart: pages/charts/mobile/MobileChartsApp.jsx:462 `mobileDrawBar: true` → StockChart passes
  //    `hiddenHost={mobileDrawBar}` (StockChart.jsx:21064) → the toolbar renders `style={{ display: 'none' }}`
  //    (ChartToolbar.jsx:1607): no visible Replay button. The phone ticker sheet passes `hideReplay: true`
  //    (components/mobile/TickerHubSheet.jsx:154).
  //  StockChart's replayCtlRef `can: !!showDrawingTools && !hideReplay && !mobileDrawBar` (StockChart.jsx:18507) encodes these.
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
