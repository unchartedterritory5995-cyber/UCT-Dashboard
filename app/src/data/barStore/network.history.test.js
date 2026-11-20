// network.js + historyFeed.js: scroll-back asks the history lake first for intraday keys, falls back
// to the server window when the lake has nothing / fails / disagrees at the join, keeps ≤1 request
// per key across both, and gives a subscribed chart one window of depth as soon as it is answered.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRegistry } from './registry'
import { createNetwork, ANSWER_WINDOW_DELAY_MS } from './network'
import { keyOf } from './types'
import { LAKE_WINDOW_BARS } from '../../utils/historyPrepend'
import { bucketStartUnix } from '../../components/chart/barTime'
import { bucketEndUnix } from '../../components/chart/liveBuckets'

const T0 = Date.UTC(2026, 10, 10, 15, 0)   // Tue 2026-11-10 10:00 ET
const OPEN = Date.UTC(2026, 10, 10, 14, 30) / 1000
const PREV = Date.UTC(2026, 10, 9, 20, 55) / 1000   // 15:55 ET the day before

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0) })
afterEach(() => { vi.useRealTimers() })

function answer(key) {
  const [sym, tfS] = key.split('_')
  const tf = Number(tfS)
  const now = Math.floor(Date.now() / 1000)
  const bars = []
  for (let t = OPEN; t <= now; t = bucketEndUnix(t, tf, {})) bars.push({ t: bucketStartUnix(t, tf, {}), o: 100, h: 101, l: 99, c: 100.5, v: 10 })
  return { bars, contract: 1, grid: 'eth-clock', session: 'rth', cache_key: `b1:${sym}:${tfS}:eth-clock`, series_rev: Date.now(),
    history_rev: 1, verified_through: now, complete_through: now - 60, developing: null, tail_status: 'verified' }
}
const SERVER_OLD = { t: PREV - 300, o: 7, h: 8, l: 6, c: 7.5, v: 1 }

/** One shared in-flight counter over the server AND the lake: ≤1 per key means across both. */
function world({ lake = null, server = null } = {}) {
  const calls = []
  let live = 0, maxLive = 0
  const track = async (what, fn) => {
    calls.push(what); live++; maxLive = Math.max(maxLive, live)
    try { return await fn() } finally { live-- }
  }
  const request = vi.fn((url, opts) => track(url, async () => {
    await new Promise((r) => setTimeout(r, 5))
    if (server) return server(url, opts)
    if (/to=/.test(url)) return { bars: [SERVER_OLD], series_rev: 1, history_rev: 1, cache_key: 'b1:SIM:5:eth-clock' }
    const sym = decodeURIComponent(url.split('/api/bars/')[1].split('?')[0])
    return answer(`${sym}_${/[?&]tf=([^&]+)/.exec(url)[1]}`)
  }))
  const history = lake && {
    olderBars: vi.fn((key, beforeT, opts) => track(`lake:${key}<${beforeT}`, async () => {
      await new Promise((r) => setTimeout(r, 5))
      return lake(key, beforeT, opts)
    })),
  }
  const registry = createRegistry({ ctx: () => ({ nowMs: Date.now() }) })
  const net = createNetwork({ registry, request, history, isHidden: () => false, onVisible: () => () => {} })
  return { registry, net, request, history, calls, max: () => maxLive }
}
const lakeRows = (beforeT, n = 3) => Array.from({ length: n }, (_, i) => ({ t: beforeT - 300 * (n - i), o: 100, h: 101, l: 99, c: 100.4, v: 5 }))
/** What the real feed returns when the lake COVERS the join: the rows before it plus the bar AT it
 *  (historyFeed.olderBars "plus the bar AT beforeT when the lake has it"). */
const lakeMeets = (beforeT, n = 3) => [...lakeRows(beforeT, n), { t: beforeT, o: 100, h: 101, l: 99, c: 100.5, v: 5 }]
const serverWindows = (w) => w.calls.filter((c) => /to=/.test(c))
const lakeAsks = (w) => w.calls.filter((c) => c.startsWith('lake:'))
/** scroll-back with the fake clock running (the fakes answer after 5 ms timers) */
const scroll = async (w, key) => { const p = w.net.scrollBack(key); await vi.advanceTimersByTimeAsync(200); return p }

