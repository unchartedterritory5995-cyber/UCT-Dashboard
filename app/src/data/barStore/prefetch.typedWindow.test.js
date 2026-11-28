// (review of #2947, speed follow-up) A typed ticker on a chart the date box sent to a past date warms the WINDOW that
// chart will read (its `to=` at the member's date), never the plain key's newest rows (another set of bars).
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, OPEN } from './testing/fakeBarsServer'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { fakeDb._clear(); vi.useFakeTimers(); vi.setSystemTime((OPEN + 1800) * 1000); localStorage.setItem('barspack.version', 'test') })
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('barspack.version') })

async function boot() {
  vi.resetModules()
  const server = installFakeBarsServer()
  const { createBarStore } = await import('./index')
  const { createPrefetch } = await import('./prefetch')
  const { viewWindowOfDate } = await import('../../components/chart/viewWindow')
  const store = createBarStore({ stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
    history: { olderBars: async () => ({ bars: [] }), prime: vi.fn(), hasSymbol: async () => true, windowBars: async () => null } })
  return { server, store, pf: createPrefetch({ store, tickerMeta: () => {} }), viewWindowOfDate }
}

describe('warmTypedSymbol with a viewWindow', () => {
  it('asks the window at the date for the typed tf and its linked intraday tfs, and no plain intraday key', async () => {
    const w = await boot()
    const vw = w.viewWindowOfDate('2025-03-14', '5')
    w.pf.warmTypedSymbol('REAL', '5', { alsoTfs: ['15', 'D'], viewWindow: vw })
    await vi.advanceTimersByTimeAsync(200)
    await w.server.drain({ advance: () => vi.advanceTimersByTimeAsync(200) })
    const intraday = w.server.calls.filter((c) => c.q.sym === 'REAL' && ['5', '15'].includes(c.q.tf))
    expect(intraday.length, 'non-vacuity: the window was asked').toBeGreaterThan(0)
    expect(intraday.every((c) => c.q.to === '2025-03-14'), intraday.map((c) => c.url).join('\n')).toBe(true)
    expect(intraday.some((c) => c.q.tf === '5')).toBe(true)
    expect(intraday.some((c) => c.q.tf === '15'), 'the linked 15m window too').toBe(true)
  })
  // (review of #3004, LOW) the window is keyed on the PANE's session: its ETH can differ from the global
  it('the pane on extended hours: the window and the linked window ask session=eth; on regular hours, rth', async () => {
    for (const [ext, want] of [[true, 'eth'], [false, 'rth']]) {
      const w = await boot()
      w.pf.warmTypedSymbol('REAL', '5', { alsoTfs: ['15'], viewWindow: w.viewWindowOfDate('2025-03-14', '5'), showExtended: ext })
      await vi.advanceTimersByTimeAsync(200)
      await w.server.drain({ advance: () => vi.advanceTimersByTimeAsync(200) })
      const intraday = w.server.calls.filter((c) => c.q.sym === 'REAL' && ['5', '15'].includes(c.q.tf))
      expect(intraday.length, `non-vacuity (${want})`).toBeGreaterThan(1)
      for (const c of intraday) expect(c.url, `${want}: ${c.url}`).toMatch(new RegExp(`[?&]session=${want}(?:&|$)`))
    }
  })
  it('a partial word nobody knows asks nothing', async () => {
    const w = await boot()
    w.store.lakeHas = async () => false
    w.pf.warmTypedSymbol('ZZQX', '5', { viewWindow: w.viewWindowOfDate('2025-03-14', '5') })
    await vi.advanceTimersByTimeAsync(500)
    await w.server.drain()
    expect(w.server.calls.filter((c) => c.q.sym === 'ZZQX' && c.q.tf === '5')).toEqual([])
  })
  it('without a viewWindow it warms the plain key, as before', async () => {
    const w = await boot()
    w.pf.warmTypedSymbol('REAL', '5', {})
    await vi.advanceTimersByTimeAsync(200)
    await w.server.drain({ advance: () => vi.advanceTimersByTimeAsync(200) })
    const intraday = w.server.calls.filter((c) => c.q.sym === 'REAL' && c.q.tf === '5')
    expect(intraday.length).toBeGreaterThan(0)
    expect(intraday.every((c) => c.q.to == null)).toBe(true)
  })
})
