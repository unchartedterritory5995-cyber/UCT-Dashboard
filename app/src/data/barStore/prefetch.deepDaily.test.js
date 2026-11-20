// ⭐ ONE PAINT, THE WHOLE DAILY CHART (2026-11-19). The owner: "about 200 bars instantly and then the
// rest shortly after, definitely in 2 phases. I want that all to load perfectly and instantly." A held
// shallow daily set (the pack's rows) used to paint at once and its deep sealed history was asked only
// after the tail answer, because the URL's `d` was read from those answered bars. Now:
//   • Enter on a shallow set sends the deep history BESIDE the tail (calendar `d`), both on the wire
//     before either answers; the history job takes that answer (one request), and the prepare resolves
//     only once it joined: the first frame is the whole chart;
//   • the wait is bounded (DEEP_JOIN_WAIT_MS): a history that never answers commits on the tail;
//   • a typed ticker gets its deep history joined before Enter, so Enter sends nothing;
//   • a saved copy that is already deep (joined on an earlier visit) is not due: nothing is fetched.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, OPEN, HISTORY_DAYS } from './testing/fakeBarsServer'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const NOW = (OPEN + 32 * 60 + 20) * 1000          // Tue 2026-11-10 10:02:20 ET: the calendar's d is Mon 11-09
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => {
  fakeDb._clear()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  localStorage.setItem('barspack.version', 'test')
  localStorage.removeItem('uct.barsHistory.enabled')
  localStorage.setItem('uct.barsHistory.bucket', '5')   // inside the split's rollout
})
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('barspack.version'); localStorage.removeItem('uct.barsHistory.bucket') })

async function boot() {
  vi.resetModules()
  const server = installFakeBarsServer()
  const { createBarStore } = await import('./index')
  const { createPrefetch, DEEP_JOIN_WAIT_MS } = await import('./prefetch')
  const { keyOf } = await import('./types')
  const idb = await import('../../utils/barsIDB')
  const { FIRST_PAINT_BARS } = await import('../../utils/barsBackfill')
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  const pf = createPrefetch({ store, tickerMeta: () => {} })
  return { server, store, pf, idb, k: (sym, tf) => keyOf({ sym, tf }), DEEP_JOIN_WAIT_MS, FIRST_PAINT_BARS }
}
const tick = (ms) => vi.advanceTimersByTimeAsync(ms)
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10)
const row = (t, c = 10.5) => ({ t, o: 10, h: 11, l: 9, c, v: 100 })
const hist = (w) => w.server.calls.filter((c) => c.q.history)
const what = (c) => (c.q.history ? `history d=${c.q.d}` : `tail bars=${c.q.bars}`)

