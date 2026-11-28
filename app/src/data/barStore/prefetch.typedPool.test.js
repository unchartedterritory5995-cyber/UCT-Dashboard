// ⭐⭐ (2026-11-28, zero-network plan 1.4) THE TYPED CANDIDATE POOL (prefetch warmTypedCandidates). On every keystroke the
// search reports the text's likeliest completions; each of the first TYPED_POOL_K is warmed from the edge (D/W/M: the
// deep sealed history beside a short tail; intraday: its page and lake depth), each under its own abort:
//   * the candidates' requests are all on the wire at once (no queue behind the typed slot);
//   * a list that drops a candidate aborts it; one it keeps is not asked again;
//   * the candidate that becomes the typed text keeps its fetch (the typed slot JOINS it: one tail, one history), and
//     moving the typed slot on to the next text does not abort a candidate the list still holds;
//   * a key held current and whole is not asked.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, OPEN, HISTORY_DAYS } from './testing/fakeBarsServer'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const NOW = (OPEN + 32 * 60 + 20) * 1000          // Tue 2026-11-10 10:02:20 ET: D d = Mon 11-09, W d = Fri 11-06, M d = 10-01
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => {
  fakeDb._clear()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  localStorage.setItem('barspack.version', 'test')   // the daily pack is held: uncached text used to read as a prefix
  localStorage.removeItem('uct.barsHistory.enabled')
  localStorage.setItem('uct.barsHistory.bucket', '5')
})
afterEach(() => {
  vi.useRealTimers()
  localStorage.removeItem('barspack.version'); localStorage.removeItem('uct.barsHistory.bucket'); localStorage.removeItem('uct.tickerUniverse')
})

const UNIVERSE = ['AAA', 'AAPL', 'AM', 'AMZN', 'COLD', 'CRBG', 'CRBN', 'CRM', 'CRWD', 'GOOG', 'GOOGL', 'NVDA', 'WKLY']

async function boot({ universe = UNIVERSE, lake = () => false } = {}) {
  vi.resetModules()
  const server = installFakeBarsServer()
  const tu = await import('../../lib/tickerUniverse')
  tu.__resetTickerUniverseForTests()
  if (universe) {
    await tu.ensureTickerUniverse({ fetchImpl: async () => ({ ok: true, json: async () => ({ v: 't1', symbols: universe }) }) })
  }
  const { createBarStore } = await import('./index')
  const { createPrefetch, DEEP_JOIN_WAIT_MS, TYPED_POOL_K } = await import('./prefetch')
  const { EDGE_TAIL_BARS } = await import('./network')
  const { keyOf } = await import('./types')
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  store.lakeHas = (sym) => Promise.resolve(lake(sym))
  const pf = createPrefetch({ store, tickerMeta: () => {} })
  return { server, store, pf, tu, k: (sym, tf) => keyOf({ sym, tf }), DEEP_JOIN_WAIT_MS, EDGE_TAIL_BARS, TYPED_POOL_K }
}
const settle = async (w) => { await w.server.flush(60); await vi.advanceTimersByTimeAsync(1); await w.server.flush(60) }
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10)
const hist = (w) => w.server.calls.filter((c) => c.q.history)
const what = (c) => (c.q.history ? `${c.q.sym} history ${c.q.tf} d=${c.q.d}` : `${c.q.sym} tail ${c.q.tf} bars=${c.q.bars}`)
const COVER = 2000   // a zoomed-out daily view (paintLog viewNeed): the chart's own cover

const of = (w, ...ss) => w.server.calls.filter((c) => ss.includes(c.q.sym))
const turns = async (w, n = 4) => { for (let i = 0; i < n; i++) await settle(w) }
const origin = (w) => w.server.calls.filter((c) => !c.q.history)

