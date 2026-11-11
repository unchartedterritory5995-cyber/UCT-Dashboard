import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'

// ─── THE INTRADAY DEVELOPING CANDLE, THROUGH THE REAL StockChart ──────────────
//
// lib/liveBarMerge.test.js proves the merge rules as pure functions. This file
// proves they are WIRED: the real StockChart, a 5m intraday series, the Massive
// push writer (B) authoritative, and the post-poll re-top (D) — with
// lightweight-charts replaced by a recorder whose update() has the real library's
// semantics (same time → replace, later → append, earlier → throw).
// All prices are synthetic.

const H = vi.hoisted(() => ({ series: [], onBar: null, delivering: true, prices: {}, e1: [] }))

vi.mock('lightweight-charts', () => {
  const makeSeries = (ctor, options) => {
    const s = {
      __ctor: ctor, __options: { ...(options || {}) }, __data: [],
      setData: (d) => { s.__data = [...(d || [])] },
      update: (p, historical) => {
        if (!p) return
        if (historical) {
          const i = s.__data.findIndex(d => d.time === p.time)
          if (i < 0) throw new Error('historical update of a missing time')
          s.__data = [...s.__data.slice(0, i), p, ...s.__data.slice(i + 1)]
          return
        }
        const last = s.__data[s.__data.length - 1]
        if (last && typeof p.time === 'number' && typeof last.time === 'number' && p.time < last.time) {
          throw new Error('Cannot update oldest data')
        }
        if (last && last.time === p.time) s.__data = [...s.__data.slice(0, -1), p]
        else s.__data = [...s.__data, p]
      },
      applyOptions: (o) => { Object.assign(s.__options, o || {}) },
      priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
      createPriceLine: () => ({ applyOptions: () => {} }), removePriceLine: () => {}, setMarkers: () => {},
      attachPrimitive: () => {}, detachPrimitive: () => {},
      priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => s.__options,
      moveToPane: () => {}, getPane: () => ({ getHeight: () => 300 }),
      dataByIndex: () => null, data: () => s.__data,
    }
    H.series.push(s)
    return s
  }
  const timeScale = new Proxy({
    applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {},
    getVisibleLogicalRange: () => null, getVisibleRange: () => null, setVisibleRange: () => {},
    scrollToPosition: () => {}, scrollPosition: () => 0, timeToCoordinate: () => 0,
    coordinateToTime: () => null, logicalToCoordinate: () => 0, coordinateToLogical: () => 0,
    options: () => ({}), width: () => 600, height: () => 40, barSpacing: () => 6,
  }, { get: (t, p) => (p in t ? t[p] : (typeof p === 'symbol' || p === 'then') ? undefined : () => undefined) })
  const chart = {
    addSeries: (ctor, options) => makeSeries(ctor, options),
    addCustomSeries: (_i, options) => makeSeries('custom', options),
    removeSeries: () => {}, applyOptions: () => {},
    priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => timeScale,
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {},
    subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [0, 1, 2, 3].map(() => ({
      getHeight: () => 300, setHeight: () => {},
      getHTMLElement: () => document.createElement('div'),
      priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    })),
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
    CandlestickSeries: 'CandlestickSeries', HistogramSeries: 'HistogramSeries',
    LineSeries: 'LineSeries', AreaSeries: 'AreaSeries', BaselineSeries: 'BaselineSeries',
    BarSeries: 'BarSeries',
    createSeriesMarkers: () => ({ setMarkers: () => {} }),
  }
})

vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: H.prices, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({
  default: ({ onBar, session, symbol }) => { H.onBar = onBar; H.session = session; H.pushSymbol = symbol; return { connected: true, healthy: true, delivering: H.delivering, lastBarT: { current: null } } },
}))
vi.mock('../lib/barsStreamManager', () => ({
  subscribe: (sym, tf, cbs) => { H.e1.push({ sym, tf, ...(cbs || {}) }); return () => {} },
  getStatus: () => ({ connected: false, healthy: false, delivering: false }),
  getLastResume: () => null,
}))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))