describe('BarStore scroll-back from the history lake', () => {
  it('a lake answer is prepended and the server window is never asked', async () => {
    const w = world({ lake: (key, beforeT) => ({ bars: lakeMeets(beforeT, 3), exhausted: false }) })
    const key = keyOf({ sym: 'SIM', tf: '5' })
    w.net.fetchOnce(key)                          // answered without a subscriber: no automatic depth
    await vi.advanceTimersByTimeAsync(20)
    expect(lakeAsks(w)).toEqual([])
    const res = await scroll(w, key)
    expect(res).toMatchObject({ ok: true, added: 3, source: 'lake' })
    expect(lakeAsks(w)).toEqual([`lake:${key}<${OPEN}`])
    expect(serverWindows(w)).toEqual([])
    expect(w.registry.getSnapshot(key).bars[0].t).toBe(OPEN - 900)
    expect(w.history.olderBars.mock.calls[0][2].bars).toBe(LAKE_WINDOW_BARS)   // a lake window is a piece's size
  })

  it('a lake with nothing older hands over to the server window, and is not asked again while the chart holds the key', async () => {
    const w = world({ lake: () => ({ bars: [], exhausted: true }) })
    const key = keyOf({ sym: 'SIM', tf: '5' })
    w.net.start(key)                                   // the chart: its first answer asks the lake for depth
    await vi.advanceTimersByTimeAsync(ANSWER_WINDOW_DELAY_MS + 200)   // once the chart has kept the key
    expect(lakeAsks(w).length).toBe(1)
    expect(serverWindows(w).length).toBe(1)           // ... which had nothing, so the server window was asked
    expect(w.registry.getSnapshot(key).bars[0].t).toBe(SERVER_OLD.t)
    await scroll(w, key)
    expect(lakeAsks(w).length).toBe(1)                // lakeDone: straight to the server
    expect(serverWindows(w).length).toBe(2)
  })

  it('an empty lake answer that is NOT exhausted falls back once but asks the lake again next time', async () => {
    const w = world({ lake: () => ({ bars: [], exhausted: false }) })
    const key = keyOf({ sym: 'SIM', tf: '5' })
    w.net.fetchOnce(key)
    await vi.advanceTimersByTimeAsync(20)
    await scroll(w, key)
    await scroll(w, key)
    expect(lakeAsks(w).length).toBe(2)
    expect(serverWindows(w).length).toBe(2)
  })

  it('a lake window on another basis at the join (close >2% off) is refused and the server window used', async () => {
    const w = world({ lake: (key, beforeT) => ({ bars: [{ t: beforeT - 300, o: 50, h: 51, l: 49, c: 50, v: 1 }, { t: beforeT, o: 50, h: 51, l: 49, c: 50, v: 1 }] }) })
    const key = keyOf({ sym: 'SIM', tf: '5' })
    w.net.fetchOnce(key)
    await vi.advanceTimersByTimeAsync(20)
    const res = await scroll(w, key)
    expect(res.source).toBeUndefined()
    expect(serverWindows(w).length).toBe(1)
    const bars = w.registry.getSnapshot(key).bars
    expect(bars[0].t).toBe(SERVER_OLD.t)
    expect(bars.some((b) => b.c === 50)).toBe(false)
  })

  it('control: the same window with an agreeing close at the join is taken', async () => {
    const w = world({ lake: (key, beforeT) => ({ bars: [{ t: beforeT - 300, o: 100, h: 101, l: 99, c: 100.2, v: 1 }, { t: beforeT, o: 100, h: 101, l: 99, c: 100.6, v: 1 }] }) })
    const key = keyOf({ sym: 'SIM', tf: '5' })
    w.net.fetchOnce(key)
    await vi.advanceTimersByTimeAsync(20)
    const res = await scroll(w, key)
    expect(res).toMatchObject({ ok: true, added: 1, source: 'lake' })
    expect(serverWindows(w)).toEqual([])
    // the join bar keeps the server's values; only strictly older rows come from the lake
    expect(w.registry.getSnapshot(key).bars[1]).toMatchObject({ t: OPEN, c: 100.5 })
  })

  it('a failing lake (network, 401, corrupt piece) hands over to the server window', async () => {
    const w = world({ lake: () => { throw Object.assign(new Error('HTTP 401'), { status: 401 }) } })
    const key = keyOf({ sym: 'SIM', tf: '5' })
    w.net.fetchOnce(key)
    await vi.advanceTimersByTimeAsync(20)
    const res = await scroll(w, key)
    expect(res.added).toBe(1)
    expect(serverWindows(w).length).toBe(1)
    await scroll(w, key)
    expect(lakeAsks(w).length).toBe(2)               // an error is not "nothing older": asked again
  })

  it('≤1 request per key across the lake and the server, with kicks and scrolls racing', async () => {
    const w = world({ lake: () => ({ bars: [], exhausted: false }) })
    const key = keyOf({ sym: 'SIM', tf: '5' })
    w.net.start(key)
    for (let i = 0; i < 4; i++) { w.net.scrollBack(key); w.net.kick(key); w.net.fetchOnce(key) }
    await vi.advanceTimersByTimeAsync(2000)
    expect(lakeAsks(w).length).toBeGreaterThan(1)
    expect(serverWindows(w).length).toBeGreaterThan(1)
    expect(w.max()).toBe(1)
  })

  it('⛔ a lake that ENDS BEFORE the chart is never joined across the hole: the server window answers, and once the chart reaches back into the lake the lake is used again', async () => {
    // production 2026-11-17: the lake ended Fri 19:59 ET, a 1m chart's bars started Mon ~12:30 ET;
    // joining the two left Monday morning in neither
    const LAKE_END = OPEN - 3 * 3600                 // the lake stops 3 h before the chart's first bar
    const lake = (key, beforeT) => {
      const top = Math.min(beforeT, LAKE_END)
      const rows = lakeRows(top + 300, 3).filter((b) => b.t <= LAKE_END && b.t < beforeT)
      if (beforeT <= LAKE_END) rows.push({ t: beforeT, o: 100, h: 101, l: 99, c: 100.5, v: 5 })
      return { bars: rows, exhausted: false }
    }
    const bridge = { t: LAKE_END, o: 100, h: 101, l: 99, c: 100.5, v: 1 }       // the server window reaches the lake
    const w = world({ lake, server: (url) => (/to=/.test(url) ? { bars: [bridge], series_rev: 1, history_rev: 1, cache_key: 'b1:SIM:5:eth-clock' } : answer('SIM_5')) })
    const key = keyOf({ sym: 'SIM', tf: '5' })
    w.net.fetchOnce(key)
    await vi.advanceTimersByTimeAsync(20)
    const first = await scroll(w, key)
    expect(first.source).toBeUndefined()            // NOT the lake: it does not reach the chart's first bar
    expect(serverWindows(w).length).toBe(1)
    let bars = w.registry.getSnapshot(key).bars
    expect(bars[0].t).toBe(LAKE_END)                 // the server filled the hole down to the lake
    expect(bars.some((b) => b.t < LAKE_END)).toBe(false)
    const second = await scroll(w, key)              // now the chart's first bar IS in the lake
    expect(second).toMatchObject({ ok: true, source: 'lake' })
    bars = w.registry.getSnapshot(key).bars
    expect(bars[0].t).toBeLessThan(LAKE_END)
    for (let i = 1; i < bars.length; i++) expect(bars[i].t).toBeGreaterThan(bars[i - 1].t)
  })

  describe('lake first paint (lakeSeed): history before a slow first answer, never joined across a hole', () => {
    const SLOW = 1000
    const slowServer = (url) => new Promise((r) => setTimeout(() => r(/to=/.test(url)
      ? { bars: [SERVER_OLD], series_rev: 1, history_rev: 1, cache_key: 'b1:SIM:5:eth-clock' }
      : { ...answer('SIM_5'), adj_basis: 'b1' }), SLOW))
    const rows = (from, to) => { const out = []; for (let t = from; t <= to; t += 300) out.push({ t, o: 100, h: 101, l: 99, c: 100.5, v: 10 }); return out }
    const lakeUpTo = (end) => (key, beforeT) => ({ bars: rows(OPEN - 3 * 3600, end).filter((b) => b.t < beforeT) })

    it('paints the lake before the server answers; the answer keeps rows its overlap proves', async () => {
      const w = world({ lake: lakeUpTo(OPEN + 600), server: slowServer })          // the lake reaches into the answer
      const key = keyOf({ sym: 'SIM', tf: '5' })
      w.registry.acquire(key)
      w.net.fetchOnce(key)
      const seeded = w.net.lakeSeed(key)
      await vi.advanceTimersByTimeAsync(20)
      expect(await seeded).toBe('seed')
      let s = w.registry.getSnapshot(key)
      expect(s.restSeen).toBe(false)                                   // painted, but not a server copy (never persisted)
      expect(s.bars[0].t).toBe(OPEN - 3 * 3600)
      expect(['provisional', 'context']).toContain(s.status)
      await vi.advanceTimersByTimeAsync(SLOW + 50)
      s = w.registry.getSnapshot(key)
      expect(s.restSeen).toBe(true)
      expect(s.bars[0].t).toBe(OPEN - 3 * 3600)                         // proven by the overlap: kept as deeper history
      for (let i = 1; i < s.bars.length; i++) expect(s.bars[i].t).toBeGreaterThan(s.bars[i - 1].t)
    })

    it('a lake that ENDS BEFORE the answer is painted first and then discarded whole: no hole', async () => {
      const LAKE_END = OPEN - 2 * 3600
      const w = world({ lake: lakeUpTo(LAKE_END), server: slowServer })
      const key = keyOf({ sym: 'SIM', tf: '5' })
      w.registry.acquire(key)
      w.net.fetchOnce(key)
      const seeded = w.net.lakeSeed(key)
      await vi.advanceTimersByTimeAsync(20)
      expect(await seeded).toBe('seed')
      expect(w.registry.getSnapshot(key).bars.at(-1).t).toBe(LAKE_END)
      await vi.advanceTimersByTimeAsync(SLOW + 50)
      const s = w.registry.getSnapshot(key)
      expect(s.restSeen).toBe(true)
      expect(s.bars[0].t).toBe(OPEN)                                    // only the answer: nothing across the gap
      expect(s.bars.some((b) => b.t <= LAKE_END)).toBe(false)
    })

    // ⭐ 2026-11-17: ONE LOAD, THE WHOLE DEPTH. A load that lands after the answer joins its deeper
    // rows (what the handoff waits for before it commits), only where the shared bars prove them.
    it('once the server answered, the lake JOINS its deeper rows where the overlap proves them', async () => {
      const w = world({ lake: lakeUpTo(OPEN + 600) })
      const key = keyOf({ sym: 'SIM', tf: '5' })
      w.registry.acquire(key)
      w.net.fetchOnce(key)
      await vi.advanceTimersByTimeAsync(20)                             // the fast answer is in
      const before = w.registry.getSnapshot(key)
      expect(before.restSeen).toBe(true)
      const joined = w.net.lakeSeed(key)
      await vi.advanceTimersByTimeAsync(20)
      expect(await joined).toBe('join')
      const s = w.registry.getSnapshot(key)
      expect(s.bars[0].t).toBe(OPEN - 3 * 3600)                         // the lake's deeper rows, joined
      expect(s.bars.length).toBeGreaterThan(before.bars.length)
      for (let i = 1; i < s.bars.length; i++) expect(s.bars[i].t).toBeGreaterThan(s.bars[i - 1].t)
      // and not loaded again once the key is joined: one load per key in flight, shared
      const a = w.net.lakeSeed(key), b = w.net.lakeSeed(key)
      expect(a).toBe(b)
      await vi.advanceTimersByTimeAsync(20)
    })

    it('a lake that ENDS BEFORE the answer joins nothing to it (no bar in common: a possible hole)', async () => {
      const w = world({ lake: lakeUpTo(OPEN - 2 * 3600) })
      const key = keyOf({ sym: 'SIM', tf: '5' })
      w.registry.acquire(key)
      w.net.fetchOnce(key)
      await vi.advanceTimersByTimeAsync(20)
      const before = w.registry.getSnapshot(key)
      const joined = w.net.lakeSeed(key)
      await vi.advanceTimersByTimeAsync(20)
      expect(await joined).toBe(false)
      expect(w.registry.getSnapshot(key).bars[0].t).toBe(before.bars[0].t)
    })

    it('does nothing for a daily key or with no lake', async () => {
      const w = world({ lake: lakeUpTo(OPEN + 600) })
      const key = keyOf({ sym: 'SIM', tf: '5' })
      const d = keyOf({ sym: 'SIM', tf: 'D' })
      w.registry.acquire(d)
      expect(await w.net.lakeSeed(d)).toBe(false)
      const none = world({})
      none.registry.acquire(key)
      expect(await none.net.lakeSeed(key)).toBe(false)
    })
  })

  it('a subscribed chart that KEEPS the key gets one window of depth from the lake ANSWER_WINDOW_DELAY_MS after its answer', async () => {
    const w = world({ lake: (key, beforeT) => ({ bars: lakeMeets(beforeT, 4) }) })
    const key = keyOf({ sym: 'SIM', tf: '5' })
    w.net.start(key)
    await vi.advanceTimersByTimeAsync(50)
    expect(lakeAsks(w)).toEqual([])                    // answered, but the member may be scanning past it
    await vi.advanceTimersByTimeAsync(ANSWER_WINDOW_DELAY_MS)
    expect(lakeAsks(w)).toEqual([`lake:${key}<${OPEN}`])
    expect(w.registry.getSnapshot(key).bars[0].t).toBe(OPEN - 1200)
    expect(serverWindows(w)).toEqual([])
    await vi.advanceTimersByTimeAsync(120_000)        // later polls do not ask again
    expect(lakeAsks(w).length).toBe(1)
  })

  it('a key the chart LEAVES before ANSWER_WINDOW_DELAY_MS (a scan passing it) never asks that window', async () => {
    const w = world({ lake: (key, beforeT) => ({ bars: lakeMeets(beforeT, 4) }) })
    const key = keyOf({ sym: 'SIM', tf: '5' })
    const stop = w.net.start(key)
    await vi.advanceTimersByTimeAsync(50)              // answered
    const before = w.registry.getSnapshot(key).bars
    stop()                                            // the member pressed the next key
    await vi.advanceTimersByTimeAsync(ANSWER_WINDOW_DELAY_MS + 200)
    expect(lakeAsks(w)).toEqual([])
    expect(serverWindows(w)).toEqual([])
    expect(w.registry.getSnapshot(key).bars).toBe(before)
  })

  it('no lake (switch off), a daily key, or a dated window: never asked, the server window as before', async () => {
    const plain = world({})
    const k5 = keyOf({ sym: 'SIM', tf: '5' })
    plain.net.start(k5)
    await vi.advanceTimersByTimeAsync(50)
    expect(serverWindows(plain)).toEqual([])          // no automatic depth without the lake
    await scroll(plain, k5)
    expect(serverWindows(plain).length).toBe(1)

    const w = world({ lake: (key, beforeT) => ({ bars: lakeRows(beforeT) }) })
    const daily = keyOf({ sym: 'SIM', tf: 'D' })
    w.net.start(daily)
    await vi.advanceTimersByTimeAsync(50)
    await scroll(w, daily)
    const dated = `${k5}@to=${OPEN}`
    w.net.fetchOnce(dated)
    await vi.advanceTimersByTimeAsync(50)
    await scroll(w, dated)
    expect(lakeAsks(w)).toEqual([])
  })

  it('stopping the key aborts a lake request in flight and nothing lands', async () => {
    let seen = null
    const w = world({ lake: (key, beforeT, opts) => { seen = opts.signal; return new Promise(() => {}) } })
    const key = keyOf({ sym: 'SIM', tf: '5' })
    const stop = w.net.start(key)
    await vi.advanceTimersByTimeAsync(ANSWER_WINDOW_DELAY_MS + 50)   // answered, kept -> the depth request is in flight
    expect(lakeAsks(w).length).toBe(1)
    const before = w.registry.getSnapshot(key).bars
    stop()
    expect(seen?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(w.registry.getSnapshot(key).bars).toBe(before)
    expect(serverWindows(w)).toEqual([])
  })
})
