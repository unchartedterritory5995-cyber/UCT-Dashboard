// ⭐ THE PAGE'S MINUTE FEED: WHAT IT MAY ASK FOR, AND WHEN IT MUST NOT (2026-11-23, minuteFeed.createPageMinuteFeed).
// The real consumer (tail-only), the real applier, a real registry, real frame bytes; the edge and the clock are faked.
//
//   P1 on, visible, in session: ONE minute file a minute, at low priority; never head.json, never today.bin
//   P2 end to end: the frame it reads lands on a held, answered 1m key
//   P3 hidden: no request at all; visible again: ONE request, for the minute now due (no backlog)
//   P4 outside the regular session: no request; the first file asked is 09:30's, the last 15:59's
//   P5 the server's kill on a page left open (the cookie, read fresh before each poll): it stops for good
//   P6 a member the edge REFUSES (401): quiet, and a handful of requests an hour, not one a minute
//   P7 a feed that is not there (404 every minute): bounded the same way
//   P8 one frame clears the backoff
//   P9 a gate that throws asks nothing (it is also the kill: it fails closed)
//   WITH THE DEVICE STORE ON (`cacheOnly`: the worker downloads each minute file and TELLS the pages; the page reads
//   the browser's copy, once):
//   C1 told of a minute: ONE read of that file, `cache: 'only-if-cached'` + `mode: 'same-origin'`; never untold, never a timer
//   C2 a miss is looked for ONCE more half a second later, the same way (a 504 answer, or C2b a failed fetch)
//   C3 two misses: the minute is given up, never downloaded, and the feed pauses; told again later, it reads again
//   C4 told while a poll may not go (hidden, outside the session, nothing to feed, killed): no read
//   C5 anything else on the channel is ignored; no BroadcastChannel: nothing is read
//   (P3 / P4 also pin WHEN it looks again after a "not now": when the next minute file is due, never a minute late)
//   P2h end to end: fifteen minute files later the 15m bucket lands on a held, answered 15m key (C6: cache-only)
//   ONLY WHILE THERE IS SOMETHING TO FEED (an idle regular 1m / 5m / 15m / 30m / 60m key is held):
//   G1 no 1m key held: no request at all                     G2 only a 1m key a chart is on: none
//   G3 only D, extended-60m and windowed keys: none          G4 only a windowed (replay) 1m key: none
//   G3b an idle regular 15m key alone: it polls
//   G5 the first idle 1m key held starts it within seconds, at the minute then due (no backlog)
//   G6 the last one gone (a chart is now on it, or it was evicted) stops it within one minute; held again, it resumes
import { describe, it, expect, afterEach } from 'vitest'
import { createRegistry } from './registry'
import {
  createPageMinuteFeed, FAIL_PAUSE_MS, REFUSED_PAUSE_MS, WANT_RECHECK_MS, CACHE_RETRY_MS, CACHE_RETRIES,
} from './minuteFeed'
import { ACTION, keyOf } from './types'
import { DEFAULT_BASE } from '../../lib/minuteFrames/consumer'
import { writeFrame, framePath, frameResponse, statusResponse } from '../../lib/minuteFrames/testing/frameWriter'

const OPEN_MIN = Date.UTC(2026, 10, 10, 14, 30) / 60000          // Tue 2026-11-10 09:30 ET, as a unix minute
const M = (n) => OPEN_MIN + n
const T = (n) => M(n) * 60
const at = (n, sec = 0) => M(n) * 60_000 + sec * 1000
const name = (n) => framePath(M(n))
const bar = (n) => ({ t: T(n), o: 10 + n, h: 11 + n, l: 9 + n, c: 10.5 + n, v: 100 + n })
const rec = (sym, n) => { const { t: _t, ...b } = bar(n); return { sym, ...b } }
/** The 15m bucket of minutes a..b, and the server's answer for a 15m key whose rows end with the 09:45 bucket. */
const agg = (a, b) => {
  let v = 0
  for (let n = a; n <= b; n++) v += 100 + n
  return { t: T(a), o: 10 + a, h: 11 + b, l: 9 + a, c: 10.5 + b, v }
}
const answer15 = (sym) => ({ type: ACTION.REST_FULL, payload: {
  ticker: sym, tf: '15', contract: 1, grid: 'eth-clock', cache_key: `b1:${sym}:15:eth-clock`, series_rev: at(30, 5), history_rev: 1,
  verified_through: at(30, 5) / 1000, complete_through: T(15), tail_status: 'verified', developing: null,
  bars: [agg(0, 14), agg(15, 29)],
} })

