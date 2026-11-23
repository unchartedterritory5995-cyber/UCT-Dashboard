// ⭐ THE TAIL MUST NOT GO QUIET IN A SUSTAINED SCAN (live session 2026-11-23, #2619 at 0f9b5e3769, store off, 1m + 15m,
// S&P 500, one press per 2.5 s, 80 presses). The neighbour hold's tail asks left once per press for ~45 s, then NONE for the
// remaining 158 s across three minute boundaries, and presses 39-79 almost all waited for their own 1m answer: each row's
// only earlier answer was the list warm's, 65 s old, from before a boundary.
// Why (read): the tail asked only a row that HELD A SERVER ANSWER in the registry (`restSeen`). The list warm answers a row
// about 65 s before the member reaches it; by then the registry has passed its limits (DEFAULT_MAX_KEYS 200 /
// DEFAULT_BAR_BUDGET: every press adds the row's six timeframes and the charts' deep loads) and evicted that idle entry. When
// the row enters the hold's window it is hydrated again from mem / IndexedDB: a LOCAL copy (`restSeen` false), one bucket
// behind, which the switch refuses (peekDisplayable: `_behindClock`), the tail skipped, and the urgent next-row warm took as
// painting (its legacy paint rule allows one pending bucket). Nobody asked; the press waited.
//   L1 a list of 120 rows, its warm 26 rows (65 s) ahead, one press per 2.5 s for 200 s across three minute boundaries, a
//      registry small enough to evict the warm's answers before the scan reaches them (as the live session's did): every
//      press from the 3rd finds its row asked since the last boundary or within the last 6 s, and the switch can show at
//      least 92% of them in the key task. One exemption, counted and capped at one per boundary: a press less than
//      TAIL_LAG_MIN_MS after a boundary whose row was asked in the bucket before it (it was current until the boundary;
//      nothing can have asked it since, and the server would not hold the closed bucket yet: that press asks for itself).
// Real store, real network, real facade, a fake clock in session, a server that answers within 100 ms.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, OPEN } from './testing/fakeBarsServer'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const at = (h, m, s = 0) => (OPEN + ((h * 60 + m) - (9 * 60 + 30)) * 60 + s) * 1000   // ET wall clock on Tue 2026-11-10
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => {
  fakeDb._clear()
  vi.useFakeTimers()
  localStorage.setItem('barspack.version', 'test')
})
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('barspack.version') })

async function boot({ maxKeys }) {
  vi.resetModules()
  const server = installFakeBarsServer({ modeFor: () => 'closed' })   // answers end at the last CLOSED minute
  const held = globalThis.fetch
  globalThis.fetch = (...a) => { const p = held(...a); server.calls[server.calls.length - 1].at = Date.now(); return p }
  const { createBarStore } = await import('./index')
  const { createRegistry } = await import('./registry')
  const P = await import('./prefetch')
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
    registry: createRegistry({ maxKeys, ctx: () => ({ nowMs: Date.now() }) }),
  })
  return { server, store, P, pf: P.createPrefetch({ store, tickerMeta: () => {}, extended: () => false, visible: () => true, random: () => 0.5 }) }
}
const tick = (ms) => vi.advanceTimersByTimeAsync(ms)
/** Let `ms` pass, the server answering every request within 100 ms. */
async function serve(w, ms) {
  for (let t = 0; t < ms; t += 100) {
    await tick(100)
    for (const c of w.server.open()) c.respond()
    await w.server.flush()
  }
}

describe('the tail stays on in a sustained scan', () => {
  it('L1 80 presses, one per 2.5 s, three minute boundaries, the list warm 65 s ahead: every row asked in time', async () => {
    vi.setSystemTime(at(10, 0, 5))
    const w = await boot({ maxKeys: 40 })
    const R = Array.from({ length: 120 }, (_, i) => `S${String(i).padStart(3, '0')}`)
    w.pf.prefetchBarsToIDB(R.slice(0, 26), '1', { priority: true })   // the list opens: its rows warmed
    await serve(w, 3_000)
    const hold = w.pf.createNeighborHold()
    hold.set(R.slice(0, 7), '1', { tail: [R[1], R[2]], selected: R[0] })
    let ctl = null
    const misses = []
    const waits = []
    const exempt = []
    for (let i = 1; i <= 80; i++) {
      const t = Date.now()
      if (i >= 3) {
        const lastBoundary = Math.floor(t / 60_000) * 60_000
        const asks = w.server.calls.filter((c) => c.q.sym === R[i] && c.q.tf === '1' && c.at <= t).map((c) => c.at)
        const last = asks.length ? Math.max(...asks) : -Infinity
        const justAfter = t - lastBoundary < w.P.TAIL_LAG_MIN_MS && last >= lastBoundary - 60_000
        if (!(last >= lastBoundary || t - last <= 6_000)) (justAfter ? exempt : misses).push(i)
        if (!w.pf.peekDisplayable(R[i], '1')) waits.push(i)
      }
      // the press, as the switch (useSymbolHandoff) and the watchlist (Watchlists.jsx sendWarm) make it
      ctl?.abort()
      ctl = new AbortController()
      w.pf.prepareForDisplay(R[i], '1', { signal: ctl.signal }).catch(() => {})
      const around = R.slice(Math.max(0, i - 6), i + 7)
      hold.set(around, '1', { tail: [R[i + 1], R[i + 2], R[i - 1]], selected: R[i] })
      w.pf.warmMemFromIDB(around, ['1'])
      w.pf.prefetchBarsToIDB([R[i + 26]], '1', { priority: true })   // the list's warm, 26 rows (65 s) ahead
      w.pf.prefetchBars([R[i + 1]], '1', { urgent: true })             // the next-row warm
      await serve(w, 2_500)
    }
    hold.clear()
    w.store.dispose()
    const seen = `misses [${misses.join(' ')}]; exempt (just after a boundary) [${exempt.join(' ')}]; not shown in the key task [${waits.join(' ')}]`
    expect(misses, seen).toEqual([])
    expect(exempt.length, seen).toBeLessThanOrEqual(3)
    expect(waits.length, seen).toBeLessThanOrEqual(6)
  })
})
