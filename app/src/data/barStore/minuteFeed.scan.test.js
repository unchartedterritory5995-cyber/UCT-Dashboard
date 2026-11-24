// ⭐ THE SCAN: A MEMBER WALKS A WATCHLIST ON A 1-MINUTE CHART DURING THE SESSION (2026-11-23, minuteFeed.js).
//
// 100 rows, the next row every 2.5 s for 200 s (80 presses, 10:00:20 to 10:03:37.5), across three minute boundaries. Each row was warmed 65 s
// before its press, as the list's warm does. The REAL bar store, the REAL switch rule (`prefetch.peekDisplayable`, so
// the real `_behindClock`), the REAL reducer, the REAL minute-feed switch, chunk, consumer and applier, on a fake
// clock. Only the network is a model:
//   • /api/bars answers 80 ms after it is asked with the server's rows as of then: every minute closed at least 2 s
//     ago. Model 'closed' (what the server sends for a symbol no stream is on: api/services/bar_contract._developing
//     needs the forming row in the store) carries no forming bar; model 'forming' carries one in every answer.
//   • the edge has minute M's frame from 5 s after M ends (the publisher's grace), and the consumer asks at 7 s plus
//     its 0-3 s jitter: each closed minute lands 7-10 s after its boundary.
//
// What is asserted, per press, at the press, with no request made by the look itself:
//   A. FEED ON, model 'closed': the row is displayable EXACTLY when the frame of the minute that just closed has
//      landed. So every press outside the publish window (the first 7-10 s of a minute) switches in the key press.
//   B. FEED OFF (every member today): the baseline share, printed beside it.
//   C. NO REGRESSION, both models: a row displayable with the feed off is displayable with it on.
//   D. NEVER A HOLE, NEVER A PARTIAL BAR AS A CLOSED ONE: at every press, every closed row of the last five minutes of
//      the pressed row's copy is the true bar of its minute, and no minute between them is missing.
//   E. COST: on, one minute file a minute for the whole page and never the day; off, not one request to the feed.
//   F. NEVER "FORMING" ON A CLOSED BAR (review M1): a pressed copy whose newest row is a closed bar is never handed to
//      the chart's runs as newest_bar_is_forming = true.
//   G. THE DEVICE STORE ON (every desktop member): the page never downloads a minute file. The device store's worker
//      downloads it 7-10 s after the boundary and tells the pages (both modelled); the page reads the browser's copy,
//      cache-only, ONCE per minute, with not one look that misses, and the same presses switch in the key press.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { parseBarsUrl } from './testing/fakeBarsServer'
import { newestBarIsFormingOf } from './adapter'
import { rng } from './__fixtures__/seededSeries'
import { writeFrame, framePath, frameResponse, statusResponse } from '../../lib/minuteFrames/testing/frameWriter'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const OPEN = Date.UTC(2026, 10, 10, 14, 30) / 1000               // Tue 2026-11-10 09:30 ET (unix s)
const T0 = (OPEN + 30 * 60 + 20) * 1000                          // the first press: 10:00:20.000
const ROWS = 100
const PRESSES = 80                                               // 200 s at one press per 2.5 s
const STEP_MS = 2500
const WARM_LEAD_MS = 65_000                                      // a row is warmed this long before its press
const PAGE_OPEN_MS = T0 - 140_000                                // the page (and its first chart) opens at 09:58:00
const LATENCY_MS = 80                                            // /api/bars: asked -> answered
const SEAL_LAG_S = 2                                             // a closed minute is in the server's rows 2 s after it ends
const GRACE_S = 5                                                // the publisher builds minute M's frame 5 s after M ends
const SYMS = Array.from({ length: ROWS }, (_, i) => `S${String(i).padStart(3, '0')}`)
const r2 = (x) => Math.round(x * 100) / 100