afterEach(() => { document.cookie = 'uct_chart_speed=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' })

/** An edge that publishes every minute's frame (AAA and BBB traded in each), or answers `status` for everything. */
function edge({ status = null } = {}) {
  const asked = []
  const st = { status }
  const fetchImpl = async (url, init) => {
    const path = String(url).slice(DEFAULT_BASE.length + 1)
    asked.push({ path, init: { ...(init || {}) } })
    if (st.status) return statusResponse(st.status)
    const m = /^(\d{4}-\d{2}-\d{2})\/(\d{2})(\d{2})\.bin$/.exec(path)
    if (!m || m[1] !== '2026-11-10') return statusResponse(404)
    const n = Number(m[2]) * 60 + Number(m[3]) - 570
    return frameResponse(writeFrame({ minute: M(n), blocks: [{ rows: [rec('AAA', n), rec('BBB', n)] }] }))
  }
  return { fetchImpl, asked, st, paths: () => asked.map((a) => a.path) }
}

/** `hold` (default true): the page holds one idle regular 1m key (a warmed row), so there is something to feed. */
function page(e, nowMs, { hold = true, maxKeys, ...extra } = {}) {
  const clock = { ms: nowMs }
  const env = { visible: true, wake: null }
  const active = new Set()
  let pending = null
  const registry = createRegistry({ ctx: () => ({ nowMs: clock.ms }), ...(maxKeys != null ? { maxKeys } : {}) })
  if (hold) registry.acquire(keyOf({ sym: 'HOLD', tf: '1' }))
  /** The channel the device store's worker tells the pages on: `env.tell(n)` is the worker's message for minute n. */
  const channel = { onmessage: null, closed: false, postMessage() {}, close() { this.closed = true } }
  env.channel = channel
  env.tell = (n, over = {}) => channel.onmessage?.({ data: {
    type: 'minute-applied', day: '2026-11-10', seq: 330 + n, minute: M(n),
    hhmm: `${String(Math.floor((570 + n) / 60)).padStart(2, '0')}${String((570 + n) % 60).padStart(2, '0')}`, ...over,
  } })
  const feed = createPageMinuteFeed({
    store: { registry, isActive: (k) => active.has(k) },
    fetchImpl: e.fetchImpl, now: () => clock.ms, visible: () => env.visible,
    onVisible: (cb) => { env.wake = cb; return () => { env.wake = null } },
    makeChannel: () => channel,
    setTimer: (fn, ms) => { pending = { fn, ms }; return pending }, clearTimer: (t) => { if (pending === t) pending = null },
    consumerOpts: {
      random: () => 0,
      setTimer: (fn, ms) => { pending = { fn, ms }; return pending }, clearTimer: (t) => { if (pending === t) pending = null },
    },
    feederOpts: { sliceMs: Infinity },
    ...extra,
  })
  return {
    clock, env, registry, feed, active,
    delay: () => pending?.ms ?? null,
    /** Fire the pending timer (the clock moves by its delay first). */
    async run() { const t = pending; pending = null; clock.ms += t.ms; await t.fn() },
    /** Fire timers until the clock reaches `ms`. */
    async runUntil(ms) { while (pending && clock.ms + pending.ms <= ms) await this.run() },
  }
}

