// Companion warmers through the BarStore facade (2026-11-12).
//
// utils/prefetchBars tells every registered warmer which symbols a bars warm is about to cover
// (the server-computed indicator columns ride that list: engine/serverWarm.js). The facade is
// the drop-in for that module, so behind the BARSTORE switch the SAME calls must make the SAME
// announcements, or the indicator panes would lag their candles again the day a call site is
// moved over. Each scenario runs on the legacy warmer and on the facade and the two lists of
// announcements are compared.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, OPEN } from './testing/fakeBarsServer'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

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

/** A fresh module graph: the legacy warmer, the store and the facade share ONE registry. */
async function boot() {
  vi.resetModules()
  installFakeBarsServer({})
  const legacy = await import('../../utils/prefetchBars')
  const { createBarStore } = await import('./index')
  const facadeModule = await import('./prefetch')
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  const pf = facadeModule.createPrefetch({ store, tickerMeta: () => {} })
  const mem = await import('../../utils/barsMemCache')
  return { legacy, pf, facadeModule, mem }
}
const tick = (ms) => vi.advanceTimersByTimeAsync(ms)

/** Run one scenario on each side with a warmer registered; return what each side announced. */
async function both(scenario) {
  const out = {}
  for (const side of ['legacy', 'facade']) {
    fakeDb._clear()
    vi.setSystemTime(NOW)
    const w = await boot()
    const told = []
    const off = w.legacy.registerSymbolWarmer((syms, tf, opts) => told.push({ syms: [...syms], tf, opts: { ...opts } }))
    await scenario(side === 'legacy' ? w.legacy : w.pf, w)
    off()
    out[side] = told
  }
  return out
}

describe('the facade announces what the legacy warmer announces', () => {
  it('the registry is ONE: the facade re-exports the legacy module\'s `registerSymbolWarmer`', async () => {
    const w = await boot()
    expect(w.facadeModule.registerSymbolWarmer).toBe(w.legacy.registerSymbolWarmer)
  })

  it('⭐ scan neighbours, a list that just opened, the in-memory warms and a hover: identical announcements', async () => {
    const LIST = Array.from({ length: 40 }, (_, i) => `S${String.fromCharCode(65 + (i % 26))}${i}`)
    const r = await both(async (api) => {
      api.prefetchBarsToIDB(['AA', 'BB', null, 'CC'], 'D', { priority: true })
      api.prewarmVisibleList(LIST, { chartTf: 'D', memTop: 24 })
      api.prefetchBars(['DD', 'EE'], '5', { priority: true })
      api.prefetchBars(['FF'], 'D', { urgent: true })
      api.prefetchBars(['GG'], 'D')
      api.prefetchBar('HH', 'W')
      api.prefetchBarOnIntent('II', 'D')
      await tick(200)
    })
    expect(r.legacy.length, 'the scenario announced something (non-vacuity)').toBeGreaterThanOrEqual(8)
    expect(r.facade).toEqual(r.legacy)
    // and the shapes that matter downstream are really in there
    expect(r.facade[0]).toEqual({ syms: ['AA', 'BB', 'CC'], tf: 'D', opts: { priority: true, visible: false } })
    expect(r.facade[1]).toEqual({ syms: LIST.slice(0, 24), tf: 'D', opts: { priority: true, visible: true } })
    expect(r.facade.at(-1)).toEqual({ syms: ['II'], tf: 'D', opts: { priority: true } })
  })

  it('every timeframe of a selected symbol is announced at its own timeframe, on both sides', async () => {
    const r = await both(async (api) => { api.prefetchAllTimeframes('AA'); await tick(50) })
    expect(r.legacy.length).toBeGreaterThanOrEqual(5)
    expect(r.facade.map((t) => [t.syms.join(), t.tf]).sort()).toEqual(r.legacy.map((t) => [t.syms.join(), t.tf]).sort())
  })

  it('a hover is announced even when the bars are already held, on both sides', async () => {
    const held = [
      { t: '2026-11-06', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
      { t: '2026-11-09', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
      { t: '2026-11-10', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
    ]
    const heldOn = {}
    const r = await both(async (api, w) => {
      w.mem.memPut('AA', 'D', held)
      // the precondition, per side: each warmer's own "these bars need nothing" early return is live
      if (api === w.pf) {
        // the facade's early return reads the STORE's own verdict for the key: bring it there
        await w.pf.prepareDailyForDisplay('AA', 'D')
        await tick(50)
        heldOn.facade = w.facadeModule.DISPLAYABLE.includes(w.pf.peek(w.facadeModule.viewKeyFor('AA', 'D'))?.status)
      } else {
        heldOn.legacy = w.mem.memHas('AA', 'D')
      }
      api.prefetchBarOnIntent('AA', 'D')
      await tick(200)
    })
    expect(heldOn).toEqual({ legacy: true, facade: true })
    for (const side of ['legacy', 'facade']) {
      expect(r[side], side).toEqual([{ syms: ['AA'], tf: 'D', opts: { priority: true } }])
    }
  })

  it('⛔ a typed PREFIX (no held set, pack stamped) announces nothing on either side', async () => {
    const r = await both(async (api) => { await api.warmTypedSymbol('ZZQ', 'D'); await tick(50) })
    expect(r.legacy).toEqual([])
    expect(r.facade).toEqual([])
  })

  it('a typed name with a held set is announced on both sides', async () => {
    // a current daily set already in memory (the session is Tue 2026-11-10): the text is a ticker
    const held = [
      { t: '2026-11-06', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
      { t: '2026-11-09', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
      { t: '2026-11-10', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
    ]
    const r = await both(async (api, w) => {
      w.mem.memPut('AA', 'D', held)
      await api.warmTypedSymbol('aa', 'D')
      await tick(50)
    })
    for (const side of ['legacy', 'facade']) {
      expect(r[side], side).toEqual([{ syms: ['AA'], tf: 'D', opts: { priority: true } }])
    }
  })
})
