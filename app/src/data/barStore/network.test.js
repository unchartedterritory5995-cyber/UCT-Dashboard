// S9 — network.js (docs/architecture/barstore.md §Network): ≤1 request in flight per key,
// 0 after unsubscribe, abort observed, a stale gen dropped, the poll budget per simulated
// hour (current / unverified / shedding server), delta vs full, session per key, hidden pause.
// Fake timers + a mocked request; the server answers from the simulated clock.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRegistry } from './registry'
import { createNetwork, barsUrl, DAILY_POLL_MS } from './network'
import { keyOf } from './types'
import { bucketStartUnix } from '../../components/chart/barTime'
import { bucketEndUnix } from '../../components/chart/liveBuckets'
import { TAIL_CATCHUP_MAX_TRIES, INTRADAY_POLL_MS } from '../../utils/intradayTailPoll'

const T0 = Date.UTC(2026, 10, 10, 15, 0)   // Tue 2026-11-10 10:00 ET
const HOUR = 3600_000
/** The per-key budget of one simulated hour: the 30 s cadence + one fast catch-up burst. */
const BUDGET_PER_HOUR = HOUR / INTRADAY_POLL_MS + TAIL_CATCHUP_MAX_TRIES

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0) })
afterEach(() => { vi.useRealTimers() })

/** A contract answer for a 5m/1m key as the server would give it at Date.now(). */
function answer(key, { tailStatus = 'verified', sealLagS = 45, since = null, extra = {} } = {}) {
  const [sym, tfS] = key.split('_')
  const tf = Number(tfS)
  const now = Math.floor(Date.now() / 1000)
  const open = Date.UTC(2026, 10, 10, 14, 30) / 1000
  const bars = []
  for (let t = open; t <= now; t = bucketEndUnix(t, tf, {})) {
    const s = bucketStartUnix(t, tf, {})
    if (since != null && s <= since) continue
    bars.push({ t: s, o: 100, h: 101, l: 99, c: 100.5, v: 10 })
  }
  let C = null
  for (const b of bars) { const e = bucketEndUnix(b.t, tf, {}); if (e <= now - sealLagS) C = e }
  const last = bars[bars.length - 1]
  const dev = last && bucketEndUnix(last.t, tf, {}) > now ? { ...last, rev: Date.now() } : null
  return {
    bars, contract: 1, grid: 'eth-clock', session: 'rth', cache_key: `b1:${sym}:${tfS}:eth-clock`,
    series_rev: Date.now(), history_rev: 1, verified_through: tailStatus === 'verified' ? now : null,
    complete_through: C, developing: dev, tail_status: tailStatus, ...extra,
  }
}

function world({ request, hidden = false } = {}) {
  const registry = createRegistry({ ctx: () => ({ nowMs: Date.now() }) })
  let visibleCb = null
  const state = { hidden }
  const net = createNetwork({
    registry, request, isHidden: () => state.hidden, onVisible: (cb) => { visibleCb = cb; return () => {} },
  })
  return { registry, net, state, show: () => { state.hidden = false; visibleCb?.() } }
}

/** request mock that records calls and concurrency per key. */
function recorder(impl) {
  const calls = []
  let live = 0, maxLive = 0
  const fn = vi.fn(async (url, opts) => {
    calls.push({ url, opts, at: Date.now() })
    live++; maxLive = Math.max(maxLive, live)
    try { return await impl(url, opts) } finally { live-- }
  })
  return { fn, calls, max: () => maxLive }
}
const keyOfUrl = (url) => decodeURIComponent(url.split('/api/bars/')[1].split('?')[0])

