// The Trade Exchange News pool: one history load + one EventSource for every
// widget, seq-ordered, gap-replaying, epoch-safe, bounded, cleaned up on last leave.
// Synthetic headlines only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as pool from './tradeExchangeNewsStreamManager'

class FakeES {
  static all = []
  constructor(url, opts) {
    this.url = url
    this.opts = opts
    this.readyState = 1
    this.listeners = {}
    this.closed = false
    FakeES.all.push(this)
  }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn) }
  emit(name, data) { for (const fn of this.listeners[name] || []) fn({ data: JSON.stringify(data) }) }
  close() { this.closed = true; this.readyState = 2 }
}

const EPOCH = 'e1e1e1e1e1e1e1e1'
const H = (seq, extra = {}) => ({ type: 'headline', epoch: EPOCH, seq, id: `id${seq}`, source: 'TXNews1',
  content: `SYNTHETIC headline ${seq}`, received_at_ms: 1_800_000_000_000 + seq, tickers: [], repeat_count: 0,
  via: 'push', delayed: false, ...extra })

let recent
const fetchMock = vi.fn(async (url) => {
  const r = typeof recent === 'function' ? recent(url) : recent
  return { ok: r.status === 200, status: r.status, json: async () => r.body }
})

const flush = () => new Promise((r) => setTimeout(r, 0))
const lastES = () => FakeES.all[FakeES.all.length - 1]

beforeEach(() => {
  FakeES.all = []
  globalThis.EventSource = FakeES
  globalThis.fetch = fetchMock
  fetchMock.mockClear()
  recent = { status: 200, body: { epoch: EPOCH, first_seq: 1, last_seq: 3, items: [H(1), H(2), H(3)], coverage: { complete: true, gaps: [] }, tickers_provisional: true } }
  pool._resetForTests()
})
afterEach(() => { pool._resetForTests(); vi.useRealTimers() })

