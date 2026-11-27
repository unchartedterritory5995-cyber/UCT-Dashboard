// ⭐ THE DWELL'S WARMS OF A SYMBOL NO CHART SHOWS ARE EVICTED FIRST (2026-11-24). The minute-feed replay (store off, 1m +
// 15m, S&P 500, a press every 2.5 s) made 576 registry keys in 80 presses: 1m 110 and 15m 110 (the board's) and D 108 (the
// list's daily, one per row that scrolled into view), and 5m / 30m / 60m 82 each: one per PRESSED row, from the dwell's
// all-timeframes warm (Watchlists prefetchAllTimeframes, the chart's background warm). Those exist for one thing, a
// timeframe switch on the row the member rests on; once the member has left that row they are the least useful entries
// held, yet the LRU kept them over the rows ahead (warmed earlier, so older), and the rows ahead went first.
//   W1 the scan (the real warm paths, the default caps, NO pins ahead of the hold's +-6: #2691 not applied): no row
//      ahead the list has warmed loses its server answer before the member reaches it; the key cap binds, not the bars.
//   W2 the class itself, through the facade: an entry a dwell warm made stays ordinary while a chart shows its symbol
//      (newer than the list's rows, it outlives them), goes before every other idle entry once no chart does, and an
//      entry a list then pins (a hold) is ordinary again.
// Real store, real network, real facade, real registry and reducer, a fake server answering within 100 ms.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, OPEN } from './testing/fakeBarsServer'
import { scanNeighbors } from '../../utils/scanNeighbors'
import { keyOf } from './types'

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

async function boot() {
  vi.resetModules()
  const server = installFakeBarsServer({ modeFor: () => 'ok' })
  const { createBarStore } = await import('./index')
  const P = await import('./prefetch')
  const R = await import('./registry')
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  const pf = P.createPrefetch({ store, tickerMeta: () => {}, extended: () => false, visible: () => true, random: () => 0.5, deepNeighbors: () => false })
  return { server, store, P, R, pf }
}
const tick = (ms) => vi.advanceTimersByTimeAsync(ms)
async function serve(w, ms) {
  for (let t = 0; t < ms; t += 100) {
    await tick(100)
    for (const c of w.server.open()) c.respond()
    await w.server.flush()
  }
}