describe('the daily handoff paints the whole chart once (deep history joined before the commit)', () => {
  it('Enter on a held shallow set: the deep history leaves BESIDE the tail, joins once, and the prepare resolves on the whole chart', async () => {
    const w = await boot()
    await w.idb.idbPutMonotonic('DPS', 'D', [row('2026-11-06'), row('2026-11-09')])
    const p = w.pf.prepareDailyForDisplay('DPS', 'D')
    let settled = false
    p.then(() => { settled = true })
    await tick(130)                                         // past the cache-read race
    await w.server.flush(40)
    // both on the wire before either answers, neither a shed-able warm
    expect(w.server.open().map(what).sort()).toEqual(['history d=2026-11-09', `tail bars=${w.FIRST_PAINT_BARS}`])
    expect(w.server.open().every((c) => !c.q.warm)).toBe(true)
    // the tail alone does not commit: the prepare waits for the join
    for (const c of w.server.open()) if (!c.q.history) c.respond()
    await w.server.flush(40)
    expect(settled).toBe(false)
    await w.server.drain()
    await expect(p).resolves.toBe('current')
    const s = w.store.peek(w.k('DPS', 'D'))
    expect(day(s.bars[0].t)).toBe(HISTORY_DAYS[0])          // the deep rows are in the first frame
    expect(hist(w).length).toBe(1)                           // the history job took the primed answer
    expect(w.pf.deepPending('DPS', 'D')).toBe(false)
    // a second Enter sends nothing
    const n = w.server.calls.length
    await expect(w.pf.prepareDailyForDisplay('DPS', 'D')).resolves.toBe('current')
    await w.server.flush(40)
    expect(w.server.calls.length).toBe(n)
  })

  it('the wait is bounded: a history that never answers commits on the tail at DEEP_JOIN_WAIT_MS', async () => {
    const w = await boot()
    await w.idb.idbPutMonotonic('HNG', 'D', [row('2026-11-06'), row('2026-11-09')])
    const p = w.pf.prepareDailyForDisplay('HNG', 'D')
    let settled = false
    p.then(() => { settled = true })
    await tick(130)
    await w.server.flush(40)
    for (const c of w.server.open()) if (!c.q.history) c.respond()   // the edge never answers
    await w.server.flush(40)
    expect(settled).toBe(false)
    await tick(w.DEEP_JOIN_WAIT_MS)
    expect(settled).toBe(true)
    await expect(p).resolves.toBe('current')
    expect(day(w.store.peek(w.k('HNG', 'D')).bars[0].t)).toBe('2026-11-06')   // the tail's rows, no gap
  })

  it('a typed ticker gets its deep history joined before Enter; Enter then sends nothing', async () => {
    const w = await boot()
    await w.idb.idbPutMonotonic('TDP', 'D', [row('2026-11-06'), row('2026-11-09')])
    const typed = w.pf.warmTypedSymbol('TDP', 'D')
    await w.server.drain()
    await expect(typed).resolves.toBe('network')
    expect(hist(w).map((c) => c.q.d)).toEqual(['2026-11-09'])
    expect(w.pf.deepPending('TDP', 'D')).toBe(false)
    expect(day(w.store.peek(w.k('TDP', 'D')).bars[0].t)).toBe(HISTORY_DAYS[0])
    const n = w.server.calls.length
    await expect(w.pf.prepareDailyForDisplay('TDP', 'D')).resolves.toBe('current')
    await w.server.flush(40)
    expect(w.server.calls.length).toBe(n)
  })

  it('a prefix is not a ticker: typed text with no held set fetches no deep history', async () => {
    const w = await boot()
    await expect(w.pf.warmTypedSymbol('ZZQ', 'D')).resolves.toBe('unknown')
    await w.server.flush(40)
    expect(w.server.calls).toEqual([])
  })

  it('a saved copy already deep (its history joined on an earlier visit) is not due: no request', async () => {
    const w = await boot()
    const rows = []
    const d = new Date('2026-11-09T00:00:00Z')
    while (rows.length < w.FIRST_PAINT_BARS + 50) {
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) rows.unshift(row(d.toISOString().slice(0, 10)))
      d.setUTCDate(d.getUTCDate() - 1)
    }
    await w.idb.idbPutMonotonic('DEEP', 'D', rows)
    await expect(w.pf.prepareDailyForDisplay('DEEP', 'D')).resolves.toBe('current')
    await w.server.flush(40)
    expect(w.server.calls).toEqual([])
    expect(w.pf.deepPending('DEEP', 'D')).toBe(false)
  })

  it('the split off: nothing deep is ever due', async () => {
    localStorage.setItem('uct.barsHistory.enabled', '0')
    try {
      const w = await boot()
      await w.idb.idbPutMonotonic('OFF', 'D', [row('2026-11-06'), row('2026-11-09')])
      expect(w.pf.deepPending('OFF', 'D')).toBe(false)
      await expect(w.pf.prepareDailyForDisplay('OFF', 'D')).resolves.toBe('current')
      expect(hist(w)).toEqual([])
    } finally { localStorage.removeItem('uct.barsHistory.enabled') }
  })
})

