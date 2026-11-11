// P2c — data/barStore/prefetch.js: the prefetch facade over the BarStore.
//   • PARITY with utils/prefetchBars over the same mocked server: request count, priorities
//     (what runs under the pack-ingest hold, urgent first), dedupe, concurrency bound;
//   • S9: ≤1 request per key however many warmers / prepares / subscribers ask; 0 after
//     unsubscribe; a re-ask cooldown for a key the server already answered;
//   • the grid herd: N cells × 8 tfs share THE lane gate and never exceed _MAX_CONCURRENT;
//   • abort on a symbol switch: the prepare that is left cancels its request; a chart
//     subscribed to the same key keeps it;
//   • the useSymbolHandoff contract: peekDisplayable / prepareForDisplay outcomes.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, intradayRows, OPEN } from './testing/fakeBarsServer'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

/** The legacy queue's concurrency bound (utils/prefetchBars `_MAX_CONCURRENT`). */
const MAX_CONCURRENT = 2
const NOW = (OPEN + 32 * 60 + 20) * 1000          // Tue 10:02:20 ET, mid-session
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => {
  fakeDb._clear()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  localStorage.setItem('barspack.version', 'test')
})
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('barspack.version') })

/** A fresh module graph: legacy prefetchBars, the store and the facade share ONE lane. */
async function boot({ modeFor } = {}) {
  vi.resetModules()
  const server = installFakeBarsServer({ modeFor })
  const legacy = await import('../../utils/prefetchBars')
  const { createBarStore } = await import('./index')
  const { createPrefetch } = await import('./prefetch')
  const { keyOf } = await import('./types')
  const idb = await import('../../utils/barsIDB')
  const mem = await import('../../utils/barsMemCache')
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  const pf = createPrefetch({ store, tickerMeta: () => {} })
  const k = (sym, tf) => keyOf({ sym, tf })
  return { server, legacy, store, pf, k, idb, mem }
}
const tick = (ms) => vi.advanceTimersByTimeAsync(ms)
const symsOf = (calls) => calls.map((c) => c.q.sym)
const countBy = (calls) => calls.reduce((m, c) => { const x = `${c.q.sym}_${c.q.tf}`; m[x] = (m[x] || 0) + 1; return m }, {})

// ── parity ─────────────────────────────────────────────────────────────────
/** Run one scenario on the legacy warmer and on the facade; return comparable metrics. */
async function both(scenario) {
  const out = {}
  for (const side of ['legacy', 'facade']) {
    fakeDb._clear()
    vi.setSystemTime(NOW)
    const w = await boot()
    const api = side === 'legacy' ? w.legacy : w.pf
    out[side] = await scenario(api, w)
  }
  return out
}

describe('parity with utils/prefetchBars (same mocked server)', () => {
  it('a list warm: same request count, deduped on the second pass, never above the gate', async () => {
    const LIST = ['AA', 'BB', 'CC', 'DD', 'EE', 'FF']
    const r = await both(async (api, w) => {
      api.prefetchBars(LIST, '5')
      await w.server.drain({ advance: () => tick(1000) })
      const first = w.server.calls.length
      api.prefetchBars(LIST, '5')                      // re-select the same list
      await w.server.drain({ advance: () => tick(1000) })
      return { first, total: w.server.calls.length, syms: [...new Set(symsOf(w.server.calls))].sort(), maxLive: w.server.st.maxLive }
    })
    expect(r.facade).toEqual(r.legacy)
    expect(r.facade.first).toBe(LIST.length)
    expect(r.facade.total).toBe(LIST.length)
    expect(r.facade.maxLive).toBeLessThanOrEqual(MAX_CONCURRENT)
  })

  it('priorities: under the pack-ingest hold only the urgent rows go; the rest after the stamp', async () => {
    const r = await both(async (api, w) => {
      localStorage.removeItem('barspack.version')
      api.prefetchBars(['U1', 'U2', 'B1', 'B2'], '5', { urgent: true })
      await w.server.flush(60)
      for (let i = 0; i < 5; i++) { await tick(50); await w.server.flush() }
      const held = symsOf(w.server.calls).sort()
      for (const c of w.server.open()) c.respond()
      localStorage.setItem('barspack.version', 'test')
      await w.server.drain({ advance: () => tick(1200) })
      return { held, total: w.server.calls.length, all: [...new Set(symsOf(w.server.calls))].sort() }
    })
    expect(r.facade).toEqual(r.legacy)
    expect(r.facade.held).toEqual(['U1', 'U2'])
    expect(r.facade.total).toBe(4)
  })

  it('a durable warm skips a (sym, tf) the caches already hold current, and fetches the cold one', async () => {
    const now = Math.floor(NOW / 1000)
    const r = await both(async (api, w) => {
      await w.idb.idbPutMonotonic('WARM', '5', intradayRows(5, now - 300))
      api.prefetchBarsToIDB(['WARM', 'COLD'], '5')
      await w.server.drain({ advance: () => tick(1500) })
      return { syms: symsOf(w.server.calls), byKey: countBy(w.server.calls) }
    })
    expect(r.facade).toEqual(r.legacy)
    expect(r.facade.syms).toEqual(['COLD'])
  })
})