/** THE TRUTH: the closed bar of symbol i in the minute starting at unix s `t` (every symbol trades every minute). */
function truth(i, t) {
  const m = (t - OPEN) / 60
  const o = r2(20 + i + (m % 7) * 0.01)
  return { t, o, h: r2(o + 0.05), l: r2(o - 0.05), c: r2(o + 0.02), v: 1000 + m }
}
/** ...and what the server holds of a minute still forming: a narrower range, less volume. */
function partial(i, t) {
  const b = truth(i, t)
  return { t, o: b.o, h: r2(b.o + 0.01), l: r2(b.o - 0.01), c: b.o, v: 7 }
}

let fakeDb
/** Stores to dispose even when a scan fails half way. */
const undo = []
beforeAll(() => { fakeDb = installFakeIndexedDB() })
afterEach(() => {
  for (const f of undo.splice(0)) { try { f() } catch { /* already gone */ } }
  vi.useRealTimers(); vi.restoreAllMocks(); localStorage.removeItem('uct.minuteFeed'); localStorage.removeItem('barspack.version')
  localStorage.removeItem('uct.deviceStore')
  vi.unstubAllGlobals()
  BUS.clear()
})

/** A BroadcastChannel that delivers at once to every OTHER channel of its name (as the browser's does, minus the
 *  task hop): the device store's worker (the model below) tells, the page's feed listens. */
const BUS = new Map()
class FakeBroadcastChannel {
  constructor(name) { this.name = name; this.onmessage = null; if (!BUS.has(name)) BUS.set(name, new Set()); BUS.get(name).add(this) }
  postMessage(data) { for (const o of BUS.get(this.name) ?? []) if (o !== this) o.onmessage?.({ data }) }
  close() { BUS.get(this.name)?.delete(this) }
}

/** The modelled network (see the header). Records what was asked. */
/** STORE ON: when the device store's worker has minute `t` in the browser cache: its own ask (the minute's end + 7 s +
 *  its 0-3 s jitter, here a fixed spread per minute) plus the download. */
const workerHasAt = (t) => (t + 60) * 1000 + 7000 + ((t / 60) * 7919) % 3000 + 150