HTMLCanvasElement.prototype.getContext = function getContext() {
  const ctx = { canvas: null, measureText: () => ({ width: 0 }), createLinearGradient: () => ({ addColorStop: () => {} }), getImageData: () => ({ data: [] }) }
  for (const m of ['clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'stroke', 'fill', 'save', 'restore', 'setLineDash', 'translate', 'scale', 'rotate', 'setTransform', 'quadraticCurveTo', 'bezierCurveTo', 'ellipse', 'rect', 'clip', 'drawImage', 'putImageData']) ctx[m] = () => {}
  return ctx
}

// 2026-11-09 (Mon) 14:07 ET = 19:07 UTC (EST). Bars every 5m from 10:00 ET.
const NOW_MS = Date.UTC(2026, 10, 9, 19, 7, 0)
const T1400 = Date.UTC(2026, 10, 9, 19, 0, 0) / 1000
const mkBars = (lastBar) => {
  const out = []
  for (let t = T1400 - 48 * 300; t < T1400; t += 300) out.push({ t, o: 20, h: 20.3, l: 19.7, c: 20, v: 1000 })
  out.push({ t: T1400, ...lastBar })
  return out
}

let StockChart
const candle = () => H.series.find(s => s.__ctor === 'CandlestickSeries')
const tail = () => { const d = candle().__data; return d[d.length - 1] }
const push = (tUnix, o, h, l, c, v, extra = {}) => act(() => {
  H.onBar({ sym: 'SYN', tf: '5', bar: { t: tUnix * 1000, o, h, l, c, v, ...extra } })
})

beforeEach(async () => {
  cleanup()
  H.series.length = 0
  H.onBar = null
  H.delivering = true
  H.prices = {}
  H.e1 = []
  ;(await import('../lib/realtimeCandle'))._reset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW_MS)
  try { localStorage.removeItem('uct.barsPush.enabled') } catch { /* jsdom */ }
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
  StockChart = StockChart || (await import('./StockChart')).default
}, 60000)   // the first test pays the cold StockChart import (~10 s on a loaded machine)
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

async function mount(lastBar) {
  const view = render(<StockChart sym="SYN" tf="5" barsOverride={mkBars(lastBar)} />)
  await act(async () => { await Promise.resolve() })
  return view
}

describe('developing intraday candle — push writer (B) + poll re-top (D)', () => {
  it('a push frame narrower than the fetched partial does NOT shrink the painted H/L', async () => {
    await mount({ o: 20.0, h: 20.8, l: 19.6, c: 20.1, v: 5000 })
    expect(H.onBar).toBeTypeOf('function')
    const offset = tail().time - T1400   // chart time = unix + ET offset
    push(T1400, 20.3, 20.5, 20.0, 20.4, 1200)
    expect(tail()).toMatchObject({ time: T1400 + offset, open: 20.0, high: 20.8, low: 19.6, close: 20.4 })
    push(T1400, 20.3, 20.6, 20.1, 20.2, 1300)
    expect(tail()).toMatchObject({ high: 20.8, low: 19.6, close: 20.2 })
  })

  it('poll landing mid-bucket with a LOWER server high keeps the live H/L and close', async () => {
    // MID-bucket for real: the 14:00 bucket is still forming (the file clock, 14:07, is past
    // its end — and a CLOSED bucket is the server's bar, I8).
    vi.setSystemTime((T1400 + 120) * 1000)
    const view = await mount({ o: 20.0, h: 20.3, l: 19.9, c: 20.1, v: 5000 })
    push(T1400, 20.0, 20.9, 19.5, 20.6, 7000)
    expect(tail()).toMatchObject({ high: 20.9, low: 19.5, close: 20.6 })
    // The 30s poll arrives with the server's lagging snapshot of the same bucket.
    view.rerender(<StockChart sym="SYN" tf="5" barsOverride={mkBars({ o: 20.0, h: 20.5, l: 19.8, c: 20.3, v: 6500 })} />)
    await act(async () => { await Promise.resolve() })
    expect(tail()).toMatchObject({ open: 20.0, high: 20.9, low: 19.5, close: 20.6 })
  })

  it('bucket roll: the new candle opens clean (no fusion), a late prior-bucket frame is ignored, and a poll that has not seen the new bucket does not blank it', async () => {
    const view = await mount({ o: 20.0, h: 20.8, l: 19.6, c: 20.1, v: 5000 })
    const offset = tail().time - T1400
    push(T1400 + 300, 20.2, 20.25, 20.15, 20.2, 50)
    expect(tail()).toMatchObject({ time: T1400 + 300 + offset, open: 20.2, high: 20.25, low: 20.15 })
    push(T1400, 20.0, 21.5, 19.0, 21.4, 6000)          // late prior-bucket frame
    expect(tail()).toMatchObject({ time: T1400 + 300 + offset, high: 20.25, low: 20.15, close: 20.2 })
    push(T1400 + 300, 20.2, 20.3, 20.1, 20.28, 90)
    // Poll lands; server tail is still the 14:00 bucket.
    view.rerender(<StockChart sym="SYN" tf="5" barsOverride={mkBars({ o: 20.0, h: 20.8, l: 19.6, c: 20.1, v: 5100 })} />)
    await act(async () => { await Promise.resolve() })
    expect(tail()).toMatchObject({ time: T1400 + 300 + offset, open: 20.2, high: 20.3, low: 20.1, close: 20.28 })
  })
})

describe('developing intraday candle — live volume', () => {
  it('volume never decreases within the bucket when a push frame carries less than the fetched partial', async () => {
    await mount({ o: 20.0, h: 20.8, l: 19.6, c: 20.1, v: 5000 })
    const vol = H.series.find(s => s.__ctor === 'HistogramSeries' && s.__data.length && s.__data[s.__data.length - 1].value === 5000)
    expect(vol).toBeTruthy()
    push(T1400, 20.3, 20.5, 20.0, 20.4, 1200)   // since-subscribe rollup volume
    expect(vol.__data[vol.__data.length - 1].value).toBe(5000)
    push(T1400, 20.3, 20.5, 20.0, 20.4, 5600)
    expect(vol.__data[vol.__data.length - 1].value).toBe(5600)
  })
})

describe('fallback (push NOT delivering) — Writer C on 1m', () => {
  const mk1m = (lastBar) => {
    const out = []
    for (let t = T1400 - 120 * 60; t < T1400; t += 60) out.push({ t, o: 20, h: 20.3, l: 19.7, c: 20, v: 100 })
    out.push({ t: T1400, ...lastBar })
    return out
  }
  it('the since-subscribe registry minute never shrinks the fetched minute, and a bar_close without o/h/l never paints undefined', async () => {
    H.delivering = false
    const rc = await import('../lib/realtimeCandle')
    rc._reset()
    render(<StockChart sym="SYN" tf="1" barsOverride={mk1m({ o: 20.0, h: 20.8, l: 19.6, c: 20.1, v: 5000 })} />)
    await act(async () => { await Promise.resolve() })
    const offset = tail().time - T1400
    act(() => { rc.applyTick('SYN', 20.4, 300, T1400 + 20) })
    expect(tail()).toMatchObject({ time: T1400 + offset, open: 20.0, high: 20.8, low: 19.6, close: 20.4 })
    act(() => { rc.applyBarClose('SYN', '1', { t: T1400, c: 20.35, v: 5200 }) })
    const b = tail()
    for (const k of ['open', 'high', 'low', 'close']) expect(Number.isFinite(b[k])).toBe(true)
    expect(b).toMatchObject({ open: 20.0, high: 20.8, low: 19.6, close: 20.35 })
  })
})

describe('W-B contract: a FINAL bar with an OLDER t than the developing bar', () => {
  it('replaces that closed bar in place and leaves the developing candle alone', async () => {
    await mount({ o: 20.0, h: 20.8, l: 19.6, c: 20.1, v: 5000 })
    const offset = tail().time - T1400
    push(T1400 + 300, 20.2, 20.25, 20.15, 20.2, 50)        // developing 14:05
    push(T1400, 20.0, 20.9, 19.5, 20.15, 5400, { final: true, trade_ts: (T1400 + 299) * 1000 })
    const d = candle().__data
    expect(d[d.length - 1]).toMatchObject({ time: T1400 + 300 + offset, open: 20.2, high: 20.25, low: 20.15, close: 20.2 })
    expect(d[d.length - 2]).toMatchObject({ time: T1400 + offset, open: 20.0, high: 20.9, low: 19.5, close: 20.15 })
    push(T1400 + 300, 20.2, 20.3, 20.1, 20.28, 90)
    expect(tail()).toMatchObject({ time: T1400 + 300 + offset, high: 20.3, low: 20.1, close: 20.28 })
  })
})

describe('review fixes F1-F4', () => {
  const mk1m = (lastBar) => {
    const out = []
    for (let t = T1400 - 120 * 60; t < T1400; t += 60) out.push({ t, o: 20, h: 20.3, l: 19.7, c: 20, v: 100 })
    out.push({ t: T1400, ...lastBar })
    return out
  }

  it('F2/F4 (1m fallback): C opens N+1, a livePrices tick stamped N neither snaps N+1 back nor, after the poll, paints N+1\'s range onto N', async () => {
    H.delivering = false
    vi.setSystemTime((T1400 + 80) * 1000)   // wall clock inside minute N+1
    const rc = await import('../lib/realtimeCandle')
    rc._reset()
    const SERVER_N = { o: 20.0, h: 20.4, l: 19.8, c: 20.1, v: 5000 }
    const view = render(<StockChart sym="SYN" tf="1" barsOverride={mk1m(SERVER_N)} />)
    await act(async () => { await Promise.resolve() })
    const offset = tail().time - T1400
    act(() => { rc.applyTick('SYN', 21.0, 10, T1400 + 60 + 2) })
    act(() => { rc.applyTick('SYN', 21.4, 20, T1400 + 60 + 8) })
    await act(() => new Promise(r => setTimeout(r, 1100)))   // registry repaint throttle (LIVE_UI_CADENCE_MS)
    expect(tail()).toMatchObject({ time: T1400 + 60 + offset, open: 21.0, high: 21.4, low: 21.0, close: 21.4 })
    // registry goes quiet (>3s) so Writer A is the active fallback writer
    vi.setSystemTime((T1400 + 86) * 1000)
    H.prices = { SYN: { price: 19.95, updated_at: T1400 + 50 } }      // a late tick from minute N
    view.rerender(<StockChart sym="SYN" tf="1" barsOverride={mk1m({ ...SERVER_N, v: 5100 })} />)
    await act(async () => { await Promise.resolve() })
    const d = candle().__data
    expect(d[d.length - 1]).toMatchObject({ time: T1400 + 60 + offset, open: 21.0, high: 21.4, low: 21.0, close: 21.4 })
    expect(d[d.length - 2]).toMatchObject({ time: T1400 + offset, high: 20.4, low: 19.8 })
  })

  it('F1: a 60m frame whose MESSAGE-level session is the other mode is ignored', async () => {
    const T60 = Date.UTC(2026, 10, 9, 18, 30, 0) / 1000   // 13:30 ET, RTH-aligned 60m
    const bars60 = []
    for (let t = T60 - 20 * 3600; t < T60; t += 3600) bars60.push({ t, o: 20, h: 20.3, l: 19.7, c: 20, v: 1000 })
    bars60.push({ t: T60, o: 20.0, h: 20.5, l: 19.9, c: 20.2, v: 5000 })
    render(<StockChart sym="SYN" tf="60" forceExtendedHours={false} barsOverride={bars60} />)
    await act(async () => { await Promise.resolve() })
    const before = { ...tail() }
    const other = H.session === 'eth' ? 'rth' : 'eth'
    expect(['rth', 'eth']).toContain(H.session)
    act(() => { H.onBar({ sym: 'SYN', tf: '60', session: other, bar: { t: T60 * 1000, o: 20, h: 25, l: 15, c: 24, v: 9 } }) })
    expect(tail()).toEqual(before)
    act(() => { H.onBar({ sym: 'SYN', tf: '60', session: H.session, bar: { t: T60 * 1000, o: 20, h: 20.7, l: 19.9, c: 20.6, v: 5100 } }) })
    expect(tail()).toMatchObject({ high: 20.7, close: 20.6 })
  })
})

describe('Writer E (D/W/M fast tick on the tf=1 pooled feed) — older-t frames ignored', () => {
  it('a frame older than the newest seen never moves the daily candle back', async () => {
    const days = []
    for (let i = 60; i >= 1; i--) {
      const d = new Date(Date.UTC(2026, 10, 9) - i * 86400000)
      if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue
      days.push({ t: d.toISOString().slice(0, 10), o: 20, h: 20.5, l: 19.5, c: 20, v: 1e5 })
    }
    days.push({ t: '2026-11-09', o: 20.0, h: 20.6, l: 19.8, c: 20.2, v: 5e4 })
    render(<StockChart sym="SYN" tf="D" barsOverride={days} />)
    await act(async () => { await Promise.resolve() })
    const e = H.e1.find(x => x.sym === 'SYN' && x.tf === '1')
    expect(e).toBeTruthy()
    const T2 = Date.UTC(2026, 10, 9, 19, 6, 0)
    act(() => { e.onBar({ sym: 'SYN', tf: '1', bar: { t: T2, o: 20.3, h: 20.4, l: 20.3, c: 20.4, v: 10 } }) })
    expect(tail()).toMatchObject({ time: '2026-11-09', close: 20.4 })
    act(() => { e.onBar({ sym: 'SYN', tf: '1', bar: { t: T2 - 60000, o: 19.6, h: 19.6, l: 19.6, c: 19.6, v: 10, final: true } }) })
    expect(tail()).toMatchObject({ time: '2026-11-09', close: 20.4, low: 19.8 })
  })
})

describe('N1: a live bucket the server never ingests is not held "ahead" forever', () => {
  it('after the bucket ends + grace, the poll\'s tail wins and Writer A resumes on it', async () => {
    H.delivering = false
    vi.setSystemTime((T1400 + 80) * 1000)
    const rc = await import('../lib/realtimeCandle')
    rc._reset()
    const mk1m = (lastBar) => {
      const out = []
      for (let t = T1400 - 120 * 60; t < T1400; t += 60) out.push({ t, o: 20, h: 20.3, l: 19.7, c: 20, v: 100 })
      out.push({ t: T1400, ...lastBar })
      return out
    }
    const SERVER_N = { o: 20.0, h: 20.4, l: 19.8, c: 20.1, v: 5000 }
    const view = render(<StockChart sym="SYN" tf="1" barsOverride={mk1m(SERVER_N)} />)
    await act(async () => { await Promise.resolve() })
    const offset = tail().time - T1400
    act(() => { rc.applyTick('SYN', 21.0, 10, T1400 + 60 + 2) })   // unfiltered print opens N+1
    expect(tail().time).toBe(T1400 + 60 + offset)
    // Minutes later the server tail is STILL N (it filtered that print out).
    vi.setSystemTime((T1400 + 240) * 1000)
    view.rerender(<StockChart sym="SYN" tf="1" barsOverride={mk1m({ ...SERVER_N, v: 5100 })} />)
    await act(async () => { await Promise.resolve() })
    expect(tail()).toMatchObject({ time: T1400 + offset, high: 20.4, low: 19.8 })
  })
})

describe('N2: 60m push opt-in only when the fetched series is on the TradingView grid', () => {
  const DAY = Date.UTC(2026, 10, 9, 14, 30, 0) / 1000   // 09:30 ET
  const series = (mins) => {
    const out = []
    for (let d = 3; d >= 0; d--) for (const m of mins) out.push({ t: DAY - d * 86400 + (m - 570) * 60, o: 20, h: 20.3, l: 19.7, c: 20, v: 1000 })
    return out.filter(b => b.t <= NOW_MS / 1000)
  }
  it('TV grid (9:30, 10:30 … 15:30) → subscribes', async () => {
    render(<StockChart sym="SYN" tf="60" forceExtendedHours={false} barsOverride={series([570, 630, 690, 750, 810, 870, 930])} />)
    await act(async () => { await Promise.resolve() })
    expect(H.pushSymbol).toBe('SYN')
  })
  it('legacy grid (9:30, 10:00, 11:00 …) → does not subscribe; fallback writers keep the candle', async () => {
    render(<StockChart sym="SYN" tf="60" forceExtendedHours={false} barsOverride={series([570, 600, 660, 720, 780, 840, 900])} />)
    await act(async () => { await Promise.resolve() })
    expect(H.pushSymbol).toBeNull()
  })
})

describe('W-O I6: a developing bar opened from a mid-bucket tick never locks its open', () => {
  it('REST tail lacks the current bucket; Writer A opens it from a quote; the push seed (bucket-to-date) then REPLACES open/H/L', async () => {
    H.delivering = false
    vi.setSystemTime((T1400 + 120) * 1000)              // 14:02 ET, mid 14:00 bucket
    const bars = mkBars({ o: 20, h: 20.3, l: 19.7, c: 20, v: 1000 }).slice(0, -1)   // tail = 13:55
    const view = render(<StockChart sym="SYN" tf="5" barsOverride={bars} />)
    await act(async () => { await Promise.resolve() })
    const offset = tail().time - (T1400 - 300)
    // First thing we see of the 14:00 bucket: a quote mid-way through it.
    H.prices = { SYN: { price: 20.4, updated_at: T1400 + 100 } }
    view.rerender(<StockChart sym="SYN" tf="5" barsOverride={bars} />)
    await act(async () => { await Promise.resolve() })
    expect(tail()).toMatchObject({ time: T1400 + offset, open: 20.4, close: 20.4 })
    // The push stream starts delivering: its subscribe seed is the bucket to date.
    H.delivering = true
    view.rerender(<StockChart sym="SYN" tf="5" barsOverride={bars} />)
    await act(async () => { await Promise.resolve() })
    push(T1400, 19.9, 20.6, 19.8, 20.45, 3000)
    expect(tail()).toMatchObject({ time: T1400 + offset, open: 19.9, high: 20.6, low: 19.8, close: 20.45 })
    // Now authoritative: open is set once, H/L only widen.
    push(T1400, 20.1, 20.5, 19.85, 20.3, 3100)
    expect(tail()).toMatchObject({ open: 19.9, high: 20.6, low: 19.8, close: 20.3 })
  })

  it('a poll whose tail HAS the bucket replaces the provisional open/H/L (live close stands)', async () => {
    H.delivering = false
    vi.setSystemTime((T1400 + 120) * 1000)
    const bars = mkBars({ o: 20, h: 20.3, l: 19.7, c: 20, v: 1000 }).slice(0, -1)
    const view = render(<StockChart sym="SYN" tf="5" barsOverride={bars} />)
    await act(async () => { await Promise.resolve() })
    const offset = tail().time - (T1400 - 300)
    H.prices = { SYN: { price: 20.9, updated_at: T1400 + 100 } }
    view.rerender(<StockChart sym="SYN" tf="5" barsOverride={bars} />)
    await act(async () => { await Promise.resolve() })
    expect(tail()).toMatchObject({ time: T1400 + offset, open: 20.9, low: 20.9 })
    // The poll lands with the 14:00 bucket to date.
    view.rerender(<StockChart sym="SYN" tf="5" barsOverride={mkBars({ o: 19.9, h: 20.95, l: 19.6, c: 20.8, v: 4000 })} />)
    await act(async () => { await Promise.resolve() })
    expect(tail()).toMatchObject({ time: T1400 + offset, open: 19.9, high: 20.95, low: 19.6, close: 20.9 })
  })
})
