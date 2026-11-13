// chartReplay.playback, MULTI-OP plans on ONE chart (AUDIT #1174 follow-up): the REAL Agent panel / planner / runtime driving
// the REAL ChartPane + StockChart (lightweight-charts and the live feeds stubbed; the board's chart adapter is pointed at the
// mounted pane: view = getDateMeta(), viewDo = ChartPane.viewDo — exactly ChartWidget's adapter). Scripted model.
//   (a) "start the bar replay and step forward 5 bars" = enter + forward(5) in one plan
//   (b) "start the bar replay at 5×"                    = enter + speed(5) in one plan
// Each lands BOTH, each op read back from StockChart's own state — or stops after the first with an honest receipt. Never a
// step outside replay (no stepBar scroll), never an op on the mode captured at plan time.
import { createRef } from 'react'
import { render, cleanup } from '@testing-library/react'
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
      applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {}, getVisibleLogicalRange: () => ({ from: 10, to: 39 }),
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
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../hooks/usePreferences', async (importOriginal) => ({ ...(await importOriginal()), default: () => ({ prefs: {}, setPref: () => {}, loading: false }) }))
vi.mock('../hooks/useFundamentalSnapshot', () => ({ default: () => ({ data: null, isLoading: false }) }))
vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

const { registerBuiltins } = await import('./builtins')
const { setupPanel, ONE } = await import('./testing/panelHarness')
const { REPLAY_ACTION } = await import('./capabilities/chartReplay')
const { default: ChartPane } = await import('../components/chart/pane/ChartPane')
const { AuthContext } = await import('../context/AuthContext')
registerBuiltins()

const N = 40
const bars = Array.from({ length: N }, (_, i) => ({ t: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), o: 10, h: 11, l: 9, c: 10, v: 1000 }))
let p
beforeEach(() => {
  p = setupPanel()
  const agentFetch = globalThis.fetch
  vi.stubGlobal('fetch', vi.fn((url, init) => (String(url).includes('/api/bars')
    ? Promise.resolve({ ok: true, json: () => Promise.resolve({ bars }) }) : agentFetch(url, init))))
})
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const R = (args) => ({ action: REPLAY_ACTION, target: 'c', args: { bars: null, date: null, speed: null, ...args } })

/** The board's chart 'c' wired to a mounted REAL ChartPane (its view read-out and its view door), as ChartWidget's adapter is. */
async function realChart(h) {
  const pane = createRef()
  render(<AuthContext.Provider value={{ user: { id: 1, role: 'member' }, plan: 'free', isPaid: false, loading: false }}><ChartPane ref={pane} sym="NVDA" tf="D" onTfChange={() => {}} stockChartProps={{ showDrawingTools: true }} /></AuthContext.Provider>)
  await vi.waitFor(() => expect(pane.current?.getDateMeta?.()?.replay?.total).toBe(N), { timeout: 8000 })
  const base = h.charts, read = base.read, list = base.list
  const calls = []
  h.charts = {
    ...base,
    read: (ref) => { const s = read(ref); return s && { ...s, view: pane.current.getDateMeta() } },
    list: () => list().map(s => ({ ...s, view: pane.current.getDateMeta() })),
    // NOT wrapped in act(): React renders on its own schedule, as in the browser — so a step pressed before the previous one
    // is read back meets the chart's LAST render (the stale-mode hazard the step-by-step read-back exists for)
    viewDo: (ref, op, arg) => { calls.push([op, arg]); return pane.current.viewDo(op, arg) },
  }
  return { meta: () => pane.current.getDateMeta().replay, calls }
}