function installNetwork(model, storeOn = false) {
  const log = { bars: [], frames: [], other: [], served: new Map(), second: [], lookups: 0, misses: 0 }
  globalThis.fetch = vi.fn((url, opts) => {
    const u = String(url)
    const now = Date.now()
    const nowS = Math.floor(now / 1000)
    if (u.includes('/api/hist/live1m/')) {
      log.frames.push(u)
      const m = /\/(\d{2})(\d{2})\.bin$/.exec(u)
      if (!m) return Promise.resolve(statusResponse(404))        // head.json / today.bin: never asked (E)
      const t = OPEN + (Number(m[1]) * 60 + Number(m[2]) - 570) * 60
      if (storeOn) {
        // the page may only READ THE CACHE: anything else is a second download of a file the worker already fetches
        if (opts?.cache !== 'only-if-cached' || opts?.mode !== 'same-origin') log.second.push(u)
        else {
          log.lookups++
          if (now < workerHasAt(t)) {                              // not cached yet: a miss, as each browser reports it
            log.misses++
            return (t / 60) % 2 ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(statusResponse(504))
          }
        }
      }
      if (!u.endsWith(framePath(t / 60)) || nowS < t + 60 + GRACE_S) return Promise.resolve(statusResponse(404))
      if (!log.served.has(t)) log.served.set(t, now)
      const rows = SYMS.map((sym, i) => { const { t: _t, ...b } = truth(i, t); return { sym, ...b } })
      return Promise.resolve(frameResponse(writeFrame({ minute: t / 60, blocks: [{ rows: [...rows, { sym: 'ZZZZ', o: 1, h: 1, l: 1, c: 1, v: 1 }] }] })))
    }
    if (!u.includes('/api/bars/')) { log.other.push(u); return new Promise(() => {}) }
    const q = parseBarsUrl(u)
    log.bars.push(q)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = SYMS.indexOf(q.sym)
        let body
        if (q.tf !== '1' || i < 0) body = { ticker: q.sym, tf: q.tf, bars: [], no_data: true }
        else {
          // built when asked: every minute that closed at least SEAL_LAG_S ago
          const bars = []
          for (let t = OPEN; t + 60 <= nowS - SEAL_LAG_S; t += 60) if (q.since == null || t > q.since) bars.push(truth(i, t))
          let C = null
          for (let t = OPEN; t + 60 <= nowS - 45; t += 60) C = t + 60
          const cur = Math.floor(nowS / 60) * 60
          // as the route sends it: the forming bar is also the LAST of `bars`, and `newest_bar_is_forming` describes bars[-1]
          if (model === 'forming' && (q.since == null || cur > q.since)) bars.push(partial(i, cur))
          body = {
            ticker: q.sym, tf: '1', bars, contract: 1, grid: 'eth-clock', session: 'rth', cache_key: `b1:${q.sym}:1:eth-clock`,
            series_rev: now, history_rev: 1, verified_through: nowS, complete_through: C, tail_status: 'verified',
            developing: model === 'forming' ? { ...partial(i, cur), rev: now } : null,
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

/** One scan. Returns, per press: { i, at, sec, ok, tail, frontier }. */
async function scan({ feedOn, model, storeOn = false }) {
  fakeDb._clear()
  vi.resetModules()                                              // a new page load
  vi.useFakeTimers()
  vi.setSystemTime(PAGE_OPEN_MS)
  const jitter = rng(20261123)
  vi.spyOn(Math, 'random').mockImplementation(() => jitter.next())   // the consumer's 0-3 s jitter, the same every run
  localStorage.setItem('barspack.version', 'test')
  if (feedOn) localStorage.setItem('uct.minuteFeed', '1'); else localStorage.removeItem('uct.minuteFeed')
  // the device store's SWITCH is on; its worker is the model above (the bar store here is handed no device source)
  if (storeOn) localStorage.setItem('uct.deviceStore', '1'); else localStorage.removeItem('uct.deviceStore')
  const log = installNetwork(model, storeOn)
  if (storeOn) {
    // the device store's worker: when it has a minute's file (workerHasAt), it tells every page (lib/minuteFrames/applied.js)
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    const worker = new FakeBroadcastChannel('uct-minute-applied')
    for (let t = OPEN + 26 * 60; t <= OPEN + 34 * 60; t += 60) {
      const m = (t - OPEN) / 60 + 570
      const msg = { type: 'minute-applied', day: '2026-11-10', seq: m - 240, minute: t / 60, hhmm: `${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}` }
      if (workerHasAt(t) > PAGE_OPEN_MS) setTimeout(() => worker.postMessage(msg), workerHasAt(t) - PAGE_OPEN_MS)
    }
  }
  const { createBarStore } = await import('./index')
  const { createPrefetch } = await import('./prefetch')
  const { appMinuteFeed } = await import('./minuteFeedSwitch')
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), history: null, device: null,
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(), minuteFeed: appMinuteFeed,
  })
  undo.push(() => store.dispose())
  const pf = createPrefetch({ store, tickerMeta: () => {}, extended: () => false })
  const key = (i) => pf.keyFor(SYMS[i], '1')

  // the page's first chart: what was on screen before the scan (it starts the feed, when the switch is on)
  let off = store.subscribe(pf.keyFor('SEED', '1'), () => {})
  expect(!!store.minuteFeed()).toBe(feedOn)
  if (feedOn) await store.minuteFeed().ready

  const events = []
  for (let i = 0; i < ROWS; i++) events.push({ at: T0 + i * STEP_MS - WARM_LEAD_MS, warm: i })
  for (let i = 0; i < PRESSES; i++) events.push({ at: T0 + i * STEP_MS, press: i })
  events.sort((a, b) => a.at - b.at || (a.warm != null ? -1 : 1))
  const presses = []
  for (const ev of events) {
    if (ev.at > T0 + PRESSES * STEP_MS) break
    if (ev.at > Date.now()) await vi.advanceTimersByTimeAsync(ev.at - Date.now())
    if (ev.warm != null) { pf.ensure(key(ev.warm), { priority: 'urgent' }); continue }
    const i = ev.press
    const nowS = Math.floor(Date.now() / 1000)
    const frontier = Math.floor(nowS / 60) * 60 - 60             // the minute that just closed
    const asked = log.bars.length + log.frames.length
    const ok = pf.peekDisplayable(SYMS[i], '1')                  // THE SWITCH'S LOOK, in the key press
    expect(log.bars.length + log.frames.length).toBe(asked)      // ...which asks for nothing
    const s = store.peek(key(i))
    const tail = s?.bars.length ? s.bars[s.bars.length - 1].t : null
    // D: the newest five minutes of closed rows are the true bars, with no minute missing between them
    const recent = (s?.bars ?? []).filter((b) => b.t > tail - 300)
    for (let k = 0; k < recent.length; k++) {
      const { src: _src, rev: _rev, fin: _fin, ...b } = recent[k]
      expect(b, `press ${i}: ${SYMS[i]} row at ${b.t}`).toEqual(truth(i, b.t))
      if (k) expect(b.t - recent[k - 1].t, `press ${i}: ${SYMS[i]} a minute is missing before ${b.t}`).toBe(60)
    }
    // F: a newest row that is a CLOSED bar is never reported as forming
    if (s && !s.developing) expect(newestBarIsFormingOf(s), `press ${i}: ${SYMS[i]} closed newest bar reported as forming`).not.toBe(true)
    presses.push({ i, at: Date.now(), sec: nowS % 60, ok, tail, frontier })
    if (!ok) pf.prepareForDisplay(SYMS[i], '1').catch(() => {}) // today's path: ask for the tail, then paint
    off()
    off = store.subscribe(key(i), () => {})                      // the chart is now on the pressed row
  }
  await vi.advanceTimersByTimeAsync(500)
  off()
  const status = store.minuteFeed()?.status() ?? null
  store.dispose()
  return { presses, log, status }
}

const share = (ps) => ps.filter((p) => p.ok).length / ps.length

describe('a 200-second scan of a 100-row list on a 1-minute chart', () => {
  it('feed ON: every press outside the publish window switches in the key press; OFF: the baseline; both printed', async () => {
    const off = await scan({ feedOn: false, model: 'closed' })
    const on = await scan({ feedOn: true, model: 'closed' })
    expect(on.presses).toHaveLength(PRESSES)
    expect(off.presses).toHaveLength(PRESSES)

    // A: displayable exactly when the frame of the minute that just closed had landed before the press
    for (const p of on.presses) {
      const landed = on.log.served.get(p.frontier)
      const expected = landed != null && landed <= p.at
      expect(p.ok, `press ${p.i} at second ${p.sec}: frame of the closed minute ${landed == null ? 'not asked yet' : `landed ${(landed - p.at) / 1000} s from the press`}`).toBe(expected)
    }
    // each closed minute landed 7-10 s after its boundary
    for (const [t, at] of on.log.served) {
      if (at < T0) continue
      expect(at - (t + 60) * 1000).toBeGreaterThanOrEqual(7000)
      expect(at - (t + 60) * 1000).toBeLessThan(10_500)
    }
    const sOn = share(on.presses)
    const sOff = share(off.presses)
    const window = on.presses.filter((p) => !p.ok).map((p) => p.sec)
    console.log(`MINUTE-FEED-SCAN model=closed presses=${PRESSES} feed-on=${(sOn * 100).toFixed(1)}% (${on.presses.filter((p) => p.ok).length}/${PRESSES}) `
      + `feed-off=${(sOff * 100).toFixed(1)}% (${off.presses.filter((p) => p.ok).length}/${PRESSES}) `
      + `misses-on at seconds [${[...new Set(window)].sort((a, b) => a - b).join(', ')}]`)
    // three publish windows of 7-10 s in 200 s: 9 to 12 of the 80 presses land inside one
    expect(sOn).toBeGreaterThanOrEqual(0.83)
    expect(sOn).toBeLessThanOrEqual(0.90)
    expect(Math.max(...window)).toBeLessThan(10.5)               // every miss is inside the publish window
    expect(sOff).toBeLessThan(0.35)                              // B: today, measured live at 27%
    // C: nothing that switched in the key press with the feed off waits with it on
    for (let k = 0; k < PRESSES; k++) if (off.presses[k].ok) expect(on.presses[k].ok, `press ${k}`).toBe(true)

    // E: the cost
    expect(off.log.frames).toEqual([])                           // off: not one request to the feed
    expect(off.status).toBe(null)
    expect(on.log.frames.every((u) => /\/\d{4}\.bin$/.test(u))).toBe(true)   // never head.json, never today.bin
    const minutes = (T0 + PRESSES * STEP_MS - PAGE_OPEN_MS) / 60_000
    expect(on.log.frames.length).toBeLessThanOrEqual(Math.ceil(minutes) + 2)  // one a minute for the PAGE (100 rows held)
    expect(new Set(on.log.frames).size).toBe(on.log.frames.length)           // no minute asked twice
    // ...and nothing was asked while the page held no idle 1m key: it opened at 09:58:00 with one chart and no list
    // row (09:56 was due then); the first row was warmed at 09:59:15, when 09:58 was the minute due
    expect(on.log.frames[0]).toMatch(/\/0958\.bin$/)
    expect(on.status).toMatchObject({ running: true, refused: 0, pauses: 0, breaks: 0 })
    expect(on.status.appended).toBeGreaterThan(100)
  }, 120_000)

  it('the device store ON: the page never downloads a minute file, and the same presses switch in the key press', async () => {
    const on = await scan({ feedOn: true, model: 'closed', storeOn: true })
    expect(on.presses).toHaveLength(PRESSES)
    // G: not one request that could reach the network; every look is cache-only
    expect(on.log.second).toEqual([])
    expect(on.log.lookups).toBe(on.log.frames.length)
    expect(on.log.frames.every((u) => /\/\d{4}\.bin$/.test(u))).toBe(true)
    // A, as with the store off: displayable exactly when the minute that just closed had been read
    for (const p of on.presses) {
      const landed = on.log.served.get(p.frontier)
      if (landed === p.at) continue                               // read in the very millisecond of the press: either
      expect(p.ok, `press ${p.i} at second ${p.sec}`).toBe(landed != null && landed <= p.at)
    }
    // the page reads each minute the moment the worker tells it, ONCE, and not one look misses
    for (const [t, at] of on.log.served) expect(at).toBe(workerHasAt(t))
    expect(on.log.misses).toBe(0)
    expect(on.log.lookups).toBe(on.log.served.size)
    const sOn = share(on.presses)
    console.log(`MINUTE-FEED-SCAN model=closed device-store=ON presses=${PRESSES} feed-on=${(sOn * 100).toFixed(1)}% `
      + `(${on.presses.filter((p) => p.ok).length}/${PRESSES}) cache reads=${on.log.lookups} hits=${on.log.served.size} misses=${on.log.misses} downloads by the page=${on.log.second.length}`)
    expect(sOn).toBeGreaterThanOrEqual(0.78)
    expect(sOn).toBeLessThanOrEqual(0.90)
    expect(on.status).toMatchObject({ running: true, cacheOnly: true, listening: true, refused: 0, pauses: 0, breaks: 0 })
    expect(on.status.appended).toBeGreaterThan(100)
  }, 120_000)

  it('answers that carry a forming bar: the feed closes it with the real bar and no press gets worse', async () => {
    const off = await scan({ feedOn: false, model: 'forming' })
    const on = await scan({ feedOn: true, model: 'forming' })
    const sOn = share(on.presses)
    const sOff = share(off.presses)
    console.log(`MINUTE-FEED-SCAN model=forming presses=${PRESSES} feed-on=${(sOn * 100).toFixed(1)}% feed-off=${(sOff * 100).toFixed(1)}%`)
    for (let k = 0; k < PRESSES; k++) if (off.presses[k].ok) expect(on.presses[k].ok, `press ${k}`).toBe(true)
    expect(sOn).toBeGreaterThanOrEqual(sOff)
    // with the feed on the copy's tail is a CLOSED bar far more often (a forming bar it held was closed by the feed)
    const closedTail = (ps) => ps.filter((p) => p.tail != null && p.tail >= p.frontier).length
    expect(closedTail(on.presses)).toBeGreaterThan(closedTail(off.presses))
    expect(on.status).toMatchObject({ breaks: 0 })
  }, 120_000)
})