describe('S9 poll budget per simulated hour', () => {
  it('a current, verified tail polls on the 30 s cadence — within budget, never silent', async () => {
    const key = keyOf({ sym: 'SIM', tf: '5' })
    const rec = recorder(async (url) => answer(key, { since: /since=(\d+)/.exec(url)?.[1] ?? null }))
    const w = world({ request: rec.fn })
    w.net.start(key)
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(rec.calls.length).toBeLessThanOrEqual(BUDGET_PER_HOUR)
    expect(rec.calls.length).toBeGreaterThanOrEqual(HOUR / INTRADAY_POLL_MS - 2)
    expect(rec.max()).toBe(1)
  })

  it('a server that keeps answering `unverified` (Retry-After) gets one fast burst, then the cadence', async () => {
    const key = keyOf({ sym: 'SIM', tf: '1' })
    const rec = recorder(async () => answer(key, { tailStatus: 'unverified', extra: { retry_after: 3 } }))
    const w = world({ request: rec.fn })
    w.net.start(key)
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(rec.calls.length).toBeLessThanOrEqual(BUDGET_PER_HOUR)
    // Retry-After is honored: no two requests closer than 3 s.
    for (let i = 1; i < rec.calls.length; i++) expect(rec.calls[i].at - rec.calls[i - 1].at).toBeGreaterThanOrEqual(3000)
  })

  it('a shedding server (503 + Retry-After) is backed off, within budget', async () => {
    const key = keyOf({ sym: 'SIM', tf: '5' })
    const rec = recorder(async () => { const e = new Error('HTTP 503'); e.status = 503; e.warming = true; e.retryAfterMs = 3000; throw e })
    const w = world({ request: rec.fn })
    w.net.start(key)
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(rec.calls.length).toBeLessThanOrEqual(BUDGET_PER_HOUR)
    expect(w.registry.getSnapshot(key).error).toBe('warming')
  })

  it('D/W/M poll on the daily cadence and always read whole (never sealed, never since=)', async () => {
    const key = keyOf({ sym: 'SIM', tf: 'D' })
    const rec = recorder(async () => ({ bars: [{ t: '2026-11-09', o: 1, h: 2, l: 0.5, c: 1.5, v: 9 }], contract: 1, grid: 'plain', cache_key: 'b1:SIM:D:plain', series_rev: 1, history_rev: 1, complete_through: null }))
    const w = world({ request: rec.fn })
    w.net.start(key)
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(rec.calls.length).toBeLessThanOrEqual(HOUR / DAILY_POLL_MS + 1)
    expect(rec.calls.every((c) => !/since=/.test(c.url) && !/session=/.test(c.url))).toBe(true)
  })

  it('pauses while hidden and resumes on visible', async () => {
    const key = keyOf({ sym: 'SIM', tf: '5' })
    const rec = recorder(async () => answer(key))
    const w = world({ request: rec.fn, hidden: true })
    w.net.start(key)
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(rec.calls.length).toBe(0)
    w.show()
    await vi.advanceTimersByTimeAsync(10)
    expect(rec.calls.length).toBe(1)
  })
})