describe('tradeExchangeNewsStreamManager', () => {
  it('two widgets share ONE history load and ONE stream that resumes after the last seq', async () => {
    const a = vi.fn(); const b = vi.fn()
    const offA = pool.subscribe(a)
    const offB = pool.subscribe(b)
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(FakeES.all).toHaveLength(1)
    expect(lastES().url).toBe(`/api/trade-exchange-news/stream?after=3&epoch=${EPOCH}`)
    expect(lastES().opts).toEqual({ withCredentials: true })
    expect(pool.getSnapshot().items.map((i) => i.seq)).toEqual([1, 2, 3])
    offA(); offB()
  })

  it('appends live headlines in seq order and marks the stream live', async () => {
    const off = pool.subscribe(() => {})
    await flush()
    lastES().emit('hello', { epoch: EPOCH, reset: false, coverage: { complete: true, gaps: [] } })
    lastES().emit('headline', H(4))
    lastES().emit('headline', H(4))          // replay overlap: ignored
    const s = pool.getSnapshot()
    expect(s.status).toBe('live')
    expect(s.items.map((i) => i.seq)).toEqual([1, 2, 3, 4])
    expect(s.lastSeq).toBe(4)
    off()
  })

  it('a seq hole reopens the stream from the last seq instead of skipping', async () => {
    const off = pool.subscribe(() => {})
    await flush()
    const first = lastES()
    first.emit('headline', H(6))             // 4 and 5 missing
    expect(first.closed).toBe(true)
    expect(lastES().url).toContain('after=3')
    expect(pool.getSnapshot().items.map((i) => i.seq)).toEqual([1, 2, 3])
    off()
  })

  it('a different epoch discards the cursor and reloads history', async () => {
    const off = pool.subscribe(() => {})
    await flush()
    recent = { status: 200, body: { epoch: 'ffffffffffffffff', first_seq: 1, last_seq: 1, items: [{ ...H(1), epoch: 'ffffffffffffffff', content: 'SYNTHETIC new db' }] } }
    lastES().emit('hello', { epoch: 'ffffffffffffffff', reset: true })
    await flush()
    const s = pool.getSnapshot()
    expect(s.epoch).toBe('ffffffffffffffff')
    expect(s.items.map((i) => i.content)).toEqual(['SYNTHETIC new db'])
    off()
  })

  it('repeat events update the count without adding a row', async () => {
    const off = pool.subscribe(() => {})
    await flush()
    lastES().emit('repeat', { type: 'repeat', epoch: EPOCH, seq: 2, repeat_count: 1 })
    const s = pool.getSnapshot()
    expect(s.items).toHaveLength(3)
    expect(s.items.find((i) => i.seq === 2).repeat_count).toBe(1)
    off()
  })

  it('a non-admin (403) is a final, named refusal — no reconnect loop', async () => {
    recent = { status: 403, body: { detail: 'Admin access required' } }
    const off = pool.subscribe(() => {})
    await flush()
    expect(pool.getSnapshot()).toMatchObject({ status: 'unavailable', reason: 'admin_only' })
    expect(FakeES.all).toHaveLength(0)
    off()
  })

  it('a dropped stream reconnects with backoff and resumes from its cursor', async () => {
    vi.useFakeTimers()
    const off = pool.subscribe(() => {})
    await vi.runAllTicks(); await Promise.resolve(); await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
    const es = lastES()
    es.emit('hello', { epoch: EPOCH })
    es.readyState = 2
    es.onerror()
    expect(pool.getSnapshot().status).toBe('dropped')
    await vi.advanceTimersByTimeAsync(1100)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(lastES()).not.toBe(es)
    expect(lastES().url).toContain('after=3')
    off()
  })

  it('a silent stream (no heartbeat for 22 s) stops claiming Live and reconnects', async () => {
    vi.useFakeTimers()
    const off = pool.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(0)
    const es = lastES()
    es.emit('hello', { epoch: EPOCH })
    expect(pool.getSnapshot().status).toBe('live')
    await vi.advanceTimersByTimeAsync(21000)
    es.emit('heartbeat', {})                       // a heartbeat re-arms the watchdog
    await vi.advanceTimersByTimeAsync(21000)
    expect(pool.getSnapshot().status).toBe('live')
    await vi.advanceTimersByTimeAsync(1500)         // 22 s of silence
    expect(pool.getSnapshot().status).toBe('reconnecting')
    expect(es.closed).toBe(true)
    await vi.advanceTimersByTimeAsync(1100)
    expect(lastES()).not.toBe(es)
    expect(lastES().url).toContain('after=3')
    off()
  })

  it('the last unsubscribe closes the stream and forgets everything', async () => {
    const off1 = pool.subscribe(() => {})
    const off2 = pool.subscribe(() => {})
    await flush()
    const es = lastES()
    off1()
    expect(es.closed).toBe(false)
    off2()
    expect(es.closed).toBe(true)
    expect(pool.getSnapshot().items).toEqual([])
  })

  it('announces each headline once across every widget, never the history it loaded', async () => {
    const off = pool.subscribe(() => {})
    await flush()
    expect(pool.claimAnnouncement(2)).toBe(false)          // loaded history
    lastES().emit('headline', H(4))
    expect(pool.claimAnnouncement(4)).toBe(true)           // first widget
    expect(pool.claimAnnouncement(4)).toBe(false)          // second widget
    off()
  })

  it('history is bounded and "load older" prepends without dropping the newest rows', async () => {
    const many = Array.from({ length: pool.PAGE }, (_, i) => H(1001 + i))
    recent = (url) => (url.includes('before=')
      ? { status: 200, body: { epoch: EPOCH, first_seq: 1, last_seq: 1200, items: Array.from({ length: pool.PAGE }, (_, i) => H(801 + i)) } }
      : { status: 200, body: { epoch: EPOCH, first_seq: 1, last_seq: 1200, items: many } })
    const off = pool.subscribe(() => {})
    await flush()
    expect(pool.getSnapshot().hasOlder).toBe(true)
    await pool.loadOlder()
    const seqs = pool.getSnapshot().items.map((i) => i.seq)
    expect(seqs[0]).toBe(801)
    expect(seqs[seqs.length - 1]).toBe(1200)               // newest kept
    expect(fetchMock.mock.calls.at(-1)[0]).toBe('/api/trade-exchange-news/recent?limit=200&before=1001')
    off()
  })

  it('mergeItems keeps seq order and caps from the oldest end', () => {
    const items = Array.from({ length: pool.MAX_ITEMS }, (_, i) => H(i + 1))
    const out = pool.mergeItems(items, [H(pool.MAX_ITEMS + 1)])
    expect(out).toHaveLength(pool.MAX_ITEMS)
    expect(out[0].seq).toBe(2)
    expect(out.at(-1).seq).toBe(pool.MAX_ITEMS + 1)
  })
})