// ── S9 ─────────────────────────────────────────────────────────────────────
describe('S9 — at most one request per key; nothing after unsubscribe', () => {
  it('a subscriber, a prepare and three warmers of one key send ONE request', async () => {
    const w = await boot()
    const key = w.k('ONE', '5')
    const off = w.store.subscribe(key, () => {}, { priority: 'visible' })
    w.pf.prefetchBars(['ONE'], '5')
    w.pf.prefetchBarsToIDB(['ONE'], '5', { priority: true, immediate: true })
    w.pf.prefetchAllTimeframes('ONE')
    const prep = w.pf.prepareForDisplay('ONE', '5')
    w.pf.prefetch([key, key], { priority: 'grid' })
    await tick(0); await w.server.flush(80)
    expect(countBy(w.server.calls)['ONE_5']).toBe(1)
    await w.server.drain()
    await expect(prep).resolves.toBe('current')
    expect(countBy(w.server.calls)['ONE_5']).toBe(1)
    // Displayable now: another warm costs nothing.
    w.pf.prefetchBars(['ONE'], '5'); w.pf.prefetchBarOnIntent('ONE', '5')
    await tick(500); await w.server.flush(80)
    expect(countBy(w.server.calls)['ONE_5']).toBe(1)
    off()
    const before = w.server.calls.length
    await tick(30 * 60_000)
    expect(w.server.calls.length).toBe(before)            // 0 after unsubscribe
    expect(w.store.network.inflight()).toBe(0)
  })

  it('a key the server ANSWERED but that is not displayable (a halt) is re-asked at most once per cooldown', async () => {
    const w = await boot({ modeFor: () => 'behind' })
    const key = w.k('HALT', '5')
    w.pf.prefetch([key], { priority: 'grid' })
    await w.server.drain()
    expect(w.server.calls.length).toBe(1)
    for (let i = 0; i < 10; i++) { w.pf.prefetch([key], { priority: 'grid' }); w.pf.prefetchBars(['HALT'], '5') }
    await tick(1000); await w.server.drain()
    expect(w.server.calls.length).toBe(1)
    await tick(5 * 60_000 + 1000)                         // one 5m bucket later
    w.pf.prefetch([key], { priority: 'grid' })
    await w.server.drain()
    expect(w.server.calls.length).toBe(2)
  })

  it('a shed gives the slot back: re-asked once the lane backoff lifts — once, not per warm call', async () => {
    const w = await boot({ modeFor: () => (w.server.calls.length > 1 ? 'ok' : 'shed') })
    const key = w.k('SHED', '5')
    w.pf.prefetch([key], { priority: 'grid' })
    await w.server.drain()
    expect(w.server.calls.length).toBe(1)
    for (let i = 0; i < 10; i++) w.pf.prefetch([key], { priority: 'grid' })
    await w.server.flush(60)
    expect(w.server.calls.length).toBe(1)                 // held by the lane's 503 backoff
    await tick(4000); await w.server.drain()
    expect(w.server.calls.length).toBe(2)                 // ten warms, one request
    expect(w.pf.peekDisplayable('SHED', '5')).toBe(true)
  })

  it('an invalidate resets the cooldown (gen): the next warm asks again', async () => {
    const w = await boot({ modeFor: () => 'behind' })
    const key = w.k('INV', '5')
    w.pf.prefetch([key]); await w.server.drain()
    w.pf.prefetch([key]); await w.server.drain()
    expect(w.server.calls.length).toBe(1)
    w.store.invalidate(key, 'test')
    w.pf.prefetch([key]); await w.server.drain()
    expect(w.server.calls.length).toBe(2)
  })
})

