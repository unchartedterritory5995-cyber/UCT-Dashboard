import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'

// ─── W-O (2026-11-11): TIMEFRAME SWITCH, TC2000 FRAMING ───────────────────────
//
// Owner, live: switching 1m→5m→15m→30m→60m in TC2000 keeps the DEVELOPING candle at the
// same x near the right edge, same bar spacing, never a later shift — and the developing
// candle is complete (wick and all) on the first frame. Rules proven here, on the real
// component with a lightweight-charts stand-in whose TIME SCALE follows the library's own
// rules (rightOffset measured from the last REAL bar; a bar appended to the right keeps
// rightOffset when shiftVisibleRangeOnNewBar is on, so the frame slides; a whitespace
// slot REPLACED by a bar moves nothing):
//   1. The developing bar's pixel x and the bar spacing on the FIRST frame after a switch
//      equal the outgoing view's, and never change while the network lands.
//   2. The developing bar on the FIRST frame has the true bucket-to-date O/H/L/C (built
//      from the series already in memory), equal to the final one.
// All prices are synthetic.

const T = vi.hoisted(() => ({ ts: null, series: [], onBar: null, push: null }))
vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  const W = 600
  const ts = {
    points: [], base: null, rightOffset: 0, barSpacing: 6, opts: { shiftVisibleRangeOnNewBar: true },
    subs: new Set(),
  }
  T.ts = ts
  const isWs = (p) => p && p.open === undefined && p.value === undefined
  const recompute = () => {
    const oldPts = ts.points
    const oldBase = ts.base
    const set = new Set()
    let newBase = null
    for (const s of T.series) for (const p of s.__data) set.add(p.time)
    const pts = [...set].sort((a, b) => a - b)
    for (const s of T.series) {
      for (let i = s.__data.length - 1; i >= 0; i--) {
        if (!isWs(s.__data[i])) { const ix = pts.indexOf(s.__data[i].time); if (newBase == null || ix > newBase) newBase = ix; break }
      }
    }
    const same = oldPts.length === pts.length && oldPts.every((t, i) => t === pts[i])
    if (oldPts.length && pts.length && oldBase != null && newBase != null) {
      const to = oldBase + ts.rightOffset
      const from = to - W / ts.barSpacing + 1
      const lastVisible = oldBase >= from && oldBase <= to
      const leftShift = pts[0] < oldPts[0]
      // LWC compares base INDEXES; with a prepend the old base moves right by the prepend count.
      const prepended = leftShift ? pts.indexOf(oldPts[0]) : 0
      const added = newBase > oldBase + prepended
      const needShift = lastVisible && !same && ts.opts.shiftVisibleRangeOnNewBar
      if (added && !leftShift && !needShift) ts.rightOffset -= (newBase - oldBase)
    }
    ts.points = pts
    ts.base = newBase
  }
  const makeSeries = (ctor, options) => {
    const s = {
      __ctor: ctor, __options: { ...(options || {}) }, __data: [],
      setData: (d) => { s.__data = [...(d || [])]; recompute() },
      update: (p, historical) => {
        if (!p) return
        const i = s.__data.findIndex(d => d.time === p.time)
        if (historical) { if (i < 0) throw new Error('missing'); s.__data[i] = p; return }
        const last = s.__data[s.__data.length - 1]
        if (last && p.time < last.time) throw new Error('Cannot update oldest data')
        if (last && last.time === p.time) s.__data = [...s.__data.slice(0, -1), p]
        else s.__data = [...s.__data, p]
        recompute()
      },
      applyOptions: (o) => { Object.assign(s.__options, o || {}) },
      priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
      createPriceLine: () => ({ applyOptions: () => {} }), removePriceLine: () => {}, setMarkers: () => {},
      attachPrimitive: () => {}, detachPrimitive: () => {},
      priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => s.__options,
      moveToPane: () => {}, getPane: () => ({ getHeight: () => 300, paneIndex: () => 0 }),
      dataByIndex: () => null, data: () => s.__data, barsInLogicalRange: () => null,
      priceFormatter: () => ({ format: (p) => String(p) }),
    }
    T.series.push(s)
    return s
  }
  const range = () => {
    if (ts.base == null) return null
    const to = ts.base + ts.rightOffset
    return { from: to - W / ts.barSpacing + 1, to }
  }
  const timeScale = new Proxy({
    applyOptions: (o) => { Object.assign(ts.opts, o || {}); if (o && Number.isFinite(o.barSpacing)) ts.barSpacing = o.barSpacing },
    setVisibleLogicalRange: ({ from, to }) => {
      if (ts.base == null) return
      ts.barSpacing = W / (to - from + 1)
      ts.rightOffset = to - ts.base
    },
    getVisibleLogicalRange: () => range(),
    getVisibleRange: () => null, setVisibleRange: () => {}, fitContent: () => {},
    scrollToPosition: (p) => { ts.rightOffset = p }, scrollPosition: () => ts.rightOffset,
    timeToCoordinate: () => 0, coordinateToTime: () => null, logicalToCoordinate: () => 0, coordinateToLogical: () => 0,
    options: () => ({ ...ts.opts, barSpacing: ts.barSpacing, rightOffset: ts.rightOffset }),
    width: () => W, height: () => 40,
    barSpacing: () => ts.barSpacing,
  }, { get: (t, p) => (p in t ? t[p] : (typeof p === 'symbol' || p === 'then') ? undefined : () => undefined) })
  const chart = {
    addSeries: (ctor, options) => makeSeries(ctor, options),
    addCustomSeries: (_i, options) => makeSeries('custom', options),
    removeSeries: (s) => { const i = T.series.indexOf(s); if (i >= 0) T.series.splice(i, 1); recompute() },
    applyOptions: (o) => { if (o?.timeScale) Object.assign(ts.opts, o.timeScale) },
    priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => timeScale,
    paneSize: () => ({ width: W, height: 300 }),
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {},
    subscribeClick: () => {}, unsubscribeClick: () => {}, subscribeDblClick: () => {}, unsubscribeDblClick: () => {},
    panes: () => [0, 1, 2, 3].map(() => ({
      getHeight: () => 300, setHeight: () => {}, getHTMLElement: () => document.createElement('div'),
      priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    })),
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return { ...real, createChart: (_el, o) => { if (o?.timeScale) Object.assign(ts.opts, o.timeScale); return chart }, createSeriesMarkers: () => ({ setMarkers: () => {} }) }
})
vi.mock('../utils/barsIDB', async (orig) => {
  const real = await orig()
  return { ...real, idbGet: async () => null, idbPut: async () => {} }
})
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
// The push stream is NOT mocked away: tests drive Writer B through the captured onBar.
vi.mock('../hooks/useRealtimeBars', () => ({ default: ({ onBar }) => { T.onBar = onBar; return T.push || {} } }))
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

