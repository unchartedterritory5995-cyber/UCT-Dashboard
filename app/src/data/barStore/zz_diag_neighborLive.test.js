// TEMPORARY DIAGNOSTIC (not for merge): which requests does a press make on a row that rode the stream, vs one that did not?
import { it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, OPEN } from './testing/fakeBarsServer'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))
const at = (h, m, s = 0) => (OPEN + ((h * 60 + m) - (9 * 60 + 30)) * 60 + s) * 1000
const T = (h, m) => OPEN + ((h * 60 + m) - (9 * 60 + 30)) * 60
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { fakeDb._clear(); vi.useFakeTimers(); localStorage.setItem('barspack.version', 'test') })
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('barspack.version') })
const frame = (sym, t, c, revMs, final = false) => ({ sym, tf: '1', t_s: t, rev: revMs, final, cache_key: `b1:${sym}:1:eth-clock`, bar: { t: t * 1000, o: 10, h: 11, l: 9, c, v: 100, final } })

async function run(stream) {
  vi.resetModules()
  vi.setSystemTime(at(10, 0, 50))
  const server = installFakeBarsServer({ modeFor: () => 'ok' })
  const { createBarStore } = await import('./index')
  const P = await import('./prefetch')
  const st = fakeStream()
  const store = createBarStore({ stream: st, candle: fakeCandle(), prices: fakePrices(), pushEnabled: () => true, isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn() })
  const pf = P.createPrefetch({ store, tickerMeta: () => {}, extended: () => false, visible: () => true, random: () => 0, deepNeighbors: () => false })
  const k = pf.keyFor('AAA', '1')
  const serve = async (ms) => { for (let t = 0; t < ms; t += 10) { await vi.advanceTimersByTimeAsync(10); for (const c of server.calls) if (c.at == null) c.at = Date.now(); for (const c of server.open()) c.respond(); await server.flush() } }
  pf.prefetchBars(['AAA'], '1', { urgent: true }); await serve(200)
  let off = null
  if (stream) {
    off = store.watchLive(k)
    st.st.live.set('AAA:1', at(10, 0, 51))
    st.emit('AAA', '1', frame('AAA', T(10, 0), 10.7, at(10, 0, 59)))
  }
  vi.setSystemTime(at(10, 1, 0) + 300)
  if (stream) { st.emit('AAA', '1', frame('AAA', T(10, 0), 10.8, at(10, 1, 0) + 300, true)); st.emit('AAA', '1', frame('AAA', T(10, 1), 10.9, at(10, 1, 0) + 301)) }
  vi.setSystemTime(at(10, 1, 1))
  const gap = store.peek(k)?.liveGapFrom ?? null
  const n0 = server.calls.length
  const t0 = Date.now()
  pf.prepareForDisplay('AAA', '1').catch(() => {})
  await serve(20)
  const unsub = store.subscribe(k, () => {}, { depth: 20000 })
  await serve(2500)
  const asks = server.calls.slice(n0).filter((c) => c.q.sym === 'AAA').map((c) => `${c.q.since != null ? 'since' : 'full'}${c.q.bars}@${c.at - t0}`)
  unsub(); off?.(); store.dispose()
  return `gap=${gap == null ? 'none' : gap - T(10, 0)};asks=${asks.join(',')}`
}

it('DIAG a press on a row that rode the stream vs one that did not', async () => {
  const a = await run(false)
  const b = await run(true)
  expect(`NOSTREAM ${a} | STREAM ${b}`).toBe('show me')
})
