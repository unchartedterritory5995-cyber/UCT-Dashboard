// prepareForDisplay's own viewWindow rail (zero-network plan PR 1.1, 2026-11-28). The /charts handoff of an intraday chart
// at a past date prepares the WINDOW key (`viewWindow`, chart/viewWindow); its read now asks the history lake first
// (network `_windowRead`). Through the whole facade (createBarStore + createPrefetch, the app's own wiring):
//   P1  a window inside the lake prepares with NO /api/bars, reports a paintable outcome, and holds the lake's bars at or
//       before the window's cutoff;
//   P2  a window past the lake's newest session prepares from the origin (`to=` the date);
//   P3  no second full draw: the window's bars change once over the prepare and the seconds after it.
// Synthetic prices only.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, OPEN } from './testing/fakeBarsServer'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const NOW = (OPEN + 32 * 60 + 20) * 1000          // Tue 2026-11-10 10:02:20 ET, mid-session
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => {
  fakeDb._clear()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  localStorage.setItem('barspack.version', 'test')
})
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('barspack.version') })

/** 5m bars, 09:30-16:00 ET, every weekday from `from` to `to` (ISO). */
async function series5(from, to) {
  const { etMidnightEpoch } = await import('../historyLake/adjust')
  const out = []
  for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue
    const m0 = etMidnightEpoch(d.toISOString().slice(0, 10))
    for (let t = m0 + 570 * 60; t < m0 + 960 * 60; t += 300) out.push({ t, o: 20, h: 21, l: 19, c: 20.5, v: 7 })
  }
  return out
}
/** A history source holding `rows` of COLD 5m in quarter pieces (historyLake/source.js's loadIndex / loadBars). */
function sourceOf(rows) {
  const by = {}
  for (const b of rows) { const d = new Date((b.t - 5 * 3600) * 1000); (by[`${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`] ||= []).push(b) }
  const series = { 5: Object.fromEntries(Object.entries(by).map(([k, rs]) => [k, { first: rs[0].t, last: rs.at(-1).t, bars: rs.length, crc: 1, off: 0, bytes: 1 }])) }
  return {
    loadIndex: vi.fn(async (sym) => (sym === 'COLD' ? { symbol: sym, series, splits: [] } : null)),
    loadBars: vi.fn(async (sym, tf, { from, to }) => {
      const rs = rows.filter((b) => b.t >= from && b.t <= to)
      const col = (k) => Float64Array.from(rs, (b) => b[k])
      return { t: col('t'), o: col('o'), h: col('h'), l: col('l'), c: col('c'), v: col('v'), n: col('v') }
    }),
  }
}

async function boot(lakeRows) {
  vi.resetModules()
  const server = installFakeBarsServer()
  const { createBarStore } = await import('./index')
  const { createPrefetch } = await import('./prefetch')
  const { createHistoryFeed, windowEndOf } = await import('./historyFeed')
  const { viewWindowOfDate } = await import('../../components/chart/viewWindow')
  const source = sourceOf(lakeRows)
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(), history: createHistoryFeed({ source }),
  })
  const pf = createPrefetch({ store, tickerMeta: () => {} })
  return { server, store, pf, source, windowEndOf, viewWindowOfDate }
}
const barsCalls = (server) => server.calls.filter((c) => c.url.includes('/api/bars'))

describe("prepareForDisplay with a viewWindow reads the lake (a chart at a past date)", () => {
  it('P1: a window inside the lake prepares with no /api/bars, on the lake\'s bars at or before the cutoff', async () => {
    const w = await boot(await series5('2025-01-02', '2025-06-30'))
    const vw = w.viewWindowOfDate('2025-03-14', '5')
    const out = w.pf.prepareForDisplay('COLD', '5', { viewWindow: vw })
    await vi.advanceTimersByTimeAsync(500)
    await w.server.drain()
    expect(['current', 'authoritative']).toContain(await out)
    expect(barsCalls(w.server).map((c) => c.url), 'no /api/bars for a window the lake holds').toEqual([])
    const s = w.store.peek(w.pf.keyFor('COLD', '5', { window: vw }))
    expect(s.bars.length).toBeGreaterThan(100)
    expect(s.bars.at(-1).t).toBeLessThanOrEqual(w.windowEndOf(vw.to))
    expect(s.bars.at(-1).t).toBeGreaterThan(w.windowEndOf(vw.to) - 86400)   // the date's own session closes it
    expect(w.source.loadBars).toHaveBeenCalled()
  })

  it('P2: a window past the lake\'s newest session prepares from the origin, `to=` the date', async () => {
    const w = await boot(await series5('2025-01-02', '2025-03-07'))
    const vw = w.viewWindowOfDate('2025-03-14', '5')
    const out = w.pf.prepareForDisplay('COLD', '5', { viewWindow: vw })
    await vi.advanceTimersByTimeAsync(100)
    await w.server.drain()
    await vi.advanceTimersByTimeAsync(100)
    await out
    const urls = barsCalls(w.server).map((c) => c.url)
    expect(urls.length).toBeGreaterThan(0)
    expect(urls.every((u) => /[?&]to=2025-03-14(?:&|$)/.test(u)), urls.join('\n')).toBe(true)
  })

  it('P3: no second full draw: the window\'s bars change once', async () => {
    const w = await boot(await series5('2025-01-02', '2025-06-30'))
    const vw = w.viewWindowOfDate('2025-03-14', '5')
    const key = w.pf.keyFor('COLD', '5', { window: vw })
    expect(key).toContain('@to=')
    const seen = []
    const note = () => { const b = w.store.peek(key)?.bars; if (b?.length && seen.at(-1) !== b) seen.push(b) }
    const unsub = w.store.registry.subscribe(key, note)
    await w.pf.prepareForDisplay('COLD', '5', { viewWindow: vw }).then(note)
    // the chart subscribes, as the handoff's commit does, and time passes
    const off = w.store.subscribe(key, note, { priority: 'visible' })
    for (let i = 0; i < 10; i++) { await vi.advanceTimersByTimeAsync(1000); await w.server.drain(); note() }
    off(); unsub()
    expect(seen.length, 'one set of bars, drawn once').toBe(1)
    expect(barsCalls(w.server)).toEqual([])
  })
})