// Wed 2026-11-11 12:47:20 ET (EST = UTC-5) — mid-session, mid-bucket on every tf.
const NOW_ISO = '2026-11-11T17:47:20Z'
const clock = pinWallClock(NOW_ISO)
afterAll(() => clock.restore())

const { default: StockChart } = await import('./StockChart')
const { memPut, memClear } = await import('../utils/barsMemCache')
const { bucketStartUnix } = await import('./chart/barTime')
const { toChartTime } = await import('./chart/barTime')

const et = (d, h, m) => Math.floor(Date.UTC(2026, 10, d, h + 5, m) / 1000)
const NOW = Math.floor(Date.parse(NOW_ISO) / 1000)
// Synthetic 1m truth: Tue 11-10 full RTH + Wed 11-11 09:30 → the minute forming now.
// A deterministic zig-zag so each bucket has a distinct O/H/L/C and wick.
function truth1m(asOf = NOW) {
  const out = []
  const day = (d, endT) => {
    for (let t = et(d, 9, 30); t < Math.min(et(d, 16, 0), endT + 1); t += 60) {
      const k = (t / 60) % 97
      const base = 50 + (k % 13) * 0.1 - (k % 7) * 0.05
      const o = base, c = base + ((k % 3) - 1) * 0.07
      out.push({ t, o, h: Math.max(o, c) + 0.03 + (k % 5) * 0.01, l: Math.min(o, c) - 0.03 - (k % 4) * 0.01, c, v: 100 + k })
    }
  }
  day(10, et(10, 16, 0)); day(11, asOf)
  return out
}
function agg(bars, tf) {
  if (tf === '1') return bars.map(b => ({ ...b }))
  const m = new Map()
  for (const b of bars) {
    const s = bucketStartUnix(b.t, Number(tf), { grid: 'session' })
    const a = m.get(s)
    if (!a) m.set(s, { t: s, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })
    else { a.h = Math.max(a.h, b.h); a.l = Math.min(a.l, b.l); a.c = b.c; a.v += b.v }
  }
  return [...m.values()].sort((x, y) => x.t - y.t)
}
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))

