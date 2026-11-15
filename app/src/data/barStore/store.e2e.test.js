// End-to-end: createBarStore over a mocked server (P1 contract fields, seal lag, developing
// bar) + a mocked push stream (frames per trade, finals after each bucket) + the real
// persist write path on a fake IndexedDB. Every snapshot a subscriber sees satisfies the
// invariants (S1, S3, S10 frozen + legal transitions, S2); after the session the sealed rows
// equal the truth; unsubscribing stops all I/O; a reload hydrates the seals and asks a delta.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createBarStore } from './index'
import { keyOf } from './types'
import { isSealedRow } from './reducer'
import { isLegalTransition } from './status'
import { bucketStartUnix } from '../../components/chart/barTime'
import { bucketEndUnix } from '../../components/chart/liveBuckets'
import { rng } from './__fixtures__/seededSeries'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { memClear } from '../../utils/barsMemCache'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'

const OPEN = Date.UTC(2026, 10, 10, 14, 30) / 1000     // Tue 09:30 ET
const SEAL_LAG = 45
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { memClear(); fakeDb._clear(); vi.useFakeTimers(); vi.setSystemTime(OPEN * 1000 + 5 * 60_000) })
afterEach(() => { vi.useRealTimers() })
function check(cond, msg) { if (!cond) throw new Error(typeof msg === 'function' ? msg() : msg) }

/** A seeded market: one trade every 20 s from the open (synthetic prices). */
function market(seed, tf) {
  const r = rng(seed)
  const trades = []
  let px = r.float(20, 300)
  for (let t = OPEN; t < OPEN + 3 * 3600; t += 20) {
    px = Math.max(1, px * (1 + r.float(-0.003, 0.003)))
    trades.push({ ms: t * 1000 + r.int(0, 19_000), p: Math.round(px * 100) / 100, s: r.int(1, 500) })
  }
  const agg = (b, uptoMs) => {
    const xs = trades.filter((x) => x.ms <= uptoMs && bucketStartUnix(Math.floor(x.ms / 1000), tf, {}) === b)
    if (!xs.length) return null
    let o = xs[0].p, h = o, l = o, c = o, v = 0
    for (const x of xs) { h = Math.max(h, x.p); l = Math.min(l, x.p); c = x.p; v += x.s }
    return { t: b, o, h, l, c, v }
  }
  /** The server's answer at Date.now(). */
  const answer = (sym, since) => {
    const nowMs = Date.now(), now = Math.floor(nowMs / 1000)
    const bars = []
    for (let b = OPEN; b <= now; b = bucketEndUnix(b, tf, {})) {
      if (since != null && b <= since) continue
      const a = agg(b, nowMs); if (a) bars.push(a)
    }
    let C = null
    for (const b of bars) { const e = bucketEndUnix(b.t, tf, {}); if (e <= now - SEAL_LAG) C = e }
    const last = bars.at(-1)
    return {
      bars, contract: 1, grid: 'eth-clock', session: 'rth', cache_key: `b1:${sym}:${tf}:eth-clock`,
      series_rev: nowMs * 4 + 2, history_rev: 7, verified_through: now - 2, complete_through: C,
      developing: last && bucketEndUnix(last.t, tf, {}) > now ? { ...last, rev: nowMs * 4 + 2 } : null,
      tail_status: 'verified',
    }
  }
  return { trades, agg, answer }
}

