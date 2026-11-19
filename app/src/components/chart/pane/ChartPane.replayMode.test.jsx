// D20 · Replay Mode on the REAL ChartPane + StockChart (lightweight-charts and the live feeds stubbed; bars from a fetch
// stub that answers a Replay window `to=<day>` with the fixture bars of days ≤ that day, as the server does):
//   (d)  every linked chart — different timeframes, one shared cutoff — renders ONLY bars that were complete by the cutoff,
//        and nothing short of it (its next held bar is NOT complete by then);
//   (3)  the read-only bar-times door returns exactly the bars the chart holds for its key (its rendered bars are those the
//        cutoff shows), never a bar it does not hold;
//   (9)  the bar request's `to` is a DAY (the cutoff's ET day; W/M: its period's end) — a precise cutoff never reaches the
//        server.
import { createRef } from 'react'
import { render, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as O from '../__tests__/replayOracle'

const rendered = new Map()          // pane id → the last candle data set on its main series
let paneId = null
vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  const mkSeries = () => {
    const s = {
      setData: (d) => { if (Array.isArray(d) && d.some(x => x && 'open' in x)) rendered.set(s.__pane, d.filter(x => x && 'open' in x)) },
      update: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
      createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
      detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
    }
    s.__pane = paneId
    return s
  }
  const mkChart = () => ({
    addSeries: mkSeries, addCandlestickSeries: mkSeries, addHistogramSeries: mkSeries,
    addLineSeries: mkSeries, addAreaSeries: mkSeries, addBarSeries: mkSeries,
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
  })
  return {
    ...real, createChart: () => mkChart(),
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
const { fromChartTime } = await import('../barTime')
const { cutoffFetchDay } = await import('../replayCutoff')

const WIN = O.sessions('2026-02-02', '2026-04-24')
const FIX = { D: O.dwmBars(WIN, 'D'), W: O.dwmBars(WIN, 'W'), M: O.dwmBars(WIN, 'M'), '5': O.intradayBars(WIN, '5'), '15': O.intradayBars(WIN, '15'), '30': O.intradayBars(WIN, '30'), '1': O.intradayBars(O.sessions('2026-03-09', '2026-04-03'), '1') }
const dayOfBar = (b) => (typeof b.t === 'number' ? O.unixToEt(b.t).day : b.t)
let urls = []
const allUrls = []          // every bar request this file made (the bars cache outlives one test)
beforeEach(() => {
  cleanup(); rendered.clear(); urls = []
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    urls.push(u); allUrls.push(u)
    const m = /\/api\/bars\/[^?]+\?tf=([^&]+)&.*?(?:&to=([^&]+))?$/.exec(u)
    const tf = m?.[1], to = m?.[2] ? decodeURIComponent(m[2]) : null
    const all = FIX[tf] || []
    const bars = to ? all.filter(b => dayOfBar(b) <= to) : all
    return Promise.resolve({ ok: true, json: () => Promise.resolve(u.includes('/api/bars') ? { bars } : {}) })
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

async function mount(tf, cutoff) {
  const pane = createRef()
  paneId = tf
  render(<ChartPane ref={pane} sym="NVDA" tf={tf} onTfChange={() => {}} stockChartProps={{ showDrawingTools: true, replayCutoff: cutoff }} />)
  await vi.waitFor(() => expect(rendered.get(tf)?.length).toBeGreaterThan(0), { timeout: 8000 })
  return pane
}
const unixOf = (x) => (typeof x.time === 'number' ? fromChartTime(x.time) : (typeof x.time === 'string' ? x.time : `${x.time.year}-${String(x.time.month).padStart(2, '0')}-${String(x.time.day).padStart(2, '0')}`))
const endOf = (t, tf) => O.barEnd({ t }, tf, { allDays: WIN })

// cutoffs: day-only (a session, before Good Friday), and precise (mid-morning, the close, a 60m boundary)
const CUTS = ['2026-03-13', '2026-04-02', O.preciseOf(O.etToUnix('2026-03-10', 605)), O.preciseOf(O.etToUnix('2026-03-10', 960)), O.preciseOf(O.etToUnix('2026-04-01', 690))]

describe('(d) every linked chart renders only bars complete by the cutoff — and nothing short of it', () => {
  it.each(CUTS)('cutoff %s on 1m · 5m · 15m · 30m · D · W · M', async (v) => {
    for (const tf of ['1', '5', '15', '30', 'D', 'W', 'M']) {
      await mount(tf, v)
      const shown = rendered.get(tf).map(unixOf)
      const inst = v.length > 10 ? Date.parse(v) / 1000 : null
      const held = FIX[tf]
      const last = shown[shown.length - 1]
      // every rendered bar complete by the cutoff (day-only: its sessions ≤ the day)
      for (const t of shown) expect(O.visible({ t }, tf, v, { allDays: WIN }), `${tf} ${v}: rendered ${t}`).toBe(true)
      if (inst != null) expect(endOf(last, tf) <= inst, `${tf} ${v}`).toBe(true)
      // and nothing short of it: the held bar after the last rendered one is NOT complete by the cutoff
      const i = held.findIndex(b => b.t === last)
      if (held[i + 1]) expect(O.visible(held[i + 1], tf, v, { allDays: WIN }), `${tf} ${v}: next ${held[i + 1].t}`).toBe(false)
      cleanup()
    }
  }, 120000)
})

describe('(3) the bar-times door: exactly the bars the chart holds for its key, never one it does not hold', () => {
  it.each(['5', 'D', 'W'])('%s', async (tf) => {
    const v = tf === '5' ? O.preciseOf(O.etToUnix('2026-03-10', 605)) : '2026-03-13'
    const pane = await mount(tf, v)
    const out = await pane.current.replayBarTimes({})
    expect(out.tf).toBe(tf)
    // what the chart HOLDS for its key: the answer to its own Replay-window request (`to` = the cutoff's day) — that request
    // was made (by this chart or an earlier one: the bars cache is shared), and the door returns exactly it. (In jsdom the
    // weekly chart first paints W synthesized from the Daily already in memory — useLegacyChartBars' A4 first frame — so
    // for W the rail is the general one below: only held fixture bars, and its rendered bars are exactly the visible ones.)
    if (tf !== 'W') {
      const heldTo = cutoffFetchDay(v, tf)
      expect(allUrls.some(u => u.includes(`tf=${tf}&`) && u.endsWith(`&to=${heldTo}`)), `${tf} window ${heldTo} requested`).toBe(true)
      expect(out.times).toEqual(FIX[tf].filter(b => dayOfBar(b) <= heldTo).map(b => b.t))
    }
    const shown = rendered.get(tf).map(unixOf)
    expect(out.times.filter(t => O.visible({ t }, tf, v, { allDays: WIN }))).toEqual(shown)   // its rendered bars are the visible ones
    for (const t of out.times) expect(FIX[tf].some(b => b.t === t), `${t}`).toBe(true)
  }, 40000)
  it('a later look-ahead window: the same request with a later `to`, still only bars of the fixture', async () => {
    const pane = await mount('D', '2026-03-13')
    const out = await pane.current.replayBarTimes({ throughDay: '2026-03-20' })
    expect(out.times).toEqual(FIX.D.filter(b => b.t <= '2026-03-20').map(b => b.t))
    expect(urls.some(u => /tf=D&bars=2000.*&to=2026-03-20$/.test(u))).toBe(true)
  }, 40000)
})

describe('(9) the bar request carries a DAY, never the precise cutoff', () => {
  it('5m with a precise cutoff → to=<its ET day>; W → to=<its week\'s end>', async () => {
    await mount('5', O.preciseOf(O.etToUnix('2026-03-10', 605)))
    const five = urls.filter(u => u.includes('/api/bars/') && u.includes('tf=5'))
    expect(five.length).toBeGreaterThan(0)
    for (const u of five) expect(u).toMatch(/&to=2026-03-10$/)
    // a weekly chart's window ends at its week's end (the day the legacy + snapshot requests and the door use)
    expect(cutoffFetchDay('2026-03-11', 'W')).toBe('2026-03-15')
    expect(cutoffFetchDay('2026-03-11T10:05-04:00', 'M')).toBe('2026-03-31')
    expect(cutoffFetchDay('2026-03-11T10:05-04:00', '5')).toBe('2026-03-11')
  }, 40000)
})
