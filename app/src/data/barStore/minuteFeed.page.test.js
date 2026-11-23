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
//   ONLY WHILE THERE IS SOMETHING TO FEED (an idle regular 1m key is held):
//   G1 no 1m key held: no request at all                     G2 only a 1m key a chart is on: none
//   G3 only 5m / 15m / D keys: none                          G4 only a windowed (replay) 1m key: none
//   G5 the first idle 1m key held starts it within seconds, at the minute then due (no backlog)
//   G6 the last one gone (a chart is now on it, or it was evicted) stops it within one minute; held again, it resumes
import { describe, it, expect, afterEach } from 'vitest'
import { createRegistry } from './registry'
import { createPageMinuteFeed, FAIL_PAUSE_MS, REFUSED_PAUSE_MS, WANT_RECHECK_MS } from './minuteFeed'
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
  const feed = createPageMinuteFeed({
    store: { registry, isActive: (k) => active.has(k) },
    fetchImpl: e.fetchImpl, now: () => clock.ms, visible: () => env.visible,
    onVisible: (cb) => { env.wake = cb; return () => { env.wake = null } },
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

  it('P3 hidden: no request at all; visible again: ONE request, for the minute now due', async () => {
    const e = edge()
    const p = page(e, at(32, 20))
    p.env.visible = false
    p.feed.start()
    await p.run()
    expect(p.delay()).toBe(60_000)                               // it looks again in a minute, and asks nothing
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

describe('the page minute feed polls only while an idle regular 1m key is held', () => {
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

  it('G3 only 5m, 15m and D keys held (no 1m chart anywhere): none', async () => {
    const e = edge()
    const p = page(e, at(32, 20), { hold: false })
    for (const tf of ['5', '15', '60', 'D']) p.registry.acquire(keyOf({ sym: 'AAA', tf }))
    p.feed.start()
    await p.runUntil(at(36, 20))
    expect(e.asked).toEqual([])
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
