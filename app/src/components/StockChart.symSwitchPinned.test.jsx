import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'

// ─── W-R (2026-11-11): SYMBOL + TIMEFRAME SWITCH, TC2000 FRAMING ───────────────
//
// Owner, live 12:08 ET 5m: NVDA → TZA moved the newest candle. NVDA's sat well left of the
// price axis with empty future slots on the right; TZA's sat at the axis. "It should stay
// locked in place." TC2000 keeps the newest candle at the same x (constant right margin,
// constant bar spacing) on every symbol and timeframe switch.
// Root cause: the intraday framing reserve (`_intradayLoadReserve`) added up to 3 empty
// slots whenever the loaded tail was BEHIND the wall clock — a right margin that was a
// function of the data state (behind cache, behind server answer, any RTH chart after the
// bell), with nothing in the series to fill it. Policy now: ONE frame (`pinNewestRange`):
// the newest REAL bar a constant gap from the right edge at a constant spacing, on every
// symbol switch, tf switch and load phase, whatever the cache / network state.
// Same lightweight-charts time-scale stand-in as StockChart.tfSwitchPinned.test.jsx (it
// follows the library's rules: rightOffset measured from the last REAL bar; an appended bar
// keeps rightOffset under shiftVisibleRangeOnNewBar). All prices are synthetic.

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
    timeToIndex: (t) => { const i = ts.points.indexOf(t); return i < 0 ? null : i },
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
const candle = () => T.series.find(s => s.__ctor === real().CandlestickSeries) || T.series[0]
let _real = null
const real = () => _real
// One sampled "painted frame": where the newest REAL candle sits on screen and its OHLC.
function frame() {
  const ts = T.ts
  const c = candle()
  if (!c) return null
  const d = c.__data.filter(p => p.open !== undefined)
  const last = d[d.length - 1]
  if (!last || ts.base == null) return { blank: true }
  const idx = ts.points.indexOf(last.time)
  const x = 600 - (ts.base + ts.rightOffset - idx + 0.5) * ts.barSpacing
  // Geometry only: the newest real candle's pixel x, the bar spacing, and its logical offset
  // from the right edge (bars of right margin).
  return { time: last.time, x: Math.round(x * 100) / 100, sp: Math.round(ts.barSpacing * 1000) / 1000, ro: Math.round((ts.base + ts.rightOffset - idx) * 1000) / 1000 }
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
const geo = (f) => ({ x: f.x, sp: f.sp, ro: f.ro })

// Per-symbol synthetic truth: different history depths (so bar counts differ between
// symbols, as NVDA's and TZA's do), and a STALE server for DDD (the answer itself is behind —
// the 'stale-swr' / 'delta-deadline' first answers seen in prod).
const DEPTH = { AAA: 10, BBB: 11, CCC: 9, DDD: 10 }
const STALE = new Set(['DDD'])
const STALE_ASOF = et(11, 11, 25)
function truthSym(sym, asOf = NOW) {
  const s = DEPTH[sym] || 10
  return truth1m(STALE.has(sym) ? Math.min(asOf, STALE_ASOF) : asOf).filter(b => b.t >= et(s, 9, 30))
}
function serveSyms({ latency = 400 } = {}) {
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    if (!u.includes('/api/bars/')) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    const m = u.match(/\/api\/bars\/([^?]+)\?tf=([^&]+)/)
    const sym = decodeURIComponent(m[1]).toUpperCase()
    const since = (u.match(/[?&]since=(\d+)/) || [])[1]
    reqs.push({ url: u, since })
    const all = agg(truthSym(sym), m[2])
    const body = since
      ? { ticker: sym, tf: m[2], delta: true, bars: all.filter(b => b.t > Number(since)) }
      : { ticker: sym, tf: m[2], bars: all }
    return new Promise((res) => setTimeout(() => res({ ok: true, status: 200, json: async () => body }), latency))
  }))
}
function seedCache(sym, tf, kind) {
  if (kind === 'behind') memPut(sym, tf, agg(truthSym(sym, et(11, 11, 40)), tf), { savedAt: (et(11, 11, 40) + 20) * 1000 })
  if (kind === 'partial') memPut(sym, tf, agg(truthSym(sym, NOW - 50), tf), { savedAt: (NOW - 50) * 1000 })
  if (kind === 'current') memPut(sym, tf, agg(truthSym(sym), tf))
}

beforeEach(async () => {
  clock.retarget(NOW_ISO)
  cleanup(); memClear(); reqs = []
  T.push = null; T.onBar = null
  T.series.length = 0
  _real = await vi.importActual('lightweight-charts')
  try { localStorage.setItem('barspack.version', '2026-11-10') } catch { /* */ }
})

const { _intradayLoadReserve } = await import('./StockChart')
const { pinNewestRange } = await import('./chart/rightMargin')