// ⭐ THE NEXT DAILY ROWS ARRIVE WHOLE (2026-11-19, owner: "only some load instantly, then some take time.
// Some load 400 candles or so and then load the rest a second later"). The neighbor hold deepened the
// next rows on intraday only; a daily flip onto a row not opened before waited for its deep history at
// the flip (production: first frame median 112 ms, a stalled tail painted 600 bars then 11,766). Now the
// hold joins the next rows' deep history once the selection rests, so the flip sends nothing.
describe('the neighbor hold joins the next daily rows\' deep history before the member gets there', () => {
  async function holdBoot() {
    const w = await boot()
    const { DATE_NEIGHBOR_DEEP_MS } = await import('./prefetch')
    return { ...w, DATE_NEIGHBOR_DEEP_MS }
  }

  it('after the rest, the next row is joined whole; its flip then sends NOTHING and paints the deep rows', async () => {
    const w = await holdBoot()
    for (const s of ['CUR', 'NXT']) await w.idb.idbPutMonotonic(s, 'D', [row('2026-11-06'), row('2026-11-09')])
    const hold = w.pf.createNeighborHold()
    hold.set(['CUR', 'NXT'], 'D', { deep: ['NXT'] })
    await w.server.flush(40)
    expect(hist(w)).toEqual([])                                   // nothing before the rest
    await tick(w.DATE_NEIGHBOR_DEEP_MS)
    await w.server.drain()
    expect(hist(w).map((c) => [c.q.sym, c.q.d])).toEqual([['NXT', '2026-11-09']])
    expect(w.pf.deepPending('NXT', 'D')).toBe(false)
    expect(day(w.store.peek(w.k('NXT', 'D')).bars[0].t)).toBe(HISTORY_DAYS[0])
    // the flip: the daily prepare finds it whole and asks nothing
    const n = w.server.calls.length
    await expect(w.pf.prepareDailyForDisplay('NXT', 'D')).resolves.toBe('current')
    await w.server.flush(40)
    expect(w.server.calls.length).toBe(n)
    hold.clear()
  })

  it('a selection that moves before the rest asks no deep history for the row it left', async () => {
    const w = await holdBoot()
    for (const s of ['AAA', 'BBB', 'CCC']) await w.idb.idbPutMonotonic(s, 'D', [row('2026-11-06'), row('2026-11-09')])
    const hold = w.pf.createNeighborHold()
    hold.set(['AAA', 'BBB'], 'D', { deep: ['BBB'] })
    await tick(w.DATE_NEIGHBOR_DEEP_MS - 20)
    hold.set(['BBB', 'CCC'], 'D', { deep: ['CCC'] })             // a held key: it moved on
    await tick(w.DATE_NEIGHBOR_DEEP_MS)
    await w.server.drain()
    expect(hist(w).map((c) => c.q.sym)).toEqual(['CCC'])
    hold.clear()
  })

  it('a selection that moves WHILE a row is joining asks nothing for the rows after it', async () => {
    const w = await holdBoot()
    for (const s of ['AAA', 'B1', 'B2', 'ZZZ']) await w.idb.idbPutMonotonic(s, 'D', [row('2026-11-06'), row('2026-11-09')])
    const hold = w.pf.createNeighborHold()
    hold.set(['AAA', 'B1', 'B2'], 'D', { deep: ['B1', 'B2'] })
    await tick(w.DATE_NEIGHBOR_DEEP_MS)
    await w.server.flush(40)
    expect(hist(w).map((c) => c.q.sym)).toEqual(['B1'])          // one row at a time
    hold.set(['ZZZ'], 'D', {})                                    // the member moved on, B1 still in flight
    await w.server.drain()
    await tick(w.DATE_NEIGHBOR_DEEP_MS)
    await w.server.drain()
    expect(hist(w).map((c) => c.q.sym)).toEqual(['B1'])          // B2 was never asked
    hold.clear()
  })

  it('a selection that moves while a row waits for its history asks nothing for the rows after it', async () => {
    const w = await holdBoot()
    for (const s of ['AAA', 'C1', 'C2', 'ZZZ']) await w.idb.idbPutMonotonic(s, 'D', [row('2026-11-06'), row('2026-11-09')])
    const hold = w.pf.createNeighborHold()
    hold.set(['AAA', 'C1', 'C2'], 'D', { deep: ['C1', 'C2'] })
    await tick(w.DATE_NEIGHBOR_DEEP_MS)
    await w.server.flush(40)
    for (const c of w.server.open()) if (!c.q.history) c.respond()   // C1's tail lands, its history is still out
    await w.server.flush(40)
    hold.set(['ZZZ'], 'D', {})                                    // the member moved on
    await w.server.drain()
    await tick(w.DATE_NEIGHBOR_DEEP_MS)
    await w.server.drain()
    expect(hist(w).map((c) => c.q.sym)).toEqual(['C1'])          // C2 was never asked
    hold.clear()
  })

  it('a row already whole (joined here, or saved whole) asks nothing', async () => {
    const w = await holdBoot()
    const rows = []
    const d = new Date('2026-11-09T00:00:00Z')
    while (rows.length < w.FIRST_PAINT_BARS + 50) {
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) rows.unshift(row(d.toISOString().slice(0, 10)))
      d.setUTCDate(d.getUTCDate() - 1)
    }
    await w.idb.idbPutMonotonic('WHL', 'D', rows)
    const hold = w.pf.createNeighborHold()
    hold.set(['WHL'], 'D', { deep: ['WHL'] })
    await tick(w.DATE_NEIGHBOR_DEEP_MS)
    await w.server.drain()
    expect(w.server.calls).toEqual([])
    hold.clear()
  })

  it('switched off (uct.deepNeighbors = 0), nothing is asked', async () => {
    localStorage.setItem('uct.deepNeighbors', '0')
    try {
      const w = await holdBoot()
      await w.idb.idbPutMonotonic('OFF', 'D', [row('2026-11-06'), row('2026-11-09')])
      const hold = w.pf.createNeighborHold()
      hold.set(['OFF'], 'D', { deep: ['OFF'] })
      await tick(w.DATE_NEIGHBOR_DEEP_MS)
      await w.server.drain()
      expect(hist(w)).toEqual([])
      hold.clear()
    } finally { localStorage.removeItem('uct.deepNeighbors') }
  })
})