describe('the page minute feed', () => {
  it('P1 on, visible, in session: ONE minute file a minute, at low priority; never head.json, never today.bin', async () => {
    const e = edge()
    const p = page(e, at(32, 20))                                // 10:02:20
    p.feed.start()
    await p.run()
    expect(e.paths()).toEqual([name(31)])                        // the minute now due, and only it
    await p.runUntil(at(40, 20))
    expect(e.paths()).toEqual([31, 32, 33, 34, 35, 36, 37, 38, 39].map(name))   // 8 minutes later: 8 more
    for (const a of e.asked) expect(a.init).toMatchObject({ priority: 'low', credentials: 'same-origin' })
    for (const a of e.asked) expect([a.init.cache, a.init.mode]).toEqual([undefined, undefined])   // the page downloads: the default cache mode
    expect(p.feed.status().cacheOnly).toBe(false)
    expect(p.feed.status()).toMatchObject({ running: true, requests: 9, answered: 9, refused: 0, pauses: 0, frames: 9, breaks: 0 })
  })

  it('P2 end to end: the frame it reads lands on a held, answered 1m key', async () => {
    const e = edge()
    const p = page(e, at(31, 8))                                 // 10:01:08: the 10:00 frame is due
    const key = keyOf({ sym: 'AAA', tf: '1' })
    p.registry.dispatch(key, { type: ACTION.REST_FULL, payload: {
      ticker: 'AAA', tf: '1', contract: 1, grid: 'eth-clock', cache_key: 'b1:AAA:1:eth-clock', series_rev: at(30, 20), history_rev: 1,
      verified_through: at(30, 20) / 1000, complete_through: T(29), tail_status: 'verified', developing: null,
      bars: Array.from({ length: 30 }, (_, n) => bar(n)),
    } })
    p.feed.start()
    await p.run()
    await p.feed.feeder.settled()
    const s = p.registry.peek(key)
    expect(s.bars[s.bars.length - 1]).toMatchObject({ ...bar(30), src: 'final' })
    expect(p.registry.has(keyOf({ sym: 'BBB', tf: '1' }))).toBe(false)   // a symbol nobody holds costs nothing
  })

  it('P2h end to end: fifteen minute files later, the 15m bucket that just closed lands on a held, answered 15m key', async () => {
    const e = edge()
    const p = page(e, at(30, 8), { hold: false })                // 10:00:08
    const key = keyOf({ sym: 'AAA', tf: '15' })
    p.registry.dispatch(key, answer15('AAA'))
    p.feed.start()
    await p.runUntil(at(44, 30))                                 // 10:14:30: the 10:13 file was the last
    await p.feed.feeder.settled()
    expect(p.registry.peek(key).bars).toHaveLength(2)            // 10:00-10:15 is forming: nothing yet
    expect(p.registry.peek(key).developing).toBe(null)
    await p.runUntil(at(45, 30))                                 // 10:15:30
    await p.feed.feeder.settled()
    const s = p.registry.peek(key)
    expect(s.bars[s.bars.length - 1]).toMatchObject({ ...agg(30, 44), src: 'final', fin: true })
    expect(s.developing).toBe(null)
    expect(e.paths()).toEqual(Array.from({ length: 16 }, (_, i) => name(29 + i)))   // one file a minute, nothing else
  })

  it('P3 hidden: no request at all; visible again: ONE request, for the minute now due', async () => {
    const e = edge()
    const p = page(e, at(32, 20))
    p.env.visible = false
    p.feed.start()
    await p.run()
    expect(p.delay()).toBe(47_000)                               // it looks again when the next file is due (10:03:07), and asks nothing
    await p.runUntil(at(40, 0))
    expect(e.asked).toHaveLength(0)
    p.clock.ms = at(40, 30)
    p.env.visible = true
    p.env.wake()                                                 // visibilitychange
    expect(p.delay()).toBe(0)
    await p.run()
    expect(e.paths()).toEqual([name(39)])
    // ...and hidden again, mid-run: the polls stop
    await p.run()
    expect(e.paths()).toEqual([name(39), name(40)])
    p.env.visible = false
    await p.runUntil(at(50, 0))
    expect(e.asked).toHaveLength(2)
  })

  it('P4 outside the regular session: no request; the first file asked is 09:30, the last 15:59', async () => {
    const e = edge()
    const p = page(e, at(-10, 0))                                // 09:20:00
    p.feed.start()
    await p.runUntil(at(1, 6))                                   // ...to 09:31:06
    expect(e.asked).toHaveLength(0)
    await p.runUntil(at(1, 7))                                   // 09:31:07: the session's first file is due NOW
    expect(e.paths()).toEqual([name(0)])                         // ...and asked now, not up to a minute late
    await p.runUntil(at(3, 0))
    expect(e.paths()[0]).toBe(name(0))                           // 0930.bin
    expect(e.paths().every((x) => x >= name(0))).toBe(true)

    const e2 = edge()
    const p2 = page(e2, at(389, 20))                             // 15:59:20
    p2.feed.start()
    await p2.runUntil(at(420, 0))                                // ...to 16:30
    expect(e2.paths()).toEqual([name(388), name(389)])           // 15:58, then 15:59 at 16:00:07: nothing after
  })

  it('P5 the server kill on a page left open: read fresh before each poll, it stops for good', async () => {
    const e = edge()
    const p = page(e, at(32, 20))                                // (the default `killed`: the real cookie)
    p.feed.start()
    await p.run()
    await p.run()
    expect(e.asked).toHaveLength(2)
    document.cookie = 'uct_chart_speed=0; path=/'                // /api/live-prices wrote the kill
    await p.run()
    expect(e.asked).toHaveLength(2)
    expect(p.delay()).toBe(null)                                 // no timer is left
    expect(p.env.wake).toBe(null)                                // no listener either
    expect(p.feed.status()).toMatchObject({ running: false, stopped: 'killed' })
    p.feed.start()                                               // it cannot be started again on this page
    expect(p.delay()).toBe(null)
  })

  it('P6 a member the edge refuses (401): quiet, and a handful of requests an hour', async () => {
    const e = edge({ status: 401 })
    const p = page(e, at(32, 20))
    p.feed.start()
    await p.run()
    expect(e.asked).toHaveLength(1)
    expect(p.feed.status().pausedUntil).toBe(at(32, 20) + REFUSED_PAUSE_MS)
    await p.runUntil(at(92, 20))                                 // one hour
    expect(e.asked.length).toBeGreaterThanOrEqual(2)
    expect(e.asked.length).toBeLessThanOrEqual(4)
    expect(p.feed.status()).toMatchObject({ running: true, refused: e.asked.length })
  })

  it('P7 a feed that is not there (404 every minute): one minute of asking, then a pause that doubles', async () => {
    const e = edge({ status: 404 })
    const p = page(e, at(32, 20))
    p.feed.start()
    await p.run(); await p.run(); await p.run(); await p.run()
    expect(e.asked).toHaveLength(4)                              // the ask and its three retries
    expect(p.feed.status().pausedUntil).toBe(p.clock.ms + FAIL_PAUSE_MS)
    await p.runUntil(at(92, 20))                                 // one hour
    expect(e.asked.length).toBeGreaterThanOrEqual(8)
    expect(e.asked.length).toBeLessThanOrEqual(24)               // (unbounded: 240)
    expect(e.paths().some((x) => x.endsWith('head.json') || x.endsWith('today.bin'))).toBe(false)
  })

  it('P8 one frame clears the backoff', async () => {
    const e = edge({ status: 404 })
    const p = page(e, at(32, 20))
    p.feed.start()
    await p.run(); await p.run(); await p.run(); await p.run()
    expect(p.feed.status().pauses).toBe(1)
    e.st.status = null                                           // the feed is back
    await p.runUntil(at(36, 20))
    expect(p.feed.status()).toMatchObject({ pauses: 0, pausedUntil: 0 })
    const n = e.asked.length
    await p.runUntil(at(40, 20))
    expect(e.asked.length).toBe(n + 4)                           // one a minute again
  })
})

