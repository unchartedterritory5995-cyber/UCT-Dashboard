// ⛔ (2026-11-28, cloud COV-date-D-typed on production d3300366a4: 5 of 6 cold typed D switches showed 30 rows and
// committed at the 4 s hang guard) THE TYPED D TICKER'S COVER. The typed warm asks the tail cut to EDGE_TAIL_BARS (the
// deep history is due); its cover fallback fires while the member is still typing, with nothing holding the key. The
// Enter prepare that follows (prepareDailyForDisplay) must still get the cover page while the edge history is slow, so
// the hang guard never commits a 30-row cut as the chart.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, OPEN } from './testing/fakeBarsServer'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))
// the typed text is a real ticker (the search's universe vouches for it)
vi.mock('../../lib/tickerUniverse', async (orig) => ({ ...(await orig()), isKnownTicker: () => true }))

let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => {
  fakeDb._clear(); vi.useFakeTimers(); vi.setSystemTime((OPEN + 1800) * 1000)
  localStorage.setItem('barspack.version', 'test')
  localStorage.removeItem('uct.barsHistory.enabled'); localStorage.setItem('uct.barsHistory.bucket', '5')
})
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('barspack.version'); localStorage.removeItem('uct.barsHistory.bucket') })

async function boot() {
  vi.resetModules()
  const server = installFakeBarsServer()
  const { createBarStore } = await import('./index')
  const { createPrefetch } = await import('./prefetch')
  const net = await import('./network')
  const store = createBarStore({ stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(), history: null })
  return { server, store, pf: createPrefetch({ store, tickerMeta: () => {} }), net }
}
// answer every request but the deep history (a cold edge: still building it), advancing the clock by `ms`
async function runFor(w, ms) {
  for (let t = 0; t < ms; t += 50) {
    for (const c of w.server.open()) if (!c.q.history) c.respond()
    await vi.advanceTimersByTimeAsync(50)
  }
}
const tails = (w, sym) => w.server.calls.filter((c) => c.q.sym === sym && c.q.tf === 'D' && !c.q.history).map((c) => c.q.bars)

describe('a typed cold D ticker while the edge history is slow', () => {
  it('the warm cuts to EDGE_TAIL_BARS; the Enter prepare after the warm\'s unheld fallback still gets the cover page', async () => {
    const w = await boot()
    const { EDGE_TAIL_BARS, EDGE_FALLBACK_MS } = w.net
    const { dateCoverMaxFor } = await import('../../utils/barsBackfill')
    w.pf.warmTypedSymbol('EVMN', 'D', { cover: 1400 })
    await runFor(w, EDGE_FALLBACK_MS + 200)                       // the member still typing: nothing holds the key
    expect(tails(w, 'EVMN'), `non-vacuity: the typed warm cut the tail (calls: ${JSON.stringify(w.server.calls.map((c) => c.url))})`).toContain(EDGE_TAIL_BARS)
    const ac = new AbortController()
    w.pf.prepareDailyForDisplay('EVMN', 'D', { cover: 1400, signal: ac.signal }).catch(() => {})   // Enter
    await runFor(w, EDGE_FALLBACK_MS + 200)
    const asked = tails(w, 'EVMN')
    ac.abort()
    expect(asked, `the cover page went out for the display that waits (tails asked: ${JSON.stringify(asked)}; history: ${w.server.calls.filter((c) => c.q.history).length})`).toContain(dateCoverMaxFor('D'))
  }, 20_000)

  // ⛔⛔ (review of #3034, HIGH) THE PRODUCTION ENTER PATH: typed, a pause, Enter. prepareForDisplay pins the key and never
  // asks deepPrime(want); the warm's look ran long before with nothing holding the key. The pin itself arms the cover.
  for (const pauseMs of [800, 7500]) {
    it(`typed, a ${pauseMs} ms pause, Enter (prepareForDisplay, pin only): the cover page goes out while the edge history hangs`, async () => {
      const w = await boot()
      const { EDGE_TAIL_BARS, EDGE_HOLD_LOOK_MS } = w.net
      const { dateCoverMaxFor } = await import('../../utils/barsBackfill')
      w.pf.warmTypedSymbol('EVMN', 'D', { cover: 1400 })
      await runFor(w, pauseMs)
      const before = tails(w, 'EVMN')
      expect(before, 'non-vacuity: the typed warm cut the tail').toContain(EDGE_TAIL_BARS)
      expect(before, 'non-vacuity: no cover while nothing held it').not.toContain(dateCoverMaxFor('D'))
      const ac = new AbortController()
      w.pf.prepareForDisplay('EVMN', 'D', { signal: ac.signal }).catch(() => {})   // Enter
      await runFor(w, (EDGE_HOLD_LOOK_MS ?? 150) + 250)   // (?? : the rail runs red on the head before the fix too)
      const asked = tails(w, 'EVMN')
      ac.abort()
      expect(asked, `the cover page for the display (tails asked: ${JSON.stringify(asked)})`).toContain(dateCoverMaxFor('D'))
    }, 30_000)
  }
})
