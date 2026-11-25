// ⭐ THE SCAN ON A 5-MINUTE CHART: A MEMBER COMES BACK TO THE SAME 20 ROWS EVERY FIVE MINUTES (2026-11-24, minuteFeed.js).
//
// The page opens at 09:58:00 and its list warms 20 rows. The member walks them three times, a row every 2.5 s, from
// 10:01:20, 10:06:20 and 10:11:20 (each walk is in a NEW 5m bucket), and goes back to another chart after each walk.
// The REAL bar store, the REAL switch rule (`prefetch.peekDisplayable`, so the real `_behindClock`), the REAL
// reducer, switch, chunk, consumer, rollup and applier, on a fake clock. Only the network is a model (as in
// minuteFeed.scan.test.js): /api/bars answers 80 ms after it is asked with the server's 5m rows as of then (model
// 'closed': no forming bar, what the server sends for a symbol no stream is on; model 'forming': one in every
// answer); the edge has minute M's frame 5 s after M ends.
//
// WHAT THIS SLICE DOES AND DOES NOT DO, IN NUMBERS (printed):
//   walk 1  feed ON = feed OFF = nothing switches in the key press. The warmed copies stop at the bucket the page was
//           opened in, and the feed cannot complete THAT bucket (its first minutes were published before the row was
//           held): the press asks, as today.
//   walk 2, walk 3   feed ON: every press switches in the key press (the bucket that closed since the row's answer was
//           built from minutes all fed while the row was held). Feed OFF: none (each copy is one bucket behind).
// Asserted at every press, both models, both arms: the newest closed rows of the pressed copy are the TRUE buckets
// with none missing; a copy is never worse with the feed on; and with model 'closed' a fed copy has NO forming bar.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { parseBarsUrl } from './testing/fakeBarsServer'
import { newestBarIsFormingOf } from './adapter'
import { rng } from './__fixtures__/seededSeries'
import { writeFrame, framePath, frameResponse, statusResponse } from '../../lib/minuteFrames/testing/frameWriter'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const OPEN = Date.UTC(2026, 10, 10, 14, 30) / 1000               // Tue 2026-11-10 09:30 ET (unix s)
const clockAt = (h, m, s = 0) => (OPEN + ((h * 60 + m) - 570) * 60 + s) * 1000
const PAGE_OPEN_MS = clockAt(9, 58)
const WALKS = [clockAt(10, 1, 20), clockAt(10, 6, 20), clockAt(10, 11, 20)]
const ROWS = 20
const STEP_MS = 2500
const LATENCY_MS = 80
const SEAL_LAG_S = 2
const GRACE_S = 5
const TF = '5'
const SYMS = Array.from({ length: ROWS }, (_, i) => `S${String(i).padStart(3, '0')}`)
const r2 = (x) => Math.round(x * 100) / 100

/** THE TRUTH: symbol i's closed minute starting at unix s `t` (every symbol trades every minute)... */
function truth1(i, t) {
  const m = (t - OPEN) / 60
  const o = r2(20 + i + (m % 7) * 0.01)
  return { t, o, h: r2(o + 0.05), l: r2(o - 0.05), c: r2(o + 0.02), v: 1000 + m }
}
/** ...and its closed 5m bucket starting at `t`: what the server builds from those minutes. */
function truth5(i, t) {
  const ms = [0, 1, 2, 3, 4].map((k) => truth1(i, t + k * 60))
  return { t, o: ms[0].o, h: Math.max(...ms.map((b) => b.h)), l: Math.min(...ms.map((b) => b.l)), c: ms[4].c, v: ms.reduce((a, b) => a + b.v, 0) }
}
/** What the server holds of a bucket still forming: a narrower range, less volume. */
function partial5(i, t) {
  const o = truth1(i, t).o
  return { t, o, h: r2(o + 0.01), l: r2(o - 0.01), c: o, v: 7 }
}

let fakeDb
const undo = []
beforeAll(() => { fakeDb = installFakeIndexedDB() })
afterEach(() => {
  for (const f of undo.splice(0)) { try { f() } catch { /* already gone */ } }
  vi.useRealTimers(); vi.restoreAllMocks(); localStorage.removeItem('uct.minuteFeed'); localStorage.removeItem('barspack.version')
  localStorage.removeItem('uct.deviceStore')
})