describe('the dwell warms of a symbol no chart shows go first', () => {
  it('W1 the 80-press scan, no pins ahead: no row ahead loses its server answer before the member reaches it', async () => {
    vi.setSystemTime(at(10, 7, 30))
    const w = await boot()
    const flat = Array.from({ length: 140 }, (_, i) => `S${String(i).padStart(3, '0')}`)
    const tfs = ['1', '15']
    const k = (sym, tf) => w.pf.keyFor(sym, tf)
    const view = (i) => flat.slice(i, i + 26)
    for (const tf of tfs) w.pf.prewarmVisibleList(view(0), { chartTf: tf })
    await serve(w, 3_000)
    const holds = new Map(tfs.map((tf) => [tf, w.pf.createNeighborHold()]))
    const subs = []
    let ctl = null
    const evicted = []
    const answered = new Set()
    let maxKeys = 0
    let maxBars = 0
    let made = 0
    for (let i = 1; i <= 80; i++) {
      for (let j = i; j <= i + 30; j++) {
        const held = !!w.store.peek(k(flat[j], '1'))?.restSeen
        if (held) answered.add(j)
        else if (answered.has(j)) { evicted.push(`${j}@${i}`); answered.delete(j) }
      }
      const before = new Set(w.store.registry.keys())
      ctl?.abort()
      ctl = new AbortController()
      for (const tf of tfs) w.pf.prepareForDisplay(flat[i], tf, { signal: ctl.signal }).catch(() => {})
      for (const off of subs.splice(0)) off()
      for (const tf of tfs) subs.push(w.store.subscribe(k(flat[i], tf), () => {}))
      const around = scanNeighbors(flat, i, 1, { ahead: 6, behind: 6 })
      const next = scanNeighbors(flat, i, 1, { ahead: 2, behind: 0 })
      for (const tf of tfs) holds.get(tf).set(around, tf, { deep: next, tail: [...next, ...scanNeighbors(flat, i, 1, { ahead: 0, behind: 1 })], selected: flat[i] })
      w.pf.warmMemFromIDB(around, tfs)
      for (const tf of tfs) w.pf.prefetchBarsToIDB(scanNeighbors(flat, i, 1, { ahead: 6, behind: 2 }), tf, { priority: true })
      for (const tf of tfs) w.pf.prefetchBars(next, tf, { urgent: true })
      for (const tf of tfs) w.pf.prewarmVisibleList(view(i), { chartTf: tf })
      await serve(w, 600)
      w.pf.prefetchAllTimeframes(flat[i])                      // the dwell (SCAN_DWELL_MS)
      await serve(w, 1_900)
      made += w.store.registry.keys().filter((x) => !before.has(x)).length
      const st = w.store.registry.stats()
      maxKeys = Math.max(maxKeys, st.keys)
      maxBars = Math.max(maxBars, st.bars)
    }
    for (const off of subs.splice(0)) off()
    for (const h of holds.values()) h.clear()
    w.store.dispose()
    expect(w.R.DEFAULT_MAX_KEYS).toBe(200)
    expect(maxKeys).toBe(200)                                  // the key cap binds...
    expect(maxBars).toBeLessThan(w.R.DEFAULT_BAR_BUDGET / 2)   // ...not the bars
    expect(made / 80).toBeGreaterThan(5)                       // the pressure: entries made a press (the dwell's included)
    expect(evicted, `rows ahead evicted (row@press): ${evicted.join(' ')}`).toEqual([])
  }, 240_000)

  it('W2 ordinary while a chart shows the symbol, first out once none does, ordinary again once a list pins it', async () => {
    vi.setSystemTime(at(10, 7, 30))
    const w = await boot()
    const R = w.store.registry
    let pads = 0
    // `n` newer idle entries, then one release: the registry evicts down to its cap
    const pressure = (n) => {
      for (let i = 0; i < n; i++) R.getSnapshot(keyOf({ sym: `PAD${pads++}`, tf: '5' }))
      const x = keyOf({ sym: 'PAD0', tf: '5' })
      R.acquire(x); R.release(x)
    }
    // 150 ordinary entries, the oldest (a list's warm)
    const list = Array.from({ length: 150 }, (_, i) => `L${String(i).padStart(3, '0')}`)
    w.pf.prefetchBarsToIDB(list, '1', { priority: true, visible: true })
    await serve(w, 20_000)
    expect(R.peek(w.pf.keyFor(list[149], '1'))?.restSeen).toBe(true)
    // the member rests on DWL (a chart on its 1m); the dwell warms its other timeframes
    const off = w.store.subscribe(w.pf.keyFor('DWL', '1'), () => {})
    await serve(w, 500)
    w.pf.prefetchAllTimeframes('DWL')
    await serve(w, 5_000)
    const dwellTfs = ['5', '30', '60']
    const dk = (tf) => w.pf.keyFor('DWL', tf)
    expect(dwellTfs.every((tf) => R.peek(dk(tf))?.restSeen)).toBe(true)
    // pressure while the member stays: the oldest list rows go, the dwell's entries (newer) stay
    const n0 = R.keys().length
    pressure(200 - n0 + 8)
    expect(R.has(w.pf.keyFor(list[0], '1')), 'the oldest list row').toBe(false)
    expect(dwellTfs.every((tf) => R.has(dk(tf))), 'a dwell entry of the symbol a chart shows was evicted').toBe(true)
    // the member leaves DWL; a list pins its 5m (DWL scrolled into a 5m list's window) and lets it go
    off()
    const h = w.pf.createNeighborHold()
    h.set(['DWL'], '5')
    h.clear()
    // the dwell's other entries are used since (newer than the 5m): a 5m entry still marked would be the first to go
    const others = ['D', '15', '30', '60', 'W', 'M'].filter((tf) => R.has(dk(tf)))
    for (const tf of others) R.getSnapshot(dk(tf))
    const oldest = R.keys().filter((x) => x.startsWith('L')).sort()[0]
    // as many newer entries as the dwell made beside the 5m: exactly those go
    expect(others.length).toBeGreaterThanOrEqual(4)
    pressure(others.length)
    expect(R.has(dk('5')), 'the entry a list pinned is ordinary again').toBe(true)
    expect(R.has(dk('30')) || R.has(dk('60')), 'a dwell entry of a symbol no chart shows outlived older entries').toBe(false)
    expect(R.has(oldest), 'an ordinary entry went before the dwell entries').toBe(true)
    w.store.dispose()
  }, 60_000)
})
