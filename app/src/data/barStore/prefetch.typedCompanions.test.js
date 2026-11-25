// ⭐ (2026-11-23, review of #2624 section 2d) THE TYPED WARM TELLS THE COLUMNS LANE ABOUT EVERY LINKED TIMEFRAME.
// Enter's one-render decision needs EVERY linked chart's server columns (useSymbolHandoff decisionGateFor 'columns'),
// and the typed warm told the symbol warmers (engine/serverWarm.js) only about the typing chart's own timeframe. It now
// tells them about the host's linked timeframes too (`alsoTfs`, ChartPane typedIntentTfs), at exactly the moments it
// tells its own: once it has decided the text IS a ticker. So a prefix still tells nothing, anywhere, and each
// timeframe is told once. Through the real store and facade (as prefetch.symbolWarmers.test.js).
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
  localStorage.setItem('uct.barsHistory.enabled', '0')   // no deep join (its own rails cover it)
})
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('barspack.version'); localStorage.removeItem('uct.barsHistory.enabled') })

async function boot() {
  vi.resetModules()
  installFakeBarsServer({})
  const legacy = await import('../../utils/prefetchBars')
  const { createBarStore } = await import('./index')
  const { createPrefetch } = await import('./prefetch')
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  const pf = createPrefetch({ store, tickerMeta: () => {} })
  const mem = await import('../../utils/barsMemCache')
  const told = []
  legacy.registerSymbolWarmer((syms, tf, opts) => told.push([syms.join(), String(tf), !!opts?.priority]))
  return { pf, mem, told }
}
const tick = (ms) => vi.advanceTimersByTimeAsync(ms)
// a current daily set in memory (the session is Tue 2026-11-10): the text is a ticker
const HELD = [
  { t: '2026-11-06', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
  { t: '2026-11-09', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
  { t: '2026-11-10', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
]

describe('the typed warm tells the linked timeframes, once the text is a ticker', () => {
  it('typed on a DAILY chart: its own timeframe, then each linked one, each once (its own and repeats skipped)', async () => {
    const w = await boot()
    w.mem.memPut('AA', 'D', HELD)
    await w.pf.warmTypedSymbol('aa', 'D', { alsoTfs: ['D', '30', '60', '30'] })
    await tick(50)
    expect(w.told).toEqual([['AA', 'D', true], ['AA', '30', true], ['AA', '60', true]])
  })

  it('typed on a 30-MINUTE chart linked to a daily one: 30 and D, both at priority', async () => {
    const w = await boot()
    w.mem.memPut('AA', 'D', HELD)
    // (the intraday path races its reads against timers: started, then the clock moves; never awaited first)
    w.pf.warmTypedSymbol('aa', '30', { alsoTfs: ['30', 'D'] })
    await tick(200)
    expect(w.told.filter((t) => t[0] === 'AA')).toEqual([['AA', '30', true], ['AA', 'D', true]])
  })

  it('⛔ a typed PREFIX tells nothing at all: not its own timeframe, not a linked one', async () => {
    const w = await boot()
    await w.pf.warmTypedSymbol('ZZQ', 'D', { alsoTfs: ['30'] })
    await tick(50)
    expect(w.told).toEqual([])
  })

  it('CONTROL: no linked timeframes (no option, or none given): exactly as before, its own timeframe alone', async () => {
    const w = await boot()
    w.mem.memPut('AA', 'D', HELD)
    await w.pf.warmTypedSymbol('aa', 'D')
    await tick(50)
    expect(w.told).toEqual([['AA', 'D', true]])
  })
})