// ── the grid herd ──────────────────────────────────────────────────────────
describe('grid herd — N cells share THE lane gate', () => {
  it('8 cells × 8 tfs: one request per key, never more than _MAX_CONCURRENT non-visible in flight, legacy warms included; visible still jumps', async () => {
    const w = await boot()
    const CELLS = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8']
    w.pf.prefetchGridWarm(CELLS)
    w.legacy.prefetchBars(['L1', 'L2', 'L3'], 'D')        // the legacy warm queue rides the same slots
    let maxNonVisible = 0, maxActive = 0, sawVisible = false
    for (let i = 0; i < 400; i++) {
      await tick(i === 0 ? 0 : 900); await w.server.flush(40)
      const open = w.server.open()
      const nonVisible = open.filter((c) => c.q.sym !== 'VIS').length
      maxNonVisible = Math.max(maxNonVisible, nonVisible)
      maxActive = Math.max(maxActive, w.legacy._laneStats().active)
      if (i === 3) {
        // The chart on screen is never queued behind the herd.
        const before = open.length
        w.legacy.barsLaneRequest('/api/bars/VIS?tf=5&bars=600', { priority: 'visible' }).catch(() => {})
        await w.server.flush(20)
        sawVisible = w.server.open().length === before + 1
      }
      if (!open.length && i > 5) break
      open[0]?.respond()
    }
    await w.server.drain({ advance: () => tick(1000) })
    expect(sawVisible).toBe(true)
    expect(maxNonVisible).toBeLessThanOrEqual(MAX_CONCURRENT)
    expect(maxActive).toBeLessThanOrEqual(MAX_CONCURRENT)
    const by = countBy(w.server.calls.filter((c) => c.q.sym.startsWith('G')))
    expect(Object.keys(by).length).toBe(CELLS.length * 8)
    expect(Math.max(...Object.values(by))).toBe(1)
    expect(symsOf(w.server.calls)).toEqual(expect.arrayContaining(['L1', 'L2', 'L3']))
  })
})

// ── abort on a symbol switch ───────────────────────────────────────────────
describe('abort on a symbol switch', () => {
  it("the handoff's warm + prepare of A send one request; leaving A aborts it; B goes; A never lands", async () => {
    const w = await boot()
    const a = new AbortController()
    // useSymbolHandoff's sequence: its own immediate warm, then the prepare.
    w.pf.prefetchBarsToIDB(['AAA'], '5', { priority: true, immediate: true })
    const pa = w.pf.prepareForDisplay('AAA', '5', { signal: a.signal })
    await tick(0); await w.server.flush(80)
    expect(symsOf(w.server.open())).toEqual(['AAA'])
    a.abort()                                             // the member moved to B
    await w.server.flush(40)
    expect(w.server.calls[0].aborted).toBe(true)
    expect(w.server.calls[0].opts.signal.aborted).toBe(true)
    await expect(pa).resolves.toBe('error')
    const pb = w.pf.prepareForDisplay('BBB', '5', { signal: new AbortController().signal })
    await w.server.drain()
    await expect(pb).resolves.toBe('current')
    expect(w.store.peek(w.k('AAA', '5'))?.restSeen ?? false).toBe(false)
    await tick(10 * 60_000)
    expect(symsOf(w.server.calls).filter((s) => s === 'AAA').length).toBe(1)
  })

  it('a chart subscribed to the same key keeps the request when the prepare is aborted', async () => {
    const w = await boot()
    const key = w.k('KEEP', '5')
    const a = new AbortController()
    const p = w.pf.prepareForDisplay('KEEP', '5', { signal: a.signal })
    await w.server.flush(60)
    const off = w.store.subscribe(key, () => {}, { priority: 'visible' })
    await tick(0); await w.server.flush(40)
    a.abort()
    await w.server.flush(40)
    expect(w.server.calls.length).toBe(1)
    expect(w.server.calls[0].aborted).toBeFalsy()
    w.server.calls[0].respond(); await w.server.flush(60)
    await expect(p).resolves.toBe('error')               // the prepare itself was cancelled
    expect(w.store.peek(key).restSeen).toBe(true)         // …but the chart got its answer
    off()
  })

  it('only the latest urgent prefetchBars call stays urgent: passed rows are dropped from the lane', async () => {
    const w = await boot()
    // Fill both slots so the urgent rows WAIT in the lane.
    w.legacy.barsLaneRequest('/api/bars/F1?tf=D&bars=1', { priority: 'urgent' }).catch(() => {})
    w.legacy.barsLaneRequest('/api/bars/F2?tf=D&bars=1', { priority: 'urgent' }).catch(() => {})
    await w.server.flush()
    w.pf.prefetchBars(['R1', 'R2'], '5', { urgent: true })
    await w.server.flush(80)
    w.pf.prefetchBars(['R3', 'R4'], '5', { urgent: true })    // ArrowDown ×2
    await w.server.flush(80)
    await w.server.drain()
    expect(symsOf(w.server.calls).filter((s) => s.startsWith('R')).sort()).toEqual(['R3', 'R4'])
  })
})