describe('the page minute feed with the device store ON reads the browser cache only', () => {
  /** The browser's HTTP cache as the page sees it: minute n is there once the device store's worker downloaded it
   *  (`have`). A request that is NOT cache-only would be a second download: counted in `net`. A miss answers 504, or
   *  with `reject` fails as Chrome's does. */
  function cache({ have = [], reject = false } = {}) {
    const st = { have: new Set(have), reject, net: 0 }
    const asked = []
    const fetchImpl = async (url, init) => {
      const path = String(url).slice(DEFAULT_BASE.length + 1)
      asked.push({ path, init: { ...(init || {}) } })
      const m = /\/(\d{2})(\d{2})\.bin$/.exec(path)
      const n = m ? Number(m[1]) * 60 + Number(m[2]) - 570 : NaN
      const frame = () => frameResponse(writeFrame({ minute: M(n), blocks: [{ rows: [rec('AAA', n), rec('BBB', n)] }] }))
      if (init?.cache !== 'only-if-cached') { st.net++; return frame() }
      if (st.have.has(n)) return frame()
      if (st.reject) throw new TypeError('Failed to fetch')
      return statusResponse(504)
    }
    return { fetchImpl, asked, st, paths: () => asked.map((a) => a.path) }
  }
  const onlyCache = (e) => e.asked.every((a) => a.init.cache === 'only-if-cached' && a.init.mode === 'same-origin')
  /** The worker tells of minute n at `sec` seconds past the minute after it; resolves when the page's read settled. */
  async function told(p, n, sec = 8.2) {
    p.clock.ms = at(n + 1, sec)
    p.env.tell(n)
    await p.feed.settledRead()
  }

  it('C1 told of a minute: ONE cache-only read of that file; never untold, never a timer', async () => {
    const e = cache({ have: [31, 32, 33] })
    const p = page(e, at(32, 1), { cacheOnly: true })
    p.feed.start()
    expect(p.delay()).toBe(null)                                 // no schedule of its own
    expect(e.asked).toEqual([])                                  // and nothing read before it is told
    await told(p, 31)
    expect(e.paths()).toEqual([name(31)])
    for (const a of e.asked) expect(a.init).toMatchObject({ cache: 'only-if-cached', mode: 'same-origin', priority: 'low', credentials: 'same-origin' })
    await told(p, 32)
    p.env.tell(32)                                               // told twice (it is already held): nothing is read
    await p.feed.settledRead()
    await told(p, 33)
    expect(e.paths()).toEqual([31, 32, 33].map(name))
    expect(p.delay()).toBe(null)
    expect(e.st.net).toBe(0)
    expect(p.feed.status()).toMatchObject({ running: true, cacheOnly: true, listening: true, told: 4, requests: 3, answered: 3, pauses: 0, frames: 3, breaks: 0 })
  })

  it('C1b end to end: the minute it was told of lands on a held, answered 1m key', async () => {
    const e = cache({ have: [30] })
    const p = page(e, at(31, 1), { cacheOnly: true })
    const key = keyOf({ sym: 'AAA', tf: '1' })
    p.registry.dispatch(key, { type: ACTION.REST_FULL, payload: {
      ticker: 'AAA', tf: '1', contract: 1, grid: 'eth-clock', cache_key: 'b1:AAA:1:eth-clock', series_rev: at(30, 20), history_rev: 1,
      verified_through: at(30, 20) / 1000, complete_through: T(29), tail_status: 'verified', developing: null,
      bars: Array.from({ length: 30 }, (_, n) => bar(n)),
    } })
    p.feed.start()
    await told(p, 30)
    await p.feed.feeder.settled()
    const s = p.registry.peek(key)
    expect(s.bars[s.bars.length - 1]).toMatchObject({ ...bar(30), src: 'final' })
  })

  it('C6 end to end: told of fifteen minutes, the 15m bucket lands on a held 15m key, with not one request that can reach the network', async () => {
    const e = cache({ have: Array.from({ length: 15 }, (_, i) => 30 + i) })
    const p = page(e, at(31, 1), { cacheOnly: true, hold: false })
    const key = keyOf({ sym: 'AAA', tf: '15' })
    p.registry.dispatch(key, answer15('AAA'))
    p.feed.start()
    for (let n = 30; n <= 44; n++) await told(p, n)
    await p.feed.feeder.settled()
    const s = p.registry.peek(key)
    expect(s.bars[s.bars.length - 1]).toMatchObject({ ...agg(30, 44), src: 'final', fin: true })
    expect(e.paths()).toEqual(Array.from({ length: 15 }, (_, i) => name(30 + i)))
    expect(onlyCache(e)).toBe(true)
    expect(e.st.net).toBe(0)
    expect(p.delay()).toBe(null)
  })

  for (const reject of [false, true]) {
    it(`C2${reject ? 'b' : ''} a miss (${reject ? 'a failed fetch' : 'a 504 answer'}) is looked for ONCE more half a second later, the same way`, async () => {
      const e = cache({ have: [31], reject })
      const p = page(e, at(32, 1), { cacheOnly: true })
      p.feed.start()
      await told(p, 31)
      await told(p, 32)                                          // told, yet not in the cache (it was cleared)
      expect(p.delay()).toBe(CACHE_RETRY_MS)
      e.st.have.add(32)
      await p.run()
      await p.feed.settledRead()
      expect(e.paths()).toEqual([31, 32, 32].map(name))
      expect(p.delay()).toBe(null)
      expect(onlyCache(e)).toBe(true)                            // a miss never turns into a download
      expect(e.st.net).toBe(0)
      expect(p.feed.status()).toMatchObject({ answered: 2, pauses: 0, frames: 2, breaks: 0 })
    })
  }

  it('C3 two misses: the minute is given up, never downloaded, the feed pauses; told again after the pause, it reads', async () => {
    expect(CACHE_RETRIES).toBe(1)
    const e = cache({ have: [31, 36] })
    const p = page(e, at(32, 1), { cacheOnly: true })
    p.feed.start()
    await told(p, 31)
    await told(p, 32)
    await p.run()                                                // the one retry
    await p.feed.settledRead()
    expect(e.asked.filter((a) => a.path === name(32))).toHaveLength(2)
    expect(p.delay()).toBe(null)                                 // given up: no third look
    expect(p.feed.status().pausedUntil).toBe(p.clock.ms + FAIL_PAUSE_MS)
    await told(p, 33)                                            // paused: told, and nothing is read
    expect(e.asked).toHaveLength(3)
    await told(p, 36)                                            // 10:07:08: the pause is over
    expect(e.paths()).toEqual([31, 32, 32, 36].map(name))
    expect(onlyCache(e)).toBe(true)
    expect(e.st.net).toBe(0)
    expect(p.feed.status()).toMatchObject({ pauses: 0, pausedUntil: 0, breaks: 1 })
  })

  it('C4 told while a poll may not go: hidden, outside the session, nothing to feed, killed: no read', async () => {
    const e = cache({ have: [-1, 31, 32, 33, 34] })
    const p = page(e, at(32, 1), { cacheOnly: true })
    p.feed.start()
    p.env.visible = false
    await told(p, 31)
    expect(e.asked).toEqual([])                                  // hidden
    p.env.visible = true
    p.clock.ms = at(0, 8); p.env.tell(-1); await p.feed.settledRead()
    expect(e.asked).toEqual([])                                  // 09:29 is not a regular-session minute
    const q = page(cache({ have: [31] }), at(32, 1), { cacheOnly: true, hold: false })
    q.feed.start()
    await told(q, 31)
    expect(q.feed.status()).toMatchObject({ requests: 0, waiting: true, told: 1 })   // nothing to feed
    await told(p, 32)
    expect(e.paths()).toEqual([name(32)])                        // (the control: it does read when it may)
    document.cookie = 'uct_chart_speed=0; path=/'
    await told(p, 33)
    expect(e.paths()).toEqual([name(32)])                        // killed...
    expect(p.feed.status()).toMatchObject({ running: false, stopped: 'killed', listening: false })
    expect(p.env.channel.closed).toBe(true)                      // ...and it stopped listening for good
    expect(p.env.channel.onmessage).toBe(null)
  })

  it('C5 anything else on the channel is ignored; with no BroadcastChannel nothing is read', async () => {
    const e = cache({ have: [31, 32] })
    const p = page(e, at(32, 1), { cacheOnly: true })
    p.feed.start()
    p.clock.ms = at(32, 8)
    for (const bad of [{ type: 'event' }, { day: 20261110 }, { seq: 361.5 }, { hhmm: '0959' }, { day: 'today' }, { minute: 'x' }]) p.env.tell(31, bad)
    p.env.channel.onmessage?.({ data: null })
    p.env.channel.onmessage?.({})
    await p.feed.settledRead()
    expect(e.asked).toEqual([])
    expect(p.feed.status().told).toBe(0)
    const q = page(cache({ have: [31] }), at(32, 1), { cacheOnly: true, makeChannel: () => null })
    q.feed.start()
    expect(q.delay()).toBe(null)
    expect(q.feed.status()).toMatchObject({ running: true, listening: false, requests: 0 })
    const r = page(cache({ have: [31] }), at(32, 1), { cacheOnly: true, makeChannel: () => { throw new Error('no channel') } })
    r.feed.start()
    expect(r.feed.status()).toMatchObject({ listening: false, requests: 0 })
  })
})