describe('a daily row the pointer rests on gets its deep history joined before the click', () => {
  it('after the intent delay the deep history is joined; the click then sends nothing', async () => {
    const w = await boot()
    await w.idb.idbPutMonotonic('HOV', 'D', [row('2026-11-06'), row('2026-11-09')])
    w.pf.prefetchBarOnIntent('HOV', 'D', { delay: 120 })
    await w.server.flush(40)
    expect(hist(w)).toEqual([])                                   // nothing while the pointer is passing
    await tick(120)
    await w.server.drain()
    expect(hist(w).map((c) => [c.q.sym, c.q.d])).toEqual([['HOV', '2026-11-09']])
    expect(w.pf.deepPending('HOV', 'D')).toBe(false)
    const n = w.server.calls.length
    await expect(w.pf.prepareDailyForDisplay('HOV', 'D')).resolves.toBe('current')
    await w.server.flush(40)
    expect(w.server.calls.length).toBe(n)
  })

  it('a row saved whole in this browser asks nothing on intent (read before deciding)', async () => {
    const w = await boot()
    const rows = []
    const d = new Date('2026-11-09T00:00:00Z')
    while (rows.length < w.FIRST_PAINT_BARS + 50) {
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) rows.unshift(row(d.toISOString().slice(0, 10)))
      d.setUTCDate(d.getUTCDate() - 1)
    }
    await w.idb.idbPutMonotonic('SVD', 'D', rows)
    w.pf.prefetchBarOnIntent('SVD', 'D', { delay: 120 })
    await tick(120)
    await w.server.drain()
    expect(hist(w)).toEqual([])
  })
})