let reqs
function serve({ latency = 400 } = {}) {
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    if (!u.includes('/api/bars/')) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    const m = u.match(/\/api\/bars\/([^?]+)\?tf=([^&]+)/)
    const since = (u.match(/[?&]since=(\d+)/) || [])[1]
    reqs.push({ url: u, since })
    const all = agg(truth1m(), m[2])
    const body = since
      ? { ticker: 'SYN', tf: m[2], delta: true, bars: all.filter(b => b.t > Number(since)) }
      : { ticker: 'SYN', tf: m[2], bars: all }
    return new Promise((res) => setTimeout(() => res({ ok: true, status: 200, json: async () => body }), latency))
  }))
}

const candle = () => T.series.find(s => s.__ctor === real().CandlestickSeries) || T.series[0]
let _real = null
const real = () => _real
// One sampled "painted frame": where the newest REAL candle sits on screen and its OHLC.
// A chart with no real candle is a BLANK frame — recorded, never skipped (review F1).
function frame() {
  const ts = T.ts
  const c = candle()
  if (!c) return null   // not mounted yet
  const d = c.__data.filter(p => p.open !== undefined)
  const last = d[d.length - 1]
  if (!last || ts.base == null) return { blank: true }
  const idx = ts.points.indexOf(last.time)
  const x = 600 - (ts.base + ts.rightOffset - idx + 0.5) * ts.barSpacing
  return { time: last.time, x: Math.round(x * 100) / 100, sp: Math.round(ts.barSpacing * 1000) / 1000, o: last.open, h: last.high, l: last.low, c: last.close }
}
function recorder() {
  const frames = []
  const id = setInterval(() => {
    const f = frame()
    const p = frames[frames.length - 1]
    if (f && (!p || JSON.stringify(p) !== JSON.stringify(f))) frames.push(f)
  }, 2)
  return { frames, stop: () => clearInterval(id) }
}
const devBar = (tf) => {
  const a = agg(truth1m(), tf)
  const b = a[a.length - 1]
  return { time: toChartTime(b.t), o: b.o, h: b.h, l: b.l, c: b.c }
}

beforeEach(async () => {
  // Every test starts at the same instant: the shifted clock keeps running, and a file
  // that drifts past the minute would make the synthetic "now" stale.
  clock.retarget(NOW_ISO)
  cleanup(); memClear(); reqs = []
  T.push = null; T.onBar = null
  T.series.length = 0
  _real = await vi.importActual('lightweight-charts')
  try { localStorage.setItem('barspack.version', '2026-11-10') } catch { /* */ }
})

async function mountAt(tf) {
  serve({ latency: 30 })
  const view = render(<StockChart sym="SYN" tf={tf} backgroundWarm={false} forceExtendedHours={false} />)
  await wait(400)
  return view
}