// ── the useSymbolHandoff contract ──────────────────────────────────────────
describe('handoff contract (peekDisplayable / prepareForDisplay / prepareDailyForDisplay)', () => {
  const now = Math.floor(NOW / 1000)

  it('peekDisplayable is synchronous: a current mem series yes, a stale one no; non-intraday always', async () => {
    const w = await boot()
    w.mem.memPut('CUR', '5', intradayRows(5, now - 300))
    w.mem.memPut('OLD', '5', intradayRows(5, OPEN + 600))
    expect(w.pf.peekDisplayable('CUR', '5')).toBe(true)
    expect(w.pf.peekDisplayable('OLD', '5')).toBe(false)
    expect(w.pf.peekDisplayable('ANY', 'D')).toBe(true)
    expect(w.pf.peekDisplayable('ANY', '45')).toBe(true)   // custom code: its base is not governed
    expect(w.pf.peekDisplayable('', '5')).toBe(false)
    expect(w.server.calls.length).toBe(0)
  })

  it("'current' from a current IDB copy with no request; 'current' after repairing a stale one", async () => {
    const w = await boot()
    await w.idb.idbPutMonotonic('IDB', '5', intradayRows(5, now - 300))
    await expect(w.pf.prepareForDisplay('IDB', '5')).resolves.toBe('current')
    expect(w.server.calls.length).toBe(0)
    await w.idb.idbPutMonotonic('STL', '5', intradayRows(5, OPEN + 600))
    const p = w.pf.prepareForDisplay('STL', '5')
    await w.server.drain()
    await expect(p).resolves.toBe('current')
    expect(w.server.calls.length).toBe(1)
  })

  it("'authoritative' when the server answered and has nothing newer (a halt)", async () => {
    const w = await boot({ modeFor: () => 'behind' })
    const p = w.pf.prepareForDisplay('HALT', '5')
    await w.server.drain()
    await expect(p).resolves.toBe('authoritative')
  })

  it("'nodata' for a symbol with no bars, 'error' for a failed request — never a success", async () => {
    const w = await boot({ modeFor: (q) => (q.sym === 'DEAD' ? 'nodata' : 'fail') })
    const d = w.pf.prepareForDisplay('DEAD', '5'); await w.server.drain()
    await expect(d).resolves.toBe('nodata')
    const e = w.pf.prepareForDisplay('BAD', '5'); await w.server.drain()
    await expect(e).resolves.toBe('error')
    await expect(w.pf.prepareForDisplay('', '5')).resolves.toBe('error')
  })

  it('daily: a held set is prepared with no request; an uncached one is fetched; an aborted one is an error', async () => {
    const w = await boot()
    await w.idb.idbPutMonotonic('DLY', 'D', [{ t: '2026-11-06', o: 1, h: 1, l: 1, c: 1, v: 1 }])
    await expect(w.pf.prepareDailyForDisplay('DLY', 'D')).resolves.toBe('current')
    expect(w.server.calls.length).toBe(0)
    const p = w.pf.prepareDailyForDisplay('NEWD', 'D'); await w.server.drain()
    await expect(p).resolves.toBe('current')
    const gone = new AbortController(); gone.abort()
    await expect(w.pf.prepareDailyForDisplay('GONE', 'D', { signal: gone.signal })).resolves.toBe('error')
    expect(symsOf(w.server.calls)).toEqual(['NEWD'])
  })

  it('a typed warm joined by the handoff is never aborted by the next keystroke', async () => {
    localStorage.removeItem('barspack.version')           // a new member: uncached text is warmed
    const w = await boot()
    const typed = w.pf.warmTypedSymbol('TYP', 'D')
    await w.server.flush(80)
    expect(symsOf(w.server.open())).toEqual(['TYP'])
    const enter = w.pf.prepareDailyForDisplay('TYP', 'D')   // Enter: the handoff joins it
    await w.server.flush(40)
    w.pf.warmTypedSymbol('TYPX', 'D')                      // a stray keystroke afterwards
    await w.server.flush(40)
    expect(w.server.calls[0].aborted).toBeFalsy()
    await w.server.drain()
    await expect(enter).resolves.toBe('current')
    await expect(typed).resolves.toBe('network')
    expect(countBy(w.server.calls)['TYP_D']).toBe(1)
  })
})
