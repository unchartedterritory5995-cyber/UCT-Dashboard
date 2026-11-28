// (zero-network PR 1.3) At a date, a list's next rows are pinned and warmed on the WINDOW the colour's charts read there:
// the warmed key IS the chart's key (chartKeyFor), never the plain key's newest rows.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
  const { chartKeyFor } = await import('../../components/chart/useBarSnapshotBars')
  const store = createBarStore({ stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(), history: null })
  return { server, store, pf: createPrefetch({ store, tickerMeta: () => {}, extended: () => false }), viewWindowOfDate, chartKeyFor }
}

describe('a list at a date: the neighbour hold and the urgent next rows name the chart\'s window key', () => {
  it('createNeighborHold.set with a viewWindow pins exactly the keys a chart at that date subscribes', async () => {
    const w = await boot()
    const vw = w.viewWindowOfDate('2025-03-14', '5')
    const hold = w.pf.createNeighborHold()
    hold.set(['AAA', 'BBB'], '5', { showExtended: false, viewWindow: vw })
    for (const sym of ['AAA', 'BBB']) {
      const chartKey = w.chartKeyFor({ sym, resolvedTf: '5', showExtended: false, replayCutoff: null, hasOverride: false, viewWindow: vw })
      expect(chartKey, 'non-vacuity: a window key').toMatch(/@to=/)
      expect(w.store.registry.refs(chartKey), `${sym}: the chart's own key is held`).toBeGreaterThan(0)
      const plain = w.chartKeyFor({ sym, resolvedTf: '5', showExtended: false, replayCutoff: null, hasOverride: false })
      expect(w.store.registry.refs(plain), `${sym}: the plain key is not`).toBe(0)
    }
    hold.clear()
  })
  it('prefetchBars urgent with a viewWindow asks the window at the date for the next rows (to=), and no plain key', async () => {
    const w = await boot()
    w.pf.prefetchBars(['AAA', 'BBB'], '5', { urgent: true, viewWindow: w.viewWindowOfDate('2025-03-14', '5') })
    await vi.advanceTimersByTimeAsync(200)
    await w.server.drain({ advance: () => vi.advanceTimersByTimeAsync(200) })
    const calls = w.server.calls.filter((c) => ['AAA', 'BBB'].includes(c.q.sym) && c.q.tf === '5')
    expect(calls.length, 'non-vacuity').toBeGreaterThan(0)
    expect(calls.every((c) => c.q.to === '2025-03-14'), calls.map((c) => c.url).join('\n')).toBe(true)
  })
  it('CONTROL: no viewWindow (the present): the plain keys, as before', async () => {
    const w = await boot()
    const hold = w.pf.createNeighborHold()
    hold.set(['AAA'], '5', { showExtended: false })
    expect(w.store.registry.refs(w.chartKeyFor({ sym: 'AAA', resolvedTf: '5', showExtended: false, replayCutoff: null, hasOverride: false }))).toBeGreaterThan(0)
    hold.clear()
  })
})

describe('the wiring', () => {
  it('Watchlists passes the colour\'s window to both the hold and the urgent warm; ChartWidget publishes its date', () => {
    const wl = readFileSync(resolve(globalThis.process.cwd(), 'src/pages/Watchlists.jsx'), 'utf8')
    expect(wl).toMatch(/const groupDay = groupDateFor\(hubGroupRef\.current\)/)
    expect(wl).toMatch(/holds\.get\(tf\)\.set\([^\n]*viewWindow: windowOf\(tf\)/)
    expect(wl).toMatch(/prefetchBars\(urgentNext, tf, \{ urgent: true, \.\.\.\(windowOf\(tf\) \? \{ viewWindow: windowOf\(tf\) \} : \{\}\) \}\)/)
    const cw = readFileSync(resolve(globalThis.process.cwd(), 'src/pages/charts/widgets/ChartWidget.jsx'), 'utf8')
    expect(cw).toMatch(/publishGroupDate\(activeColor, groupDateOwner, groupDateDay\)/)
    const ww = readFileSync(resolve(globalThis.process.cwd(), 'src/pages/charts/widgets/WatchlistWidget.jsx'), 'utf8')
    expect(ww).toMatch(/group: color/)
  })
})