describe('tf switch: first frame pinned + complete developing bar', () => {
  for (const [from, to] of [['1', '5'], ['5', '15'], ['15', '30'], ['30', '60'], ['5', '60'], ['1', '60'], ['60', '5'], ['30', '1']]) {
    it(`${from}m → ${to}m with a BEHIND cache for ${to}m and a slow network`, async () => {
      const view = await mountAt(from)
      const before = frame()
      expect(before.time).toBe(devBar(from).time)
      // The target tf was viewed ~1h ago: its cached tail stops at 11:45 (sound, behind).
      memPut('SYN', to, agg(truth1m(et(11, 11, 45)), to), { savedAt: (et(11, 11, 45) + 20) * 1000 })
      serve({ latency: 400 })
      const rec = recorder()
      view.rerender(<StockChart sym="SYN" tf={to} backgroundWarm={false} forceExtendedHours={false} />)
      await wait(900)
      rec.stop()
      while (rec.frames.length && JSON.stringify(rec.frames[0]) === JSON.stringify(before)) rec.frames.shift()
      expect(frame()).toMatchObject({ time: devBar(to).time, o: devBar(to).o, h: devBar(to).h, l: devBar(to).l, c: devBar(to).c })
      const dev = devBar(to)
      const fr = rec.frames
      // Every frame after the switch: the newest real candle IS the developing bucket,
      // at the outgoing x, outgoing spacing, with the full bucket-to-date OHLC.
      for (const f of fr) {
        expect({ time: f.time, x: f.x, sp: f.sp }).toEqual({ time: dev.time, x: before.x, sp: before.sp })
        expect([f.o, f.h, f.l, f.c]).toEqual([dev.o, dev.h, dev.l, dev.c])
      }
    })
  }

  it('5m → 60m with a CURRENT-but-partial 60m cache (developing bar cached early): first frame has the full wick', async () => {
    const view = await mountAt('5')
    const before = frame()
    // Cached at 12:35: the 12:30 hour bar holds only 12:30-12:35.
    memPut('SYN', '60', agg(truth1m(et(11, 12, 35)), '60'), { savedAt: (et(11, 12, 35) + 20) * 1000 })
    serve({ latency: 400 })
    const rec = recorder()
    view.rerender(<StockChart sym="SYN" tf="60" backgroundWarm={false} forceExtendedHours={false} />)
    await wait(900)
    rec.stop()
      while (rec.frames.length && JSON.stringify(rec.frames[0]) === JSON.stringify(before)) rec.frames.shift()
      expect(frame()).toMatchObject({ time: devBar('60').time, o: devBar('60').o, h: devBar('60').h, l: devBar('60').l, c: devBar('60').c })
    const dev = devBar('60')
    for (const f of rec.frames) {
      expect({ time: f.time, x: f.x, sp: f.sp }).toEqual({ time: dev.time, x: before.x, sp: before.sp })
      expect([f.o, f.h, f.l, f.c]).toEqual([dev.o, dev.h, dev.l, dev.c])
    }
  })
})

// ── INVARIANT, over arbitrary switch sequences ────────────────────────────────
// For ANY sequence of intraday timeframe switches and ANY local-cache state of the
// target (none · behind · cached mid-bucket · current), every painted frame after a
// switch shows the target's developing bucket as the newest candle, at the outgoing
// frame's x and bar spacing, with the authoritative bucket-to-date O/H/L/C.
describe('invariant: newest-bar x + developing OHLC across random tf-switch sequences', () => {
  const TFS = ['1', '5', '15', '30', '60']
  const rng = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  for (const seed of [7, 1234]) {
    it(`sequence seed=${seed}`, async () => {
      const r = rng(seed)
      let tf = TFS[Math.floor(r() * TFS.length)]
      const view = await mountAt(tf)
      for (let step = 0; step < 6; step++) {
        const before = frame()
        expect(before.time).toBe(devBar(tf).time)
        let next = tf
        while (next === tf) next = TFS[Math.floor(r() * TFS.length)]
        const cache = ['none', 'behind', 'partial', 'current'][Math.floor(r() * 4)]
        memClear()
        if (cache === 'behind') memPut('SYN', next, agg(truth1m(et(11, 11, 40)), next), { savedAt: (et(11, 11, 40) + 20) * 1000 })
        if (cache === 'partial') memPut('SYN', next, agg(truth1m(NOW - 50), next), { savedAt: (NOW - 50) * 1000 })
        if (cache === 'current') memPut('SYN', next, agg(truth1m(), next))
        serve({ latency: 150 + Math.floor(r() * 400) })
        const rec = recorder()
        view.rerender(<StockChart sym="SYN" tf={next} backgroundWarm={false} forceExtendedHours={false} />)
        await wait(800)
        rec.stop()
        while (rec.frames.length && JSON.stringify(rec.frames[0]) === JSON.stringify(before)) rec.frames.shift()
        const dev = devBar(next)
        const ctx = `${tf}→${next} cache=${cache}`
        // The one allowed non-final value (review F1b, instant paint): switching to a FINER tf
        // with a cache written DURING the forming bucket paints that cache's developing bar (an
        // earlier observation of the same bucket — live writers keep it moving) until the
        // answer lands. Everything else must be the authoritative bucket-to-date bar.
        const okOhlc = [[dev.o, dev.h, dev.l, dev.c]]
        if (cache === 'partial' && Number(next) < Number(tf)) {
          const pb = agg(truth1m(NOW - 50), next).at(-1)
          if (toChartTime(pb.t) === dev.time) okOhlc.push([pb.o, pb.h, pb.l, pb.c])
        }
        const all = [...rec.frames, frame()]
        for (const f of all) {
          expect({ ctx, time: f.time, x: f.x, sp: f.sp }).toEqual({ ctx, time: dev.time, x: before.x, sp: before.sp })
          expect({ ctx, ok: okOhlc.some(o => JSON.stringify(o) === JSON.stringify([f.o, f.h, f.l, f.c])) }).toEqual({ ctx, ok: true })
        }
        const fin = all[all.length - 1]
        expect({ ctx, ohlc: [fin.o, fin.h, fin.l, fin.c] }).toEqual({ ctx, ohlc: [dev.o, dev.h, dev.l, dev.c] })
        tf = next
      }
    }, 20000)
  }
})