describe('S9 one request per key; abort; gen', () => {
  function deferredRequest() {
    const pending = []
    const fn = vi.fn((url, opts) => new Promise((resolve, reject) => {
      const p = { url, opts, resolve, reject }
      pending.push(p)
      opts?.signal?.addEventListener?.('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e) })
    }))
    return { fn, pending }
  }

  it('≤1 in flight per key across loop ticks, kicks, fetchOnce and scroll-back; distinct keys run in parallel', async () => {
    const a = keyOf({ sym: 'AAA', tf: '5' }), b = keyOf({ sym: 'BBB', tf: '5' })
    const d = deferredRequest()
    const w = world({ request: d.fn })
    w.net.start(a); w.net.start(b)
    await vi.advanceTimersByTimeAsync(0)
    expect(d.fn).toHaveBeenCalledTimes(2)                     // one per key
    for (let i = 0; i < 5; i++) { w.net.kick(a); w.net.fetchOnce(a); w.net.scrollBack(a) }
    await vi.advanceTimersByTimeAsync(5000)
    const forA = () => d.fn.mock.calls.filter(([u]) => keyOfUrl(u) === 'AAA')
    expect(forA().length).toBe(1)
    expect(w.net.inflight(a)).toBe(1)
    // resolve A → its queued scroll-back may start, but still one at a time
    d.pending.find((p) => keyOfUrl(p.url) === 'AAA').resolve(answer(a))
    await vi.advanceTimersByTimeAsync(0)
    expect(w.net.inflight(a)).toBeLessThanOrEqual(1)
    let maxA = 0
    for (let i = 0; i < 20; i++) {
      const open = d.pending.filter((p) => keyOfUrl(p.url) === 'AAA' && !p.done)
      maxA = Math.max(maxA, w.net.inflight(a))
      for (const p of open) { p.done = true; p.resolve(/to=/.test(p.url) ? { bars: [] } : answer(a)) }
      await vi.advanceTimersByTimeAsync(31_000)
    }
    expect(maxA).toBeLessThanOrEqual(1)
  })

  it('0 requests after unsubscribe, and the request in flight observes its abort', async () => {
    const key = keyOf({ sym: 'SIM', tf: '1' })
    const d = deferredRequest()
    const w = world({ request: d.fn })
    const stop = w.net.start(key)
    await vi.advanceTimersByTimeAsync(0)
    expect(d.fn).toHaveBeenCalledTimes(1)
    const sig = d.pending[0].opts.signal
    stop()
    expect(sig.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(d.fn).toHaveBeenCalledTimes(1)
    expect(w.net.stats().keys).toBe(0)
  })

  it('refcounted: the loop runs until the LAST subscriber stops', async () => {
    const key = keyOf({ sym: 'SIM', tf: '5' })
    const rec = recorder(async () => answer(key))
    const w = world({ request: rec.fn })
    const s1 = w.net.start(key), s2 = w.net.start(key)
    await vi.advanceTimersByTimeAsync(61_000)
    s1()
    const n = rec.calls.length
    await vi.advanceTimersByTimeAsync(61_000)
    expect(rec.calls.length).toBeGreaterThan(n)
    s2()
    const m = rec.calls.length
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(rec.calls.length).toBe(m)
  })

  it('kick({abort}) aborts the request in flight and starts a new one; its late answer is dropped', async () => {
    const key = keyOf({ sym: 'SIM', tf: '5' })
    const d = deferredRequest()
    const w = world({ request: d.fn })
    w.net.start(key)
    await vi.advanceTimersByTimeAsync(0)
    const first = d.pending[0]
    w.net.kick(key, { abort: true })
    expect(first.opts.signal.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(d.fn).toHaveBeenCalledTimes(2)
    expect(w.net.inflight(key)).toBe(1)
  })

  it('an answer requested before an invalidate never lands after it (gen)', async () => {
    const key = keyOf({ sym: 'SIM', tf: '5' })
    const d = deferredRequest()
    const w = world({ request: d.fn })
    w.net.start(key)
    await vi.advanceTimersByTimeAsync(0)
    w.registry.invalidate(key, 'test')                         // NOT aborted: the old answer still arrives
    const before = w.registry.getSnapshot(key)
    d.pending[0].resolve(answer(key))
    await vi.advanceTimersByTimeAsync(0)
    const after = w.registry.getSnapshot(key)
    expect(after.bars.length).toBe(0)
    expect(after.developing).toBe(null)
    expect(after.baseRev).toBe(before.baseRev)
  })

  it('a joined request that outlives the abort is dropped too', async () => {
    const key = keyOf({ sym: 'SIM', tf: '5' })
    let resolve
    const shared = new Promise((r) => { resolve = r })      // ignores the signal (a joined warm)
    const w = world({ request: vi.fn(() => shared) })
    const stop = w.net.start(key)
    await vi.advanceTimersByTimeAsync(0)
    stop()
    resolve(answer(key))
    await vi.advanceTimersByTimeAsync(0)
    expect(w.registry.getSnapshot(key).bars.length).toBe(0)
  })
})

describe('what is asked', () => {
  it('first a FULL read; once a seal is held, since= deltaFrom − 1 (and the delta span starts at deltaFrom)', async () => {
    const key = keyOf({ sym: 'SIM', tf: '5' })
    const rec = recorder(async (url) => answer(key, { since: /since=(\d+)/.exec(url)?.[1] ? Number(/since=(\d+)/.exec(url)[1]) : null }))
    const w = world({ request: rec.fn })
    w.net.start(key)
    await vi.advanceTimersByTimeAsync(0)
    expect(rec.calls[0].url).not.toMatch(/since=/)
    const s = w.registry.getSnapshot(key)
    expect(s.sealedSpans.length).toBeGreaterThan(0)
    await vi.advanceTimersByTimeAsync(INTRADAY_POLL_MS + 10)
    expect(rec.calls[1].url).toMatch(new RegExp(`since=${s.deltaFrom - 1}(&|$)`))
  })

  it('a delta that reveals a NEW history triggers the full read at once', async () => {
    const key = keyOf({ sym: 'SIM', tf: '5' })
    let hist = 1
    const rec = recorder(async (url) => answer(key, { extra: { history_rev: hist }, since: /since=(\d+)/.exec(url) ? Number(/since=(\d+)/.exec(url)[1]) : null }))
    const w = world({ request: rec.fn })
    w.net.start(key)
    await vi.advanceTimersByTimeAsync(0)
    hist = 2
    await vi.advanceTimersByTimeAsync(INTRADAY_POLL_MS + 10)
    expect(rec.calls[1].url).toMatch(/since=/)
    await vi.advanceTimersByTimeAsync(10)
    expect(rec.calls.length).toBe(3)
    expect(rec.calls[2].url).not.toMatch(/since=/)
    expect(w.registry.getSnapshot(key).historyRev).toBe(2)
  })

  it('session per key (#1061): 60m keys carry their grid; 1–30m use the subscribers’ session (eth wins)', () => {
    expect(barsUrl(keyOf({ sym: 'A', tf: '60', session: 'rth' }), { bars: 10 })).toMatch(/session=rth/)
    expect(barsUrl(keyOf({ sym: 'A', tf: '60', session: 'eth' }), { bars: 10 })).toMatch(/session=eth/)
    expect(barsUrl(keyOf({ sym: 'A', tf: '5' }), { bars: 10, session: 'eth' })).toMatch(/session=eth/)
    expect(barsUrl(keyOf({ sym: 'A', tf: 'D' }), { bars: 10 })).not.toMatch(/session=/)
    expect(barsUrl(keyOf({ sym: 'A', tf: '5', window: { to: Date.UTC(2026, 9, 15, 20) / 1000 } }), { bars: 10 })).toMatch(/to=2026-10-15/)
  })

  it('the request carries the key’s priority (the shared lane orders by it)', async () => {
    const key = keyOf({ sym: 'SIM', tf: '5' })
    const rec = recorder(async () => answer(key))
    const w = world({ request: rec.fn })
    w.net.start(key, { priority: 'grid' })
    await vi.advanceTimersByTimeAsync(0)
    expect(rec.calls[0].opts.priority).toBe('grid')
    await w.net.fetchOnce(keyOf({ sym: 'OTH', tf: '5' }), { priority: 'background' })
    expect(rec.calls[1].opts.priority).toBe('background')
  })

  it('scroll-back asks the window before the oldest bar (to= its ET date) and prepends it', async () => {
    const key = keyOf({ sym: 'SIM', tf: '5' })
    const old = Date.UTC(2026, 10, 9, 20, 55) / 1000   // 15:55 ET the day before
    const rec = recorder(async (url) => (/to=/.test(url)
      ? { bars: [{ t: old, o: 1, h: 2, l: 0.5, c: 1.5, v: 3 }], series_rev: 1, history_rev: 1, cache_key: 'b1:SIM:5:eth-clock' }
      : answer(key)))
    const w = world({ request: rec.fn })
    w.net.start(key)
    await vi.advanceTimersByTimeAsync(0)
    const res = await w.net.scrollBack(key)
    expect(rec.calls.at(-1).url).toMatch(/to=2026-11-10/)
    expect(res.added).toBe(1)
    expect(w.registry.getSnapshot(key).bars[0].t).toBe(old)
  })
})