describe('a multi-op replay plan on ONE chart, through the real panel and the real StockChart', () => {
  it('(a) "start the bar replay and step forward 5 bars": both land and are read back, or it stops after the first — never a step outside replay', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const c = await realChart(h)
    p.st.envelopes.push(p.env('apply', [R({ op: 'enter' }), R({ op: 'forward', bars: 5 })]))
    await say('start the bar replay and step forward 5 bars')
    await vi.waitFor(() => expect(c.meta().mode).toBe(true))
    const start = Math.floor(N * 0.7)
    const text = document.body.textContent
    // the chart's door was asked for replay ops only — never the Time Navigator's stepBar (a scroll of the window)
    expect(c.calls.every(([op]) => op === 'replay')).toBe(true)
    if (c.calls.length === 2) {
      // BOTH: enter, then the step on the replay as it is NOW (on), read back at exactly 70% + 5
      expect(c.calls).toEqual([['replay', { op: 'enter' }], ['replay', { op: 'step', n: 5 }]])
      await vi.waitFor(() => expect(c.meta()).toMatchObject({ mode: true, playing: false, index: start + 5 }))
      expect(text).toMatch(/Started the bar replay/)
      expect(text).toMatch(/Stepped the bar replay forward 5 bars/)
    } else {
      // STOPPED after the first, honestly: the replay is on at its start bar, and the step is said not done
      expect(c.calls).toEqual([['replay', { op: 'enter' }]])
      expect(c.meta()).toMatchObject({ mode: true, index: start })
      expect(text).toMatch(/Started the bar replay/)
      expect(text).not.toMatch(/Stepped the bar replay/)
      expect(text).toMatch(/one replay control at a time|isn’t in bar replay|didn’t|not done|couldn/i)
    }
  }, 40000)

  it('(b) "start the bar replay at 5×": both land (on, speed 5) and are read back, or it stops after the first', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const c = await realChart(h)
    p.st.envelopes.push(p.env('apply', [R({ op: 'enter' }), R({ op: 'speed', speed: 5 })]))
    await say('start the bar replay at 5x')
    await vi.waitFor(() => expect(c.meta().mode).toBe(true))
    const text = document.body.textContent
    if (c.calls.length === 2) {
      expect(c.calls).toEqual([['replay', { op: 'enter' }], ['replay', { op: 'speed', speed: 5 }]])
      await vi.waitFor(() => expect(c.meta()).toMatchObject({ mode: true, speed: 5 }))
      expect(text).toMatch(/Set the bar replay to 5×/)
    } else {
      expect(c.calls).toEqual([['replay', { op: 'enter' }]])
      expect(c.meta()).toMatchObject({ mode: true, speed: 1 })
      expect(text).not.toMatch(/Set the bar replay to 5×/)
      expect(text).toMatch(/one replay control at a time|isn’t in bar replay|didn’t|not done|couldn/i)
    }
  }, 40000)
  it('Undo of the two-op plan runs each step’s own way back, in reverse: the scrubber back, then the replay off', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const c = await realChart(h)
    p.st.envelopes.push(p.env('apply', [R({ op: 'enter' }), R({ op: 'forward', bars: 5 })]))
    await say('start the bar replay and step forward 5 bars')
    await vi.waitFor(() => expect(c.meta()).toMatchObject({ mode: true, index: Math.floor(N * 0.7) + 5 }))
    await say('undo')
    await vi.waitFor(() => expect(c.meta()).toMatchObject({ mode: false, playing: false, index: null }))
    expect(c.calls.slice(2)).toEqual([['replay', { op: 'seek', index: Math.floor(N * 0.7) }], ['replay', { op: 'exit' }]])
  }, 40000)

  it('a second op that does NOT land stops the plan there: no success is claimed for it, and nothing after it is pressed', async () => {
    const { say, h } = p.mount(...ONE('NVDA'))
    const c = await realChart(h)
    const real = h.charts.viewDo
    h.charts.viewDo = (ref, op, arg) => (arg?.op === 'step' ? (c.calls.push([op, arg]), true) : real(ref, op, arg))   // the step is swallowed
    const realNow = Date.now
    let t = realNow()
    vi.spyOn(Date, 'now').mockImplementation(() => { t += 2000; return t })      // the 10s read-back wait passes at once
    p.st.envelopes.push(p.env('apply', [R({ op: 'enter' }), R({ op: 'forward', bars: 5 }), R({ op: 'speed', speed: 20 })]))
    await say('start the bar replay, step forward 5 bars and play at 20x')
    await vi.waitFor(() => expect(c.meta().mode).toBe(true))
    expect(c.calls.map(([, a]) => a.op)).toEqual(['enter', 'step'])           // the speed after the failed step is never pressed
    expect(c.meta()).toMatchObject({ index: Math.floor(N * 0.7), speed: 1 })
    // the honest receipt: how many steps landed, that it stopped, and what the chart shows NOW (never “nothing was left changed”)
    const text = document.body.textContent
    expect(text).toMatch(/did 1 of the 3 steps you asked for, then the next one did not take effect on the chart, so I stopped there/)
    expect(text).toMatch(/the bar replay is on, paused at 1×, bar 29 of 40/)
    expect(text).not.toMatch(/nothing was left changed/)
    expect(text).not.toMatch(/Stepped the bar replay forward 5 bars \(now|Set the bar replay to 20×/)
  }, 40000)
})