describe('review F1/F1b: a switch never blanks, and a COMPLETE finer cache still paints instantly', () => {
  for (const [from, to] of [['60', '5'], ['30', '1'], ['5', '1']]) {
    it(`${from}m → ${to}m with NO cache: the previous frame stays on screen (never blank) until the complete answer`, async () => {
      const view = await mountAt(from)
      const before = frame()
      serve({ latency: 400 })
      const rec = recorder()
      view.rerender(<StockChart sym="SYN" tf={to} backgroundWarm={false} forceExtendedHours={false} />)
      await wait(900)
      rec.stop()
      expect(rec.frames.filter(f => f.blank)).toEqual([])
      while (rec.frames.length && JSON.stringify(rec.frames[0]) === JSON.stringify(before)) rec.frames.shift()
      const dev = devBar(to)
      for (const f of [...rec.frames, frame()]) {
        expect({ time: f.time, x: f.x, sp: f.sp }).toEqual({ time: dev.time, x: before.x, sp: before.sp })
        expect([f.o, f.h, f.l, f.c]).toEqual([dev.o, dev.h, dev.l, dev.c])
      }
    })
  }

  it('5m → 1m with a CURRENT 1m mem cache written during the forming minute paints BEFORE the network answers', async () => {
    const view = await mountAt('5')
    const before = frame()
    memPut('SYN', '1', agg(truth1m(), '1'))   // savedAt = now, inside the forming minute
    serve({ latency: 2000 })
    view.rerender(<StockChart sym="SYN" tf="1" backgroundWarm={false} forceExtendedHours={false} />)
    await wait(150)
    const dev = devBar('1')
    expect(frame()).toEqual({ time: dev.time, x: before.x, sp: before.sp, o: dev.o, h: dev.h, l: dev.l, c: dev.c })
  })
})

describe('review: Writer B (push) during a tf-switch hold', () => {
  it('60m → 5m, push delivering, the 5m subscribe seed lands BEFORE REST: nothing is planted on the held 60m series, and the seed is folded on the real paint', async () => {
    T.push = { connected: true, healthy: true, delivering: true, lastBarT: { current: null } }
    const view = await mountAt('60')
    const before = frame()
    serve({ latency: 400 })
    const rec = recorder()
    view.rerender(<StockChart sym="SYN" tf="5" backgroundWarm={false} forceExtendedHours={false} />)
    await wait(60)
    const dev = devBar('5')
    const devUnix = agg(truth1m(), '5').at(-1).t
    // the seed: the bucket to date, one print newer than REST will be
    const seedC = Math.round((dev.c + 0.01) * 100) / 100
    act(() => { T.onBar({ sym: 'SYN', tf: '5', bar: { t: devUnix * 1000, o: dev.o, h: Math.max(dev.h, seedC), l: dev.l, c: seedC, v: 999 } }) })
    await wait(900)
    rec.stop()
    expect(rec.frames.filter(f => f.blank)).toEqual([])
    while (rec.frames.length && JSON.stringify(rec.frames[0]) === JSON.stringify(before)) rec.frames.shift()
    // every frame after the old one is the new tf's developing bar at the pinned slot
    for (const f of rec.frames) expect({ time: f.time, x: f.x, sp: f.sp }).toEqual({ time: dev.time, x: before.x, sp: before.sp })
    // …and the seed was not lost: the final developing bar carries its close
    expect(frame()).toMatchObject({ time: dev.time, x: before.x, o: dev.o, l: dev.l, c: seedC, h: Math.max(dev.h, seedC) })
  })
})