function installNetwork(model) {
  const log = { bars: [], frames: [], served: new Map() }
  globalThis.fetch = vi.fn((url, opts) => {
    const u = String(url)
    const now = Date.now()
    const nowS = Math.floor(now / 1000)
    if (u.includes('/api/hist/live1m/')) {
      log.frames.push(u)
      const m = /\/(\d{2})(\d{2})\.bin$/.exec(u)
      if (!m) return Promise.resolve(statusResponse(404))
      const t = OPEN + (Number(m[1]) * 60 + Number(m[2]) - 570) * 60
      if (!u.endsWith(framePath(t / 60)) || nowS < t + 60 + GRACE_S) return Promise.resolve(statusResponse(404))
      if (!log.served.has(t)) log.served.set(t, now)
      const rows = SYMS.map((sym, i) => { const { t: _t, ...b } = truth1(i, t); return { sym, ...b } })
      return Promise.resolve(frameResponse(writeFrame({ minute: t / 60, blocks: [{ rows }] })))
    }
    if (!u.includes('/api/bars/')) return new Promise(() => {})
    const q = parseBarsUrl(u)
    log.bars.push(q)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = SYMS.indexOf(q.sym)
        let body
        if (q.tf !== TF || i < 0) body = { ticker: q.sym, tf: q.tf, bars: [], no_data: true }
        else {
          const bars = []
          for (let t = OPEN; t + 300 <= nowS - SEAL_LAG_S; t += 300) if (q.since == null || t > q.since) bars.push(truth5(i, t))
          let C = null
          for (let t = OPEN; t + 300 <= nowS - 45; t += 300) C = t + 300
          const cur = Math.floor(nowS / 300) * 300
          if (model === 'forming' && (q.since == null || cur > q.since)) bars.push(partial5(i, cur))
          body = {
            ticker: q.sym, tf: TF, bars, contract: 1, grid: 'eth-clock', session: 'rth', cache_key: `b1:${q.sym}:${TF}:eth-clock`,
            series_rev: now, history_rev: 1, verified_through: nowS, complete_through: C, tail_status: 'verified',
            developing: model === 'forming' ? { ...partial5(i, cur), rev: now } : null,
            newest_bar_is_forming: model === 'forming',
          }
        }
        resolve({ ok: true, status: 200, headers: { get: () => null }, json: async () => body, clone() { return this } })
      }, LATENCY_MS)
      opts?.signal?.addEventListener?.('abort', () => { clearTimeout(timer); const e = new Error('aborted'); e.name = 'AbortError'; reject(e) })
    })
  })
  return log
}

/** One session. Returns, per press: { walk, i, ok, tail, frontier, forming }. */
async function scan({ feedOn, model }) {
  fakeDb._clear()
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(PAGE_OPEN_MS)
  const jitter = rng(20261124)
  vi.spyOn(Math, 'random').mockImplementation(() => jitter.next())
  localStorage.setItem('barspack.version', 'test')
  localStorage.removeItem('uct.deviceStore')
  if (feedOn) localStorage.setItem('uct.minuteFeed', '1'); else localStorage.removeItem('uct.minuteFeed')
  const log = installNetwork(model)
  const { createBarStore } = await import('./index')
  const { createPrefetch } = await import('./prefetch')
  const { appMinuteFeed } = await import('./minuteFeedSwitch')
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), history: null, device: null,
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(), minuteFeed: appMinuteFeed,
  })
  undo.push(() => store.dispose())
  const pf = createPrefetch({ store, tickerMeta: () => {}, extended: () => false })
  const key = (i) => pf.keyFor(SYMS[i], TF)
  const parked = pf.keyFor('PARK', TF)

  let off = store.subscribe(parked, () => {})                    // the chart the member is on between walks
  expect(!!store.minuteFeed()).toBe(feedOn)
  if (feedOn) await store.minuteFeed().ready

  const events = []
  for (let i = 0; i < ROWS; i++) events.push({ at: PAGE_OPEN_MS + 5000 + i * 100, warm: i })
  WALKS.forEach((t0, walk) => {
    for (let i = 0; i < ROWS; i++) events.push({ at: t0 + i * STEP_MS, press: i, walk })
    events.push({ at: t0 + ROWS * STEP_MS, park: true })
  })
  events.sort((a, b) => a.at - b.at)
  const presses = []
  for (const ev of events) {
    if (ev.at > Date.now()) await vi.advanceTimersByTimeAsync(ev.at - Date.now())
    if (ev.warm != null) { pf.ensure(key(ev.warm), { priority: 'urgent' }); continue }
    if (ev.park) { off(); off = store.subscribe(parked, () => {}); continue }
    const i = ev.press
    const nowS = Math.floor(Date.now() / 1000)
    const frontier = Math.floor(nowS / 300) * 300 - 300          // the 5m bucket that last closed
    const asked = log.bars.length + log.frames.length
    const ok = pf.peekDisplayable(SYMS[i], TF)                   // THE SWITCH'S LOOK, in the key press
    expect(log.bars.length + log.frames.length).toBe(asked)      // ...which asks for nothing
    const s = store.peek(key(i))
    const tail = s?.bars.length ? s.bars[s.bars.length - 1].t : null
    // the newest four closed rows are the TRUE buckets, with none missing between them
    const recent = (s?.bars ?? []).slice(-4)
    for (let k = 0; k < recent.length; k++) {
      const { src: _src, rev: _rev, fin: _fin, ...b } = recent[k]
      expect(b, `walk ${ev.walk + 1} press ${i}: ${SYMS[i]} row at ${b.t}`).toEqual(truth5(i, b.t))
      if (k) expect(b.t - recent[k - 1].t, `walk ${ev.walk + 1} press ${i}: ${SYMS[i]} a bucket is missing before ${b.t}`).toBe(300)
    }
    if (s && !s.developing) expect(newestBarIsFormingOf(s), `walk ${ev.walk + 1} press ${i}: closed newest bar reported as forming`).not.toBe(true)
    presses.push({ walk: ev.walk, i, ok, tail, frontier, forming: s?.developing?.t ?? null })
    if (!ok) pf.prepareForDisplay(SYMS[i], TF).catch(() => {})  // today's path: ask for the tail, then paint
    off()
    off = store.subscribe(key(i), () => {})                      // the chart is now on the pressed row
  }
  await vi.advanceTimersByTimeAsync(500)
  off()
  const status = store.minuteFeed()?.status() ?? null
  store.dispose()
  return { presses, log, status }
}