describe('pinNewestRange: the one pinned-right frame', () => {
  it('places the newest bar a constant fraction of the width from the right edge, independent of the bar count', () => {
    for (const n of [5, 80, 3000]) {
      const r = pinNewestRange(n - 1, 80, 600)
      expect(r.to - r.from).toBe(80)
      expect((r.to - (n - 1)) / 80).toBeCloseTo(34 / 600, 9)   // MIN_RIGHT_GAP_PX wins at 600px
    }
    const wide = pinNewestRange(99, 100, 1200)
    expect((wide.to - 99) / 100).toBeCloseTo(0.05, 9)          // LAST_CANDLE_POS 0.95
  })
  it('intraday never reserves future slots, however far behind the tail is (incl. after the bell)', () => {
    for (const tf of ['1', '5', '15', '30', '60']) {
      for (const lagMin of [0, 7, 40, 300, 2000]) {
        expect({ tf, lagMin, r: _intradayLoadReserve([{ t: NOW - lagMin * 60 }], tf) }).toEqual({ tf, lagMin, r: 0 })
      }
    }
  })
})

describe('symbol switch: newest candle locked in place (NVDA -> TZA)', () => {
  for (const keep of [false, true]) {
    for (const cache of ['none', 'behind', 'partial', 'current']) {
      it(`keepPresentOnSymbolChange=${keep}, target cache=${cache}: every frame has the outgoing x, spacing and right margin`, async () => {
        serveSyms({ latency: 30 })
        const P = { tf: '5', backgroundWarm: false, forceExtendedHours: false, keepPresentOnSymbolChange: keep }
        const view = render(<StockChart sym="AAA" {...P} />)
        await wait(400)
        const before = frame()
        seedCache('BBB', '5', cache)
        serveSyms({ latency: 400 })
        const rec = recorder()
        view.rerender(<StockChart sym="BBB" {...P} />)
        await wait(900)
        rec.stop()
        const drawn = [...rec.frames, frame()].filter(f => !f.blank)
        expect(drawn.at(-1).time).toBe(toChartTime(agg(truthSym('BBB'), '5').at(-1).t))
        for (const f of drawn) expect({ cache, ...geo(f) }).toEqual({ cache, ...geo(before) })
      })
    }
  }

  it('keep-present off, symbols whose bar counts differ by a few bars (black frame between): the outgoing geometry is kept exactly', async () => {
    // DDD's server tail is stale, so on 60m AAA has 2 more bars than DDD — inside the old
    // ±8-bar "was the range already re-mapped?" guess window, which framed AAA 2 bars off.
    serveSyms({ latency: 30 })
    const P = { tf: '60', backgroundWarm: false, forceExtendedHours: false, keepPresentOnSymbolChange: false }
    const view = render(<StockChart sym="DDD" {...P} />)
    await wait(400)
    const before = frame()
    serveSyms({ latency: 300 })
    const rec = recorder()
    view.rerender(<StockChart sym="AAA" {...P} />)
    await wait(700)
    rec.stop()
    const drawn = [...rec.frames, frame()].filter(f => !f.blank)
    expect(drawn.at(-1).time).toBe(toChartTime(agg(truthSym('AAA'), '60').at(-1).t))
    for (const f of drawn) expect(geo(f)).toEqual(geo(before))
  })

  it('a server answer that is itself BEHIND frames exactly like a current one (no reserved future slots)', async () => {
    serveSyms({ latency: 30 })
    const P = { tf: '5', backgroundWarm: false, forceExtendedHours: false, keepPresentOnSymbolChange: true }
    const view = render(<StockChart sym="AAA" {...P} />)
    await wait(400)
    const before = frame()
    const rec = recorder()
    view.rerender(<StockChart sym="DDD" {...P} />)
    await wait(600)
    rec.stop()
    const drawn = [...rec.frames, frame()].filter(f => !f.blank)
    expect(drawn.at(-1).time).toBe(toChartTime(agg(truthSym('DDD'), '5').at(-1).t))
    for (const f of drawn) expect(geo(f)).toEqual(geo(before))
  })
})