function makeStore(m, sym, tf, stream) {
  const calls = []
  const request = vi.fn(async (url) => {
    calls.push(url)
    const since = /since=(\d+)/.exec(url)
    return m.answer(sym, since ? Number(since[1]) : null)
  })
  const store = createBarStore({
    request, stream, candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  return { store, calls, request }
}

describe('BarStore end to end (mocked server + push stream)', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`seed ${seed}: invariants on every snapshot; sealed rows = truth; unsubscribe stops I/O; reload hydrates seals + asks a delta`, async () => {
      const tf = seed % 2 ? 5 : 1
      const sym = 'SIM'
      const key = keyOf({ sym, tf: String(tf) })
      const m = market(seed, tf)
      const stream = fakeStream()
      const { store, calls } = makeStore(m, sym, tf, stream)
      let prev = null, seen = 0
      const unsub = store.subscribe(key, (s) => {
        seen++
        check(Object.isFrozen(s) && Object.isFrozen(s.bars), 'S10 frozen')
        for (let i = 1; i < s.bars.length; i++) check(s.bars[i].t > s.bars[i - 1].t, 'S1')
        const last = s.bars.at(-1)
        if (s.developing && last) check(s.developing.t > last.t, 'S3')
        if (prev) {
          check(isLegalTransition(prev.status, s.status), () => `S10 ${prev.status} -> ${s.status}`)
          if (prev.completeThrough != null && s.gen === prev.gen) check(s.completeThrough >= prev.completeThrough, 'S2')
        }
        check(s.key === key, 'S7')
        prev = s
      })
      // 40 simulated minutes of trading: push frames as trades happen, finals after each bucket.
      const start = Date.now()
      const end = start + 40 * 60_000
      let ti = m.trades.findIndex((x) => x.ms > start)
      let lastBucket = null
      for (let t = start; t < end; t += 1000) {
        await vi.advanceTimersByTimeAsync(1000)
        const now = Date.now()
        while (m.trades[ti] && m.trades[ti].ms <= now) {
          const x = m.trades[ti++]
          const b = bucketStartUnix(Math.floor(x.ms / 1000), tf, {})
          if (lastBucket != null && b !== lastBucket) {
            const fin = m.agg(lastBucket, Infinity)
            if (fin) stream.emit(sym, String(tf), { sym, tf: String(tf), t_s: lastBucket, bar: { ...fin, t: lastBucket * 1000, final: true }, rev: x.ms * 4 + 3, final: true })
          }
          lastBucket = b
          const a = m.agg(b, x.ms)
          stream.emit(sym, String(tf), { sym, tf: String(tf), t_s: b, bar: { ...a, t: b * 1000, final: false, trade_ts: x.ms }, rev: x.ms * 4 + 1, final: false })
        }
      }
      const s = store.getSnapshot(key)
      expect(seen).toBeGreaterThan(10)
      expect(s.status).toBe('current')
      const sealed = s.bars.filter((b) => isSealedRow(s, b))
      expect(sealed.length).toBeGreaterThan(3)
      for (const b of sealed) {
        const tr = m.agg(b.t, Infinity)
        check(tr && b.o === tr.o && b.h === tr.h && b.l === tr.l && b.c === tr.c && b.v === tr.v, () => `sealed ${b.t} != truth`)
      }
      // poll budget: 40 min of a current tail ≈ 80 polls at 30 s (+ a burst)
      expect(calls.length).toBeLessThanOrEqual(40 * 2 + 6)
      // full reads only until the first answer that seals something (09:35 + 45 s seal lag)
      const firstDelta = calls.findIndex((u) => /since=/.test(u))
      expect(firstDelta).toBeGreaterThan(0)
      expect(firstDelta).toBeLessThanOrEqual(3)
      expect(calls.slice(firstDelta).every((u) => /since=/.test(u))).toBe(true)

      await store.flush()
      unsub()
      const n = calls.length
      await vi.advanceTimersByTimeAsync(3_600_000)
      expect(calls.length).toBe(n)
      expect(store.network.stats().keys).toBe(0)
      store.dispose()

      // "reload": empty mem cache, IDB holds the persisted rows + envelope
      memClear()
      const re = makeStore(m, sym, tf, fakeStream())
      re.request.mockImplementation((url) => { re.calls.push(url); return new Promise(() => {}) })   // keep it pending
      await re.store.persist.hydrate(key)
      const h = re.store.getSnapshot(key)
      expect(h.bars.filter((b) => isSealedRow(h, b)).length).toBeGreaterThan(0)
      expect(h.needsFull).toBe(false)
      re.store.subscribe(key, () => {})
      await vi.advanceTimersByTimeAsync(0)
      expect(re.calls[0]).toMatch(new RegExp(`since=${h.deltaFrom - 1}`))
      re.store.dispose()
    })
  }

  it('ensure() resolves once the key is usable and leaves no loop behind', async () => {
    const m = market(9, 5)
    const { store, calls } = makeStore(m, 'SIM', 5, fakeStream())
    const key = keyOf({ sym: 'SIM', tf: '5' })
    const s = await store.ensure(key)
    expect(['current', 'context']).toContain(s.status)
    expect(calls.length).toBe(1)
    await vi.advanceTimersByTimeAsync(600_000)
    expect(calls.length).toBe(1)
    await store.prefetch([keyOf({ sym: 'AAA', tf: '5' }), keyOf({ sym: 'BBB', tf: '5' })])
    expect(calls.length).toBe(3)
    store.dispose()
  })

  it('invalidate() resets the entry and refetches whole, aborting the request in flight', async () => {
    const m = market(10, 5)
    const { store, calls, request } = makeStore(m, 'SIM', 5, fakeStream())
    const key = keyOf({ sym: 'SIM', tf: '5' })
    store.subscribe(key, () => {})
    await vi.advanceTimersByTimeAsync(31_000)
    const n = calls.length
    let signal
    request.mockImplementationOnce((url, opts) => { signal = opts.signal; calls.push(url); return new Promise(() => {}) })
    await vi.advanceTimersByTimeAsync(31_000)
    store.invalidate(key, 'basis')
    expect(signal.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(10)
    expect(calls.length).toBe(n + 2)
    expect(calls.at(-1)).not.toMatch(/since=/)
    expect(store.getSnapshot(key).restSeen).toBe(true)
    store.dispose()
  })
})