const okOf = (ps, walk) => ps.filter((p) => p.walk === walk && p.ok).length

describe('three walks of a 20-row list on a 5-minute chart, one per 5m bucket', () => {
  it('feed ON: the first press of a row waits as today, every later walk switches in the key press; OFF: none does', async () => {
    const off = await scan({ feedOn: false, model: 'closed' })
    const on = await scan({ feedOn: true, model: 'closed' })
    expect(on.presses).toHaveLength(3 * ROWS)
    expect(off.presses).toHaveLength(3 * ROWS)
    console.log(`MINUTE-FEED-SCAN-5M model=closed rows=${ROWS} `
      + `feed-on walk1=${okOf(on.presses, 0)}/${ROWS} walk2=${okOf(on.presses, 1)}/${ROWS} walk3=${okOf(on.presses, 2)}/${ROWS} `
      + `feed-off walk1=${okOf(off.presses, 0)}/${ROWS} walk2=${okOf(off.presses, 1)}/${ROWS} walk3=${okOf(off.presses, 2)}/${ROWS}`)
    // OFF (every member today): each copy is a bucket behind at every walk
    expect([0, 1, 2].map((w) => okOf(off.presses, w))).toEqual([0, 0, 0])
    // ON: walk 1 is today's (the opened-in bucket cannot be completed); walks 2 and 3 switch in the key press
    expect([0, 1, 2].map((w) => okOf(on.presses, w))).toEqual([0, ROWS, ROWS])
    for (const p of on.presses) {
      if (p.walk === 0) continue
      expect(p.tail, `walk ${p.walk + 1} press ${p.i}`).toBe(p.frontier)   // closed through the bucket that last closed
      expect(p.forming, `walk ${p.walk + 1} press ${p.i}: a forming bar was made up`).toBe(null)
    }
    // nothing that switched in the key press with the feed off waits with it on
    for (let k = 0; k < on.presses.length; k++) if (off.presses[k].ok) expect(on.presses[k].ok, `press ${k}`).toBe(true)
    // the cost: off, not one request to the feed; on, one minute file a minute for the page and never the day
    expect(off.log.frames).toEqual([])
    expect(off.status).toBe(null)
    expect(on.log.frames.every((u) => /\/\d{4}\.bin$/.test(u))).toBe(true)
    const minutes = (WALKS[2] + (ROWS + 1) * STEP_MS - PAGE_OPEN_MS) / 60_000
    expect(on.log.frames.length).toBeLessThanOrEqual(Math.ceil(minutes) + 2)
    expect(new Set(on.log.frames).size).toBe(on.log.frames.length)
    expect(on.status).toMatchObject({ running: true, refused: 0, pauses: 0, breaks: 0, rejected: 0 })
    expect(on.status.appended).toBe(2 * ROWS)                    // two buckets a row, and nothing else
  }, 120_000)

  it('answers that carry a forming bar: the feed closes it with the true bucket, and no press gets worse', async () => {
    const off = await scan({ feedOn: false, model: 'forming' })
    const on = await scan({ feedOn: true, model: 'forming' })
    console.log(`MINUTE-FEED-SCAN-5M model=forming rows=${ROWS} `
      + `feed-on walk1=${okOf(on.presses, 0)}/${ROWS} walk2=${okOf(on.presses, 1)}/${ROWS} walk3=${okOf(on.presses, 2)}/${ROWS} `
      + `feed-off walk1=${okOf(off.presses, 0)}/${ROWS} walk2=${okOf(off.presses, 1)}/${ROWS} walk3=${okOf(off.presses, 2)}/${ROWS}`)
    for (let k = 0; k < on.presses.length; k++) if (off.presses[k].ok) expect(on.presses[k].ok, `press ${k}`).toBe(true)
    // with the feed on, the bucket that last closed is never LESS often a closed row of the copy (off: a stale forming bar)
    const closedTail = (ps) => ps.filter((p) => p.tail != null && p.tail >= p.frontier).length
    console.log(`MINUTE-FEED-SCAN-5M model=forming closed-tail-at-press feed-on=${closedTail(on.presses)}/${on.presses.length} feed-off=${closedTail(off.presses)}/${off.presses.length}`)
    expect(closedTail(on.presses)).toBeGreaterThanOrEqual(closedTail(off.presses))
    expect(on.status).toMatchObject({ breaks: 0, rejected: 0 })
  }, 120_000)
})