describe('the pool warms the likeliest completions at once, from the device and the edge, never the origin', () => {
  it('three cold D candidates: each its edge history, all on the wire at once; no /api/bars at all', async () => {
    const w = await boot()
    expect(w.TYPED_POOL_K).toBe(3)
    expect(w.pf.warmTypedCandidates(['CRM', 'CRWD', 'CRBG', 'CRBN'], 'D', { cover: COVER })).toBe(3)
    await turns(w)
    expect(w.server.open().map(what).sort()).toEqual(['CRBG history D d=2026-11-09', 'CRM history D d=2026-11-09', 'CRWD history D d=2026-11-09'])
    expect(of(w, 'CRBN')).toEqual([])                                  // the 4th is not warmed
    await w.server.drain()
    expect(origin(w)).toEqual([])                                      // ⛔ never the origin
  })

  it('the press on a pooled candidate asks only its short tail: the deep rows came from the edge before the key', async () => {
    const w = await boot()
    w.pf.warmTypedCandidates(['CRBG', 'CRBN'], 'D', { cover: COVER })
    await w.server.drain()
    const press = w.pf.prepareDailyForDisplay('CRBG', 'D', { cover: COVER })
    await w.server.drain()
    await press
    expect(of(w, 'CRBG').map(what).sort()).toEqual(['CRBG history D d=2026-11-09', `CRBG tail D bars=${w.EDGE_TAIL_BARS}`])
    expect(day(w.store.peek(w.k('CRBG', 'D')).bars[0].t)).toBe(HISTORY_DAYS[0])   // whole at the press
  })

  it("the next keystroke's list aborts the candidates it dropped and asks nothing again for the ones it kept", async () => {
    const w = await boot()
    w.pf.warmTypedCandidates(['CRM', 'CRWD', 'CRBG'], 'D', { cover: COVER })
    await turns(w)
    const before = w.server.calls.length
    w.pf.warmTypedCandidates(['CRBG', 'CRBN'], 'D', { cover: COVER })      // CR -> CRB
    await turns(w)
    expect(of(w, 'CRM', 'CRWD').length).toBe(2)
    expect(of(w, 'CRM', 'CRWD').every((c) => c.aborted)).toBe(true)
    expect(of(w, 'CRBG').length).toBe(1)                               // asked once: kept, not asked again
    expect(of(w, 'CRBG')[0].aborted).toBeFalsy()
    expect(w.server.calls.slice(before).map(what)).toEqual(['CRBN history D d=2026-11-09'])
    await w.server.drain()
    w.pf.warmTypedCandidates(['CRBG', 'CRBN'], 'D', { cover: COVER })      // the same list again (answered): nothing
    await turns(w)
    expect(of(w, 'CRBG', 'CRBN').length).toBe(2)
  })

  it('the candidate the member stops on becomes the typed text: the typed slot JOINS its history and sends one tail', async () => {
    const w = await boot()
    w.pf.warmTypedCandidates(['CRBG', 'CRBN'], 'D', { cover: COVER })
    await turns(w)
    w.pf.warmTypedCandidates(['CRBG'], 'D', { cover: COVER })
    const typed = w.pf.warmTypedSymbol('CRBG', 'D', { cover: COVER })
    await turns(w)
    await w.server.drain()
    await expect(typed).resolves.toBe('network')
    expect(of(w, 'CRBG').map(what).sort()).toEqual(['CRBG history D d=2026-11-09', `CRBG tail D bars=${w.EDGE_TAIL_BARS}`])
    expect(of(w, 'CRBG').every((c) => !c.aborted)).toBe(true)
    const n = w.server.calls.length
    await expect(w.pf.prepareDailyForDisplay('CRBG', 'D', { cover: COVER })).resolves.toBe('current')   // Enter sends nothing
    await w.server.flush(40)
    expect(w.server.calls.length).toBe(n)
  })

  it('the typed slot moving on does not abort the history of a candidate the list still holds (the pool goes first)', async () => {
    const w = await boot()
    w.pf.warmTypedCandidates(['CRBG', 'CRBN'], 'D', { cover: COVER })
    w.pf.warmTypedSymbol('CRBG', 'D', { cover: COVER })
    await turns(w)
    w.pf.warmTypedCandidates(['CRBN', 'CRBG'], 'D', { cover: COVER })     // the ranking flipped: CRBN on top
    w.pf.warmTypedSymbol('CRBN', 'D', { cover: COVER })                     // the typed slot aborts its CRBG warm
    await turns(w)
    const h = of(w, 'CRBG').filter((c) => c.q.history)
    expect(h.length).toBe(1)
    expect(h[0].aborted).toBeFalsy()
    await w.server.drain()
  })

  it('CONTROL: a candidate dropped by the list AND left by the typed slot is aborted', async () => {
    const w = await boot()
    w.pf.warmTypedCandidates(['CRBG', 'CRBN'], 'D', { cover: COVER })
    w.pf.warmTypedSymbol('CRBG', 'D', { cover: COVER })
    await turns(w)
    w.pf.warmTypedCandidates(['NVDA'], 'D', { cover: COVER })
    w.pf.warmTypedSymbol('NVDA', 'D', { cover: COVER })
    await turns(w)
    expect(of(w, 'CRBG', 'CRBN').length).toBe(3)                      // CRBG history + tail, CRBN history
    expect(of(w, 'CRBG', 'CRBN').every((c) => c.aborted)).toBe(true)
    await w.server.drain()
  })

  it('a key already held current and whole is not asked', async () => {
    const w = await boot()
    const press = w.pf.prepareDailyForDisplay('CRBG', 'D', { cover: COVER })
    await w.server.drain(); await press
    const n = w.server.calls.length
    expect(w.pf.warmTypedCandidates(['CRBG'], 'D', { cover: COVER })).toBe(0)
    await w.server.flush(40)
    expect(w.server.calls.length).toBe(n)
  })

  it('intraday: the lake is primed (the edge), the origin is never asked', async () => {
    const w = await boot()
    const primed = []
    w.store.primeLake = (k) => { primed.push(k) }
    w.pf.warmTypedCandidates(['CRM', 'CRWD'], '5')
    await turns(w)
    expect(primed.sort()).toEqual([w.k('CRM', '5'), w.k('CRWD', '5')])
    expect(origin(w)).toEqual([])
  })
})