describe('the page minute feed gate fails closed', () => {
  it('P9 a gate that throws asks nothing, and the feed looks again later', async () => {
    const e = edge()
    const p = page(e, at(32, 20), { killed: () => { throw new Error('cookie jar') } })
    p.feed.start()
    await p.run()
    await p.runUntil(at(36, 20))
    expect(e.asked).toEqual([])
    expect(p.delay()).not.toBe(null)                             // still looking: a gate that recovers resumes
  })
})

describe('the page minute feed polls only while an idle regular 1m / 5m / 15m / 30m / 60m key is held', () => {
  const k1 = (sym) => keyOf({ sym, tf: '1' })

  it('G1 no 1m key held: no request at all (it looks again every few seconds, and asks nothing)', async () => {
    const e = edge()
    const p = page(e, at(32, 20), { hold: false })
    p.feed.start()
    await p.run()
    expect(p.delay()).toBe(WANT_RECHECK_MS)
    await p.runUntil(at(40, 20))                                 // eight minutes
    expect(e.asked).toEqual([])
    expect(p.feed.status()).toMatchObject({ running: true, waiting: true, requests: 0 })
  })

  it('G2 only a 1m key a chart is on (its own stream keeps it current): none', async () => {
    const e = edge()
    const p = page(e, at(32, 20), { hold: false })
    p.registry.acquire(k1('AAA'))
    p.active.add(k1('AAA'))
    p.feed.start()
    await p.runUntil(at(36, 20))
    expect(e.asked).toEqual([])
  })

  it('G3 only a D key, the extended 60m key and a windowed (replay) 15m key held: none', async () => {
    const e = edge()
    const p = page(e, at(32, 20), { hold: false })
    p.registry.acquire(keyOf({ sym: 'AAA', tf: 'D' }))
    p.registry.acquire(keyOf({ sym: 'AAA', tf: '60', session: 'eth' }))
    p.registry.acquire(keyOf({ sym: 'AAA', tf: '15', window: { to: T(10) } }))
    p.feed.start()
    await p.runUntil(at(36, 20))
    expect(e.asked).toEqual([])
  })

  it('G3b an idle regular 15m key alone (no 1m chart anywhere): it polls, one file a minute', async () => {
    const e = edge()
    const p = page(e, at(32, 20), { hold: false })
    p.registry.acquire(keyOf({ sym: 'AAA', tf: '15' }))
    p.feed.start()
    await p.run(); await p.run()
    expect(e.paths()).toEqual([name(31), name(32)])
    expect(p.feed.status().waiting).toBe(false)
  })

  it('G4 only a windowed (replay) 1m key: none', async () => {
    const e = edge()
    const p = page(e, at(32, 20), { hold: false })
    p.registry.acquire(keyOf({ sym: 'AAA', tf: '1', window: { to: T(10) } }))
    p.feed.start()
    await p.runUntil(at(36, 20))
    expect(e.asked).toEqual([])
  })

  it('G5 the first idle 1m key held starts it within seconds, at the minute then due (no backlog)', async () => {
    const e = edge()
    const p = page(e, at(32, 20), { hold: false })
    p.feed.start()
    await p.runUntil(at(35, 10))                                 // 10:05:10: nothing asked so far
    expect(e.asked).toEqual([])
    p.registry.acquire(k1('AAA'))                                // a list warms a row
    await p.run()
    expect(p.clock.ms).toBeLessThanOrEqual(at(35, 10) + WANT_RECHECK_MS)
    expect(e.paths()).toEqual([name(34)])                        // the minute due at 10:05:1x, and only it
    expect(p.feed.status().waiting).toBe(false)
    await p.run()
    expect(e.paths()).toEqual([name(34), name(35)])              // then one a minute
    expect(p.clock.ms).toBe(at(36, 7))
  })

  it('G6 the last one gone stops it within one minute; held again, it resumes at the minute then due', async () => {
    const e = edge()
    const p = page(e, at(32, 20), { hold: false, maxKeys: 0 })   // (maxKeys 0: a released key is evicted at once)
    p.registry.acquire(k1('AAA'))
    p.registry.acquire(k1('BBB'))
    p.feed.start()
    await p.run(); await p.run()
    expect(e.paths()).toEqual([name(31), name(32)])
    p.active.add(k1('AAA'))                                      // a chart is now on one...
    p.registry.release(k1('BBB'))                                // ...and the other left the registry
    expect(p.registry.has(k1('BBB'))).toBe(false)
    const due = p.clock.ms + p.delay()
    expect(p.delay()).toBeLessThanOrEqual(60_000)                // its next look is at most a minute away
    await p.run()
    expect(p.clock.ms).toBe(due)
    expect(e.asked).toHaveLength(2)                              // ...and it asks nothing
    await p.runUntil(at(38, 0))
    expect(e.asked).toHaveLength(2)
    p.active.delete(k1('AAA'))                                   // the chart leaves: an idle 1m key again
    await p.run()
    expect(e.paths()).toEqual([name(31), name(32), name(36)])    // the minute then due; 10:03 to 10:05 are not fetched
  })
})