// ── LOGICAL vs CANDLE INDEX SPACE (integrator review) ─────────────────────────────
// A compare/overlay series shares the time axis: its own times add INTERIOR logical slots,
// and a compare bar NEWER than the candle's newest moves the axis' base past the candle.
// The pin must still put the newest CANDLE at the outgoing x — the intended frame is
// converted to logical indices once (timeToIndex of the newest real candle, base read off
// the time scale), not fed to scrollToPosition in candle-index space.
describe('symbol switch with a compare series on the shared axis', () => {
  for (const kind of ['interior times', 'interior times + a NEWER compare bar']) {
    for (const keep of [false, true]) {
      it(`${kind}, keepPresent=${keep}: the newest candle keeps the outgoing x, spacing and margin`, async () => {
        serveSyms({ latency: 30 })
        const P = { tf: '5', backgroundWarm: false, forceExtendedHours: false, keepPresentOnSymbolChange: keep }
        const view = render(<StockChart sym="AAA" {...P} />)
        await wait(400)
        const geo0 = geo(frame())
        // A stand-in compare series (as chart.addSeries would make): points 2 min after each of
        // the last 40 candles, plus optionally one bar 2 min after the newest candle.
        const c = candle()
        const times = c.__data.filter(p => p.open !== undefined).map(p => p.time)
        const pts = times.slice(-41, -1).map(t => ({ time: t + 120, value: 1 }))
        if (kind.includes('NEWER')) pts.push({ time: times.at(-1) + 120, value: 1 })
        const cmp = { __ctor: 'compare', __options: {}, __data: pts, setData() {}, update() {}, applyOptions() {}, data: () => pts }
        T.series.push(cmp)
        c.setData(c.__data)   // re-merge the axis with the compare series on it
        // Re-pin the outgoing chart the way a member would see it (the compare bar's own
        // arrival is not under test) — then every frame after the switch must equal it.
        const ro0 = T.ts.points.length && (T.ts.base + T.ts.rightOffset - T.ts.points.indexOf(times.at(-1)))
        T.ts.rightOffset += geo0.ro - ro0
        const before = frame()
        expect(geo(before)).toEqual(geo0)
        seedCache('BBB', '5', 'behind')
        serveSyms({ latency: 300 })
        const rec = recorder()
        view.rerender(<StockChart sym="BBB" {...P} />)
        await wait(800)
        rec.stop()
        const drawn = [...rec.frames, frame()].filter(f => !f.blank)
        expect(drawn.at(-1).time).toBe(toChartTime(agg(truthSym('BBB'), '5').at(-1).t))
        for (const f of drawn) expect({ kind, ...geo(f) }).toEqual({ kind, ...geo(before) })
      })
    }
  }
})

// ── INVARIANT over arbitrary sequences of SYMBOL and TIMEFRAME switches ─────────────
// For ANY sequence mixing symbol switches (typed search, watchlist click, keyboard scan and
// Agent commands all reach StockChart as a new `sym` prop) and timeframe switches, across
// target cache states (none · behind · partial · current) and current/behind server answers,
// on both host kinds (keepPresentOnSymbolChange on/off): every drawn frame shows the newest
// real candle at the SAME pixel x, the SAME bar spacing and the SAME logical right margin as
// the very first frame — which is itself the canonical pinNewestRange frame.
describe('invariant: newest-bar geometry across random symbol + tf switch sequences', () => {
  const TFS = ['1', '5', '15', '30', '60']
  const SYMS = ['AAA', 'BBB', 'CCC', 'DDD']
  const rng = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  for (const [seed, keep] of [[11, true], [29, false], [4242, true], [77, false]]) {
    it(`seed=${seed} keepPresent=${keep}`, async () => {
      const r = rng(seed)
      let tf = TFS[Math.floor(r() * TFS.length)]
      let sym = SYMS[Math.floor(r() * SYMS.length)]
      serveSyms({ latency: 30 })
      const P = (s, t) => ({ sym: s, tf: t, backgroundWarm: false, forceExtendedHours: false, keepPresentOnSymbolChange: keep })
      const view = render(<StockChart {...P(sym, tf)} />)
      await wait(400)
      const first = frame()
      // The first frame IS the canonical pin: right margin = width * (1 - lastCandlePos(600)).
      const width = 600 / first.sp - 1
      expect(first.ro).toBeCloseTo(pinNewestRange(0, width, 600).to, 2)
      for (let step = 0; step < 8; step++) {
        const symSwitch = r() < 0.6
        let nSym = sym, nTf = tf
        if (symSwitch) { while (nSym === sym) nSym = SYMS[Math.floor(r() * SYMS.length)] }
        else { while (nTf === tf) nTf = TFS[Math.floor(r() * TFS.length)] }
        const cache = ['none', 'behind', 'partial', 'current'][Math.floor(r() * 4)]
        memClear()
        seedCache(nSym, nTf, cache)
        serveSyms({ latency: 120 + Math.floor(r() * 400) })
        const rec = recorder()
        view.rerender(<StockChart {...P(nSym, nTf)} />)
        await wait(750)
        rec.stop()
        const ctx = `${sym}/${tf} -> ${nSym}/${nTf} cache=${cache}`
        const drawn = [...rec.frames, frame()].filter(f => !f.blank)

        expect({ ctx, drawn: drawn.length > 0 }).toEqual({ ctx, drawn: true })
        for (const f of drawn) expect({ ctx, ...geo(f) }).toEqual({ ctx, ...geo(first) })
        sym = nSym; tf = nTf
      }
    }, 30000)
  }
})
